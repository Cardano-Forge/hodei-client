export type InitialWalletApi = {
  name: string;
  icon: string;
  apiVersion: string;
  enable(): Promise<EnabledWalletApi>;
  isEnabled(): Promise<boolean>;
};

export type EnabledWalletApi = {
  getNetworkId(): Promise<number>;
  getUtxos(amount?: string, paginate?: number): Promise<string[] | null>;
  getBalance(): Promise<string>;
  getUsedAddresses(paginate?: number): Promise<string[]>;
  getUnusedAddresses(): Promise<string[]>;
  getChangeAddress(): Promise<string>;
  getRewardAddresses(): Promise<string[]>;
  signTx(tx: string, partialSign?: boolean): Promise<string>;
  signData(addr: string, payload: string): Promise<string>;
  submitTx(tx: string): Promise<string>;
  /** Non-standard. Used by the Weld wallet connector to allow wallets to clean up on disconnect. */
  disconnect?(): void | Promise<void>;
};

export type FullWalletApi = InitialWalletApi & EnabledWalletApi;

export type WindowCardano = {
  hodei?: InitialWalletApi;
};

declare global {
  interface Window {
    cardano?: WindowCardano;
  }
}
