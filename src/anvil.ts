import type { Config } from "./config";

export type GetBalanceInput = {
  config: Config;
  network: keyof Config["anvil"];
  address: string;
};

export async function getBalance(input: GetBalanceInput): Promise<string> {
  const { baseUrl, apiKey } = input.config.anvil[input.network];
  const url = new URL("/wallets/balance", baseUrl);
  const res = await fetch(url, { headers: { "x-api-key": apiKey } });
  return res.text();
}

export type SubmitTxInput = {
  config: Config;
  network: keyof Config["anvil"];
  tx: string;
};

export async function submitTx(input: SubmitTxInput): Promise<string> {
  const { baseUrl, apiKey } = input.config.anvil[input.network];
  const url = new URL("/wallets/balance", baseUrl);
  const res = await fetch(url, { headers: { "x-api-key": apiKey } });
  return res.text();
}
