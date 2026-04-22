import {
  type AddressHex,
  createWeldInstance,
  type EnabledWalletApi as WeldEnabledWalletApi,
} from "@ada-anvil/weld";
import { builtinPlugins } from "@ada-anvil/weld/plugins";
import { hodeiPlugin } from "@ada-anvil/weld-plugin-hodei";
import { submitTx } from "./anvil";
import type {
  EnabledWalletApi as HodeiEnabledWalletApi,
  InitialWalletApi,
} from "./api";
import { type Config, DEFAULT_CONFIG } from "./config";
import { initialize } from "./lib";
import { assert } from "./utils";

type PlaygroundApi = {
  mode: "vanilla" | "weld";
  init: () => void;
  deinit: () => void;
  wallet: () => (HodeiEnabledWalletApi | WeldEnabledWalletApi) | undefined;
  dev: () => DevInitialWalletApi["dev"];
  connect: () => Promise<void>;
};

const baseConfig: Config = {
  ...DEFAULT_CONFIG,
  bridge: {
    ...DEFAULT_CONFIG.bridge,
    // baseUrl: "http://localhost:8000",
  },
  retry: {
    backoff: false,
    baseDelay: 60000,
  },
  debug: true,
  waitForPairing: true,
};

const playgrounds: Record<PlaygroundApi["mode"], () => PlaygroundApi> = {
  vanilla: (): PlaygroundApi => {
    let wallet: HodeiEnabledWalletApi | undefined;

    return {
      mode: "vanilla",
      init: () => {
        initialize({
          ...baseConfig,
          onError: ({ error }) => {
            if (playground.mode !== "vanilla") return;
            updateWalletState({ status: "error", error: error ?? "unknown" });
          },
          onClose: ({ code, reason }) => {
            if (playground.mode !== "vanilla") return;
            updateWalletState({ status: "closed", code, reason });
          },
          onWalletUpdate: (wallet) => {
            if (playground.mode !== "vanilla") return;
            updateWalletState({ status: "connected", ...wallet });
          },
        });
        updateWalletState({ status: "disconnected" });
      },
      deinit: () => {},
      dev: () => (window.cardano?.hodei as DevInitialWalletApi)?.dev,
      wallet: () => wallet,
      connect: async () => {
        try {
          console.log("connecting");
          wallet = await window.cardano?.hodei?.enable();
          console.log("connected and paired!");
        } catch (error) {
          console.log("failed to connect:", error);
        }
      },
    };
  },
  weld: (): PlaygroundApi => {
    const weld = createWeldInstance({
      debug: true,
      plugins: [
        ...builtinPlugins,
        hodeiPlugin({
          ...baseConfig,
          initialize,
        }),
      ],
    });

    return {
      mode: "weld",
      init: () => {
        weld.init();
        weld.wallet.subscribe(updateWalletState);
        updateWalletState(weld.wallet.getState());
      },
      deinit: () => weld.cleanup(),
      dev: () => (window.cardano?.hodei as DevInitialWalletApi)?.dev,
      wallet: () => weld.wallet.handler?.enabledApi,
      connect: async () => {
        await weld.wallet.connectAsync("hodei");
      },
    };
  },
} satisfies Record<string, () => PlaygroundApi>;

let playground = playgrounds.weld();
playground.init();

function updateWalletState(state: object) {
  const el = document.querySelector("#walletState");
  assert(el);
  el.innerHTML = JSON.stringify(
    {
      mode: playground.mode,
      ...state,
    },
    null,
    2,
  );
}

// Kbd shortcuts
window.onkeydown = (event) => {
  let fn: (() => void | Promise<void>) | undefined;

  if (event.key === "C") {
    fn = connect;
  } else if (event.key === "T") {
    fn = signTx;
  } else if (event.key === "G") {
    fn = delegate;
  } else if (event.key === "S") {
    fn = signDataStake;
  } else if (event.key === "P") {
    fn = signDataPayment;
  } else if (event.key === "H") {
    fn = hang;
  } else if (event.key === "D") {
    fn = disconnect;
  } else if (event.key === "U") {
    fn = unlink;
  } else if (event.key === "B") {
    fn = debug;
  } else if (event.key === "M") {
    fn = toggleMode;
  } else if (event.key === "K") {
    fn = clearConsole;
  }

  if (fn) {
    event.preventDefault();
    event.stopPropagation();
    fn();
  }
};

// Buttons
document.querySelector("#connect")?.addEventListener("click", connect);
document.querySelector("#signTx")?.addEventListener("click", signTx);
document.querySelector("#delegate")?.addEventListener("click", delegate);
document
  .querySelector("#signDataStake")
  ?.addEventListener("click", signDataStake);
document
  .querySelector("#signDataPayment")
  ?.addEventListener("click", signDataPayment);
document.querySelector("#hang")?.addEventListener("click", hang);
document.querySelector("#debug")?.addEventListener("click", debug);
document.querySelector("#disconnect")?.addEventListener("click", disconnect);
document.querySelector("#unlink")?.addEventListener("click", unlink);
document.querySelector("#unlink")?.addEventListener("click", unlink);
document.querySelector("#toggleMode")?.addEventListener("click", toggleMode);

