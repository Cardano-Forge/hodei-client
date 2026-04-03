import { submitTx } from "./anvil";
import type { EnabledWalletApi } from "./api";
import { type Config, DEFAULT_CONFIG } from "./config";
import { initialize } from "./lib";

const devConfig: Config = {
  ...DEFAULT_CONFIG,
  bridge: {
    ...DEFAULT_CONFIG.bridge,
    baseUrl: "http://localhost:8000",
  },
  debug: true,
  onError: ({ error }) => console.log("socket error:", error ?? "unknown"),
  onClose: ({ code, reason }) => console.log("socket closed:", code, reason),
  onWalletUpdate: (wallet) => console.log("wallet update", wallet),
  waitForPairing: true,
};

initialize(devConfig);

let wallet: EnabledWalletApi | undefined;

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
  } else if (event.key === "L") {
    fn = loseConnection;
  } else if (event.key === "D") {
    fn = disconnect;
  } else if (event.key === "U") {
    fn = unlink;
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
document
  .querySelector("#loseConnection")
  ?.addEventListener("click", loseConnection);
document.querySelector("#disconnect")?.addEventListener("click", disconnect);

// Functions
function loseConnection() {
  window.cardano?.hodei?.__dev__?.closeWs();
}

async function connect() {
  try {
    console.log("connecting");
    wallet = await window.cardano?.hodei?.enable();
    console.log("connected and paired!");
  } catch (error) {
    console.log("failed to connect:", error);
  }
}

async function disconnect() {
  window.cardano?.hodei?.__dev__?.disconnect();
}

async function unlink() {
  window.cardano?.hodei?.__dev__?.unlink();
}

async function signDataStake() {
  try {
    if (!wallet) {
      throw new Error("wallet not connected");
    }
    const data = utf8ToHex("hello world!");
    console.log("data", data);
    const [rewardAddress] = await wallet.getRewardAddresses();
    if (!rewardAddress) {
      throw new Error("no reward address");
    }
    const signRes = await wallet.signData(rewardAddress, data);
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
    if (!wallet) {
      throw new Error("wallet not connected");
    }
    const data = utf8ToHex("hello world!");
    console.log("data", data);
    const changeAddress = await wallet.getChangeAddress();
    const signRes = await wallet.signData(changeAddress, data);
    console.log("signRes", signRes);
  } catch (error) {
    console.error(error);
  }
}

async function signTx() {
  try {
    if (!wallet) {
      throw new Error("wallet not connected");
    }

    const networkId = await wallet.getNetworkId();
    const network = networkId === 1 ? "mainnet" : "preprod";

    const { baseUrl, apiKey } = devConfig.anvil[network];
    const url = new URL(`${baseUrl}/transactions/build`);
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
        `build failed: ${buildRes.status} ${buildRes.statusText}`,
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
        config: devConfig,
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
    if (!wallet) {
      throw new Error("wallet not connected");
    }

    const networkId = await wallet.getNetworkId();
    const network = networkId === 1 ? "mainnet" : "preprod";

    const { baseUrl, apiKey } = devConfig.anvil[network];
    const url = new URL(`${baseUrl}/transactions/build`);
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
        `build failed: ${buildRes.status} ${buildRes.statusText}`,
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
        config: devConfig,
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
