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
  signData(addr: string, payload: string): Promise<DataSignature>;
  submitTx(tx: string): Promise<string>;
  disconnect(): void | Promise<void>;
};

export type DataSignature = {
  signature: string;
  key: string;
};

export type FullWalletApi = InitialWalletApi & EnabledWalletApi;

declare global {
  interface Window {
    cardano?: {
      hodei?: InitialWalletApi;
    };
  }
}
