import type { Config } from "./config";

export type GetUtxosInput = {
  config: Config;
  network: keyof Config["anvil"];
  address: string;
};

export type GetUtxosOutput = string[];

export async function getUtxos(input: GetUtxosInput): Promise<GetUtxosOutput> {
  const { baseUrl, apiKey } = input.config.anvil[input.network];
  const url = new URL(`${baseUrl}/wallets/utxos`);
  url.searchParams.set("address", input.address);
  url.searchParams.set("includeMempool", "true");
  const res = await fetch(url, { headers: { "x-api-key": apiKey } });
  return res.json() as Promise<GetUtxosOutput>;
}

export type GetBalanceInput = {
  config: Config;
  network: keyof Config["anvil"];
  address: string;
};

export type GetBalanceOutput = string;

export async function getBalance(
  input: GetBalanceInput,
): Promise<GetBalanceOutput> {
  const { baseUrl, apiKey } = input.config.anvil[input.network];
  const url = new URL(`${baseUrl}/wallets/balance`);
  url.searchParams.set("address", input.address);
  const res = await fetch(url, { headers: { "x-api-key": apiKey } });
  return res.json();
}

export type SubmitTxInput = {
  config: Config;
  network: keyof Config["anvil"];
  transaction: string;
};

type SubmitTxOutput = { txHash: string };

export async function submitTx(input: SubmitTxInput): Promise<SubmitTxOutput> {
  const { baseUrl, apiKey } = input.config.anvil[input.network];
  const url = new URL(`${baseUrl}/transactions/submit`);
  url.searchParams.set("transaction", input.transaction);
  const res = await fetch(url, {
    method: "POST",
    headers: { "x-api-key": apiKey },
  });
  return res.json() as Promise<SubmitTxOutput>;
}
