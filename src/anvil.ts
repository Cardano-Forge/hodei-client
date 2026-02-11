import * as z from "zod/mini";
import type { Config } from "./config";

export type GetUtxosInput = {
  config: Config;
  network: keyof Config["anvil"];
  address: string;
};

const getUtxosOutputSchema = z.array(z.string());
export type GetUtxosOutput = z.infer<typeof getUtxosOutputSchema>;

export async function getUtxos(input: GetUtxosInput): Promise<GetUtxosOutput> {
  const { baseUrl, apiKey } = input.config.anvil[input.network];
  const url = new URL(`${baseUrl}/wallets/utxos`);
  url.searchParams.set("address", input.address);
  url.searchParams.set("includeMempool", "true");
  const res = await fetch(url, { headers: { "x-api-key": apiKey } });
  const json: unknown = await res.json();
  return getUtxosOutputSchema.parse(json);
}

export type GetBalanceInput = {
  config: Config;
  network: keyof Config["anvil"];
  address: string;
};

export type GetBalanceOutput = string;

export async function getBalance(input: GetBalanceInput): Promise<GetBalanceOutput> {
  const { baseUrl, apiKey } = input.config.anvil[input.network];
  const url = new URL(`${baseUrl}/wallets/balance`);
  url.searchParams.set("address", input.address);
  const res = await fetch(url, { headers: { "x-api-key": apiKey } });
  return res.text();
}

export type SubmitTxInput = {
  config: Config;
  network: keyof Config["anvil"];
  transaction: string;
};

const submitTxOutputSchema = z.object({
  txHash: z.string(),
});
type SubmitTxOutput = z.infer<typeof submitTxOutputSchema>;

export async function submitTx(input: SubmitTxInput): Promise<SubmitTxOutput> {
  const { baseUrl, apiKey } = input.config.anvil[input.network];
  const url = new URL(`${baseUrl}/transactions/submit`);
  url.searchParams.set("transaction", input.transaction);
  const res = await fetch(url, { method: "POST", headers: { "x-api-key": apiKey } });
  const json: unknown = await res.json();
  return submitTxOutputSchema.parse(json);
}
