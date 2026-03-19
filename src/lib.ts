import { getBalance, getUtxos, submitTx } from "./anvil";
import type { EnabledWalletApi, InitialWalletApi } from "./api";
import {
  assertIncomingMessage,
  assertSigReqResponse,
  Bridge,
  type BridgeOpts,
  type BridgeState,
  checkToken,
  type SigReqCreatedMessage,
} from "./bridge";
import { addCommandListener, type Command, sendCommand } from "./command";
import { type Config, DEFAULT_CONFIG } from "./config";
import {
  createApiError,
  createTxSendError,
  createTxSignError,
  type TxSignErrorCode,
} from "./error";
import { getToken } from "./storage";
import { deferredPromise, getFailureReason } from "./utils";

export type { Config };

export function initialize(
  config?: Partial<Config>,
): InitialWalletApi | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  if (!window.cardano) {
    window.cardano = {};
  }

  if (!("hodei" in window.cardano)) {
    window.cardano.hodei = createInitialWalletApi(config);
  }

  return window.cardano.hodei;
}

type State = {
  config: Config;
  promise?: Promise<EnableOutput>;
  resolved?: EnableOutput;
};

function createInitialWalletApi(
  initialConfig: Partial<Config> = {},
): InitialWalletApi {
  const state: State = {
    config: {
      ...DEFAULT_CONFIG,
      ...initialConfig,
    },
  };

  const handleStateChange = async (bridgeState: BridgeState) => {
    // Ensures that state has been updated before we send cmds to client
    await state.promise?.catch(() => undefined);

    if (bridgeState.status === "error") {
      state.config.onError(bridgeState);
    }

    if (bridgeState.status === "closed") {
      state.config.onClose(bridgeState);
    }

    if (bridgeState.status === "paired") {
      state.config.onWalletUpdate?.({
        baseAddress: bridgeState.baseAddress,
        stakeAddress: bridgeState.stakeAddress,
        network: bridgeState.network,
      });
    }

    if (state.resolved) {
      state.resolved?.client.sendCommand({
        sender: "wallet",
        type: "state_changed",
        payload: bridgeState,
      });
    } else {
      console.error("[HODEI] (state_changed)", bridgeState);
    }
  };

  return {
    name: "hodei",
    icon: "https://raw.githubusercontent.com/cardano-forge/weld/main/images/wallets/hodei.png",
    apiVersion: "1",
    async enable() {
      if (state.resolved?.bridge.isConnected()) {
        return state.resolved.api;
      }

      if (!state.promise) {
        state.promise = enable({
          config: state.config,
          onStateChange: handleStateChange,
        });
      }

      try {
        const resolved = await state.promise;

        state.resolved = resolved;

        if (state.config.waitForPairing) {
          await resolved.pairingPromise;
        } else {
          // Handle promise rejection
          resolved.pairingPromise.catch(() => {});
        }

        return resolved.api;
      } finally {
        state.promise = undefined;
      }
    },
    async isEnabled(): Promise<boolean> {
      if (state.promise) {
        try {
          await state.promise;
          return true;
        } catch {
          return false;
        }
      }

      if (state.resolved) {
        return state.resolved.bridge.isConnected();
      }

      const token = getToken();
      if (!token) {
        return false;
      }

      try {
        const checked = await checkToken({ config: state.config, token });
        return checked.valid;
      } catch {
        return false;
      }
    },
  };
}

type EnableOutput = {
  api: EnabledWalletApi;
  bridge: Bridge;
  client: MountClientOutput;
  pairingPromise: Promise<void>;
};

