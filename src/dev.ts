import * as z from "zod/mini";
import type { EnabledWalletApi } from "./api";
import { DEFAULT_CONFIG } from "./config";
import { initialize } from "./lib";

initialize({
  onError: ({ error }) => console.log("socket error:", error ?? "unknown"),
  onClose: ({ code, reason }) => console.log("socket closed:", code, reason),
});

let wallet: EnabledWalletApi | undefined;

document.querySelector("#connect")?.addEventListener("click", async () => {
  wallet = await window.cardano?.hodei?.enable();
  wallet?.getUtxos().then((utxos) => console.log("utxos", utxos));
  wallet?.getBalance().then((balance) => console.log("balance", balance));
});

document.querySelector("#check")?.addEventListener("click", async () => {
  const res = await window.cardano?.hodei?.isEnabled();
  console.log("isEnabled?", res);
});

document.querySelector("#toggle")?.addEventListener("click", async () => {
  const existing = document.querySelector("dialog");
  if (existing) {
    existing.remove();
    return;
  }

  const el = document.createElement("dialog");
  el.innerText = "my dialog with long text inside it";
  el.open = true;
  document.body.appendChild(el);
});

document.querySelector("#sign-tx")?.addEventListener("click", async () => {
  try {
    if (!wallet) {
      throw new Error("wallet not connected");
    }

    const networkId = await wallet.getNetworkId();
    const network = networkId === 1 ? "mainnet" : "preprod";

    const { baseUrl, apiKey } = DEFAULT_CONFIG.anvil[network];
    const url = new URL(`${baseUrl}/transactions/build`);
    const changeAddress = await wallet.getChangeAddress();
    const buildRes = await fetch(url, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({ changeAddress }),
    });

    if (!buildRes.ok) {
      throw new Error(`build failed: ${buildRes.status} ${buildRes.statusText}`);
    }

    const json: unknown = await buildRes.json();
    const parsed = z.object({ hash: z.string(), complete: z.string() }).parse(json);
    console.log("tx", parsed.complete);
    console.log("tx hash", parsed.hash);

    const signRes = await wallet.signTx(parsed.complete);
    console.log("signed tx", signRes);
  } catch (error) {
    console.error(error);
  }
});

function utf8ToHex(input: string) {
  const encoder = new TextEncoder();
  const encoded = encoder.encode(input);
  return Array.from(encoded, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

document.querySelector("#sign-data-stake")?.addEventListener("click", async () => {
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
});

document.querySelector("#sign-data-payment")?.addEventListener("click", async () => {
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
});

document.querySelector("#disconnect")?.addEventListener("click", async () => {
  wallet?.disconnect?.();
});
