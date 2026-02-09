import { type BridgeApi, Bridge, type BridgeOpts, type BridgeState } from "./bridge";
import { sendCommand, type Command } from "./command";
import { DEFAULT_CONFIG, type Config } from "./config";
import type { EnabledWalletApi, InitialWalletApi } from "./api";
import { deferredPromise } from "./utils";
import { getBalance, getUtxos, submitTx } from "./anvil";
import { createApiError, createTxSendError } from "./error";

export function initialize(config?: Partial<Config>): InitialWalletApi | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  if (!window.cardano) {
    window.cardano = {};
  }

  if (!window.cardano.hodei) {
    window.cardano.hodei = createInitialWalletApi(config);
  }

  return window.cardano.hodei;
}

type State = {
  config: Config;
  promise?: Promise<EnableOutput>;
  resolved?: EnableOutput;
};

function createInitialWalletApi(initialConfig: Partial<Config> = {}): InitialWalletApi {
  const state: State = {
    config: {
      ...DEFAULT_CONFIG,
      ...initialConfig,
    },
  };

  const handleStateChange = (bridgeState: BridgeState) => {
    if (bridgeState.status === "error") {
      state.config.onError(bridgeState);
      state.resolved = undefined;
    }

    if (bridgeState.status === "closed") {
      state.config.onClose(bridgeState);
      state.resolved = undefined;
    }

    console.log("TODO handleStateChange", bridgeState);
  };

  return {
    name: "hodei",
    icon: "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",
    apiVersion: "1",
    async enable() {
      if (state.resolved) {
        return state.resolved.api;
      }

      if (!state.promise) {
        state.promise = enable({
          config: state.config,
          onStateChange: handleStateChange,
          debug: true, // TODO remove
        });
      }

      try {
        const resolved = await state.promise;

        state.resolved = resolved;

        return resolved.api;
      } finally {
        state.promise = undefined;
      }
    },
    async isEnabled(): Promise<boolean> {
      if (state.resolved) {
        return true;
      }

      if (state.promise) {
        return state.promise.then(
          () => true,
          () => false,
        );
      }

      // TODO Create a check endpoint on the server

      throw new Error("Not implemented");
    },
  };
}

export type EnableOutput = {
  api: EnabledWalletApi;
  bridge: BridgeApi;
  client: MountClientOutput;
};

async function enable(input: BridgeOpts): Promise<EnableOutput> {
  const clientPromise = mountClient();

  const bridge = new Bridge(input);

  await bridge.connect();

  window.addEventListener("beforeunload", () => bridge.disconnect());

  const client = await clientPromise;

  const ensurePaired = () => {
    const bridgeState = bridge.getState();
    if (bridgeState?.status !== "paired") {
      throw createApiError("refused", new Error("Wallet is not connected"));
    }
    return bridgeState;
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
    signTx: async () => {
      throw new Error("TODO Not implemented");
    },
    signData: async () => {
      throw new Error("TODO Not implemented");
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
      bridge.disconnect();
    },
  };

  return {
    api,
    bridge,
    client,
  };
}

export type MountClientOutput = {
  sendCommand: (command: Command) => void;
};

async function mountClient(): Promise<MountClientOutput> {
  if (!customElements.get("hodei-client")) {
    await import("./client.svelte");
  }

  let element = document.querySelector("hodei-client") ?? undefined;
  if (!element) {
    element = document.createElement("hodei-client");
    document.body.appendChild(element);
  }

  const mounted = deferredPromise<void>();
  element.addEventListener("mounted", () => mounted.resolve(), { once: true });

  await mounted.promise;

  return {
    sendCommand: (command: Command) => sendCommand(element, command),
  };
}