async function enable(input: BridgeOpts): Promise<EnableOutput> {
  const client = await mountClient();

  const bridge = new Bridge(input);

  await bridge.connect();

  addCommandListener(
    client.element,
    (command) => {
      if (command.sender !== "client") {
        return;
      }
      switch (command.type) {
        case "dialog_closed": {
          if (bridge.getState()?.status === "pairing") {
            bridge.disconnect();
          }
          break;
        }
        case "disconnected": {
          bridge.disconnect();
          break;
        }
        case "unlinked": {
          bridge.unlink();
          break;
        }
        default: {
          bridge.debugLog(
            `unhandled command received from client: ${JSON.stringify(command)}`,
          );
          break;
        }
      }
    },
    { signal: bridge.connection?.controller.signal },
  );

  const ensurePaired = (): Extract<BridgeState, { status: "paired" }> => {
    const bridgeState = bridge.getState();
    if (bridgeState?.status !== "paired") {
      throw createApiError("refused", new Error("Wallet is not connected"));
    }
    return bridgeState;
  };

  const handleSigReq = async (
    payload: SigReqCreatedMessage["payload"],
  ): Promise<string> => {
    ensurePaired();

    if (!bridge.isConnected()) {
      throw createApiError("refused", new Error("Wallet is not connected"));
    }

    const controller = new AbortController();
    bridge.connection.controller.signal.addEventListener(
      "abort",
      () => controller.abort(),
      {
        signal: controller.signal,
      },
    );

    const deferred = deferredPromise<string>();

    bridge.connection.ws.addEventListener(
      "message",
      (event) => {
        try {
          const json = JSON.parse(event.data);
          assertSigReqResponse(json);
          const message = json;
          if (message.payload.requestId !== payload.requestId) {
            return;
          }

          if (message.type === "client.sig_req_accepted") {
            deferred.resolve(message.payload.signature);
          } else {
            deferred.reject(message.payload.reason);
          }

          controller.abort();
        } catch (error) {
          bridge.debugLog(
            `error parsing message ${event.data}: ${getFailureReason(error)}`,
          );
        }
      },
      { signal: controller.signal },
    );

    bridge.send({
      type: "client.sig_req_created",
      payload: payload,
    });

    return deferred.promise;
  };

  const api: EnabledWalletApi = {
    getNetworkId: async () => (ensurePaired().network === "mainnet" ? 1 : 0),
    getUtxos: async () => {
      const bridgeState = ensurePaired();
      try {
        const utxos = await getUtxos({
          config: input.config,
          network: bridgeState.network,
          address: bridgeState.baseAddress,
        });

        return utxos;
      } catch (error) {
        throw createApiError("internalError", error);
      }
    },
    getBalance: async () => {
      const bridgeState = ensurePaired();
      try {
        const balance = await getBalance({
          config: input.config,
          network: bridgeState.network,
          address: bridgeState.baseAddress,
        });

        return balance;
      } catch (error) {
        throw createApiError("internalError", error);
      }
    },
    getUsedAddresses: async () => {
      const bridgeState = ensurePaired();
      return [bridgeState.baseAddress];
    },
    getUnusedAddresses: async () => {
      return [];
    },
    getChangeAddress: async () => {
      const bridgeState = ensurePaired();
      return bridgeState.baseAddress;
    },
    getRewardAddresses: async () => {
      const bridgeState = ensurePaired();
      return [bridgeState.stakeAddress];
    },
    signTx: async (tx, partialSign = false) => {
      try {
        return await handleSigReq({
          requestId: crypto.randomUUID(),
          tx,
          partialSign,
        });
      } catch (error) {
        const reason = getFailureReason(error);
        const code: TxSignErrorCode = reason?.startsWith("ProofGeneration")
          ? "proofGeneration"
          : "userDeclined";
        throw createTxSignError(code, reason);
      }
    },
    signData: async (address, data) => {
      const res = await handleSigReq({
        requestId: crypto.randomUUID(),
        address,
        data,
      });

      const [signature, key] = res.split("::");
      if (!signature || !key) {
        throw createApiError("internalError", new Error("Invalid signature"));
      }

      return {
        signature,
        key,
      };
    },
    submitTx: async (transaction) => {
      const bridgeState = ensurePaired();
      try {
        const res = await submitTx({
          config: input.config,
          network: bridgeState.network,
          transaction,
        });

        return res.txHash;
      } catch (error) {
        throw createTxSendError("failure", error);
      }
    },
    disconnect: async () => {
      client.sendCommand({
        sender: "wallet",
        type: "disconnecting",
      });
    },
  };

  const pairingPromise = deferredPromise<void>();
  if (bridge.connection && bridge.getState()?.status === "pairing") {
    const controller = new AbortController();

    bridge.connection.controller.signal.addEventListener(
      "abort",
      () => {
        controller.abort();
        pairingPromise.reject(new Error("Aborted"));
      },
      {
        signal: controller.signal,
      },
    );

    bridge.connection.ws.addEventListener(
      "message",
      (event) => {
        try {
          const json = JSON.parse(event.data);
          assertIncomingMessage(json);
          if (json.type === "client.wallet_updated") {
            pairingPromise.resolve();
            controller.abort();
          }
        } catch {}
      },
      {
        signal: controller.signal,
      },
    );
  } else {
    pairingPromise.resolve();
  }

  return {
    api,
    bridge,
    client,
    pairingPromise: pairingPromise.promise,
  };
}

type MountClientOutput = {
  element: Element;
  sendCommand: (command: Command) => void;
};

async function mountClient(): Promise<MountClientOutput> {
  if (!customElements.get("hodei-client")) {
    const client = await import("./client");
    customElements.define("hodei-client", client.HodeiClient);
  }

  let element = document.querySelector("hodei-client") ?? undefined;
  if (!element) {
    element = document.createElement("hodei-client");

    const mounted = deferredPromise<void>();
    element.addEventListener("mounted", () => mounted.resolve(), {
      once: true,
    });
    document.body.appendChild(element);
    await mounted.promise;
  }

  return {
    element,
    sendCommand: (command: Command) => sendCommand(element, command),
  };
}