// Functions

function toggleMode() {
  playground.deinit();
  if (playground.mode === "vanilla") {
    playground = playgrounds.weld();
  } else {
    playground = playgrounds.vanilla();
  }
  playground.init();
}

function hang() {
  playground.dev()?.hang();
}

function debug() {
  playground.dev()?.debug();
}

async function connect() {
  playground.connect();
}

async function disconnect() {
  playground.dev()?.disconnect();
}

async function unlink() {
  playground.dev()?.unlink();
}

async function clearConsole() {
  console.clear();
}

async function signDataStake() {
  try {
    const wallet = playground.wallet();
    assert(wallet, "wallet not connected");
    const data = utf8ToHex("hello world!");
    console.log("data", data);
    const [rewardAddress] = await wallet.getRewardAddresses();
    if (!rewardAddress) {
      throw new Error("no reward address");
    }
    const signRes = await wallet.signData(rewardAddress as AddressHex, data);
    console.log("signRes", signRes);
  } catch (error) {
    console.error(error);
  }
}

function utf8ToHex(input: string) {
  const encoder = new TextEncoder();
  const encoded = encoder.encode(input);
  return Array.from(encoded, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

async function signDataPayment() {
  try {
    const wallet = playground.wallet();
    assert(wallet, "wallet not connected");
    const data = utf8ToHex("hello world!");
    console.log("data", data);
    const changeAddress = await wallet.getChangeAddress();
    const signRes = await wallet.signData(changeAddress as AddressHex, data);
    console.log("signRes", signRes);
  } catch (error) {
    console.error(error);
  }
}

async function signTx() {
  try {
    const wallet = playground.wallet();
    assert(wallet, "wallet not connected");

    const networkId = await wallet.getNetworkId();
    const network = networkId === 1 ? "mainnet" : "preprod";

    const { baseUrl, apiKey } = baseConfig.anvil[network];
    const url = new URL(`${baseUrl} /transactions/build`);
    const changeAddress = await wallet.getChangeAddress();
    const utxos = await wallet.getUtxos();
    console.log("utxos", utxos);
    const buildRes = await fetch(url, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        changeAddress,
        utxos,
        txChaining: false,
      }),
    });

    if (!buildRes.ok) {
      throw new Error(
        `build failed: ${buildRes.status} ${buildRes.statusText} `,
      );
    }

    const parsed = (await buildRes.json()) as {
      hash: string;
      complete: string;
    };
    console.log("tx", parsed.complete);
    console.log("tx hash", parsed.hash);

    const signRes = await wallet.signTx(parsed.complete);
    console.log("signed tx", signRes);

    if (confirm("submit?")) {
      const submitRes = await submitTx({
        config: baseConfig,
        network: (await wallet.getNetworkId()) === 1 ? "mainnet" : "preprod",
        transaction: parsed.complete,
        signature: signRes,
      });
      console.log("submitRes", submitRes);
    }
  } catch (error) {
    console.error(error);
  }
}

async function delegate() {
  try {
    const wallet = playground.wallet();
    assert(wallet, "wallet not connected");

    const networkId = await wallet.getNetworkId();
    const network = networkId === 1 ? "mainnet" : "preprod";

    const { baseUrl, apiKey } = baseConfig.anvil[network];
    const url = new URL(`${baseUrl} /transactions/build`);
    const changeAddress = await wallet.getChangeAddress();
    const utxos = await wallet.getUtxos();
    const buildRes = await fetch(url, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        changeAddress,
        utxos,
        txChaining: false,
        delegations: [
          {
            type: "pool",
            // Anvil pool
            keyHash: "9c6120440ce518cc375de37536e1c0f0e28beedd4e11a7a053fb923b",
            address: changeAddress,
          },
          // Uncomment to trigger proof generation error
          // {
          //   type: "pool",
          //   keyHash: "9c6120440ce518cc375de37536e1c0f0e28beedd4e11a7a053fb923b",
          //   address:
          //     "addr_test1qp57m0ws6zjl6l07pl8dqa3s6q7zl857tsxdypc4zem5edskgv552vsywzgqyukhupc8qckzr4g2wqsmxl0tsssn4wrqg3fe87",
          // },
        ],
      }),
    });

    if (!buildRes.ok) {
      throw new Error(
        `build failed: ${buildRes.status} ${buildRes.statusText} `,
      );
    }

    const parsed = (await buildRes.json()) as {
      hash: string;
      complete: string;
    };
    console.log("tx", parsed.complete);
    console.log("tx hash", parsed.hash);

    const signRes = await wallet.signTx(parsed.complete, true);
    console.log("signed tx", signRes);

    if (confirm("submit?")) {
      const submitRes = await submitTx({
        config: baseConfig,
        network: (await wallet.getNetworkId()) === 1 ? "mainnet" : "preprod",
        transaction: parsed.complete,
        signature: signRes,
      });
      console.log("submitRes", submitRes);
    }
  } catch (error) {
    console.error(error);
  }
}

export type DevInitialWalletApi = InitialWalletApi & {
  dev?: {
    hang(): void;
    debug(): void;
    unlink(): void;
    disconnect(): void;
  };
};
