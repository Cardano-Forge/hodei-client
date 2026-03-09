export type Config = {
  bridge: {
    baseUrl: string;
  };
  anvil: Record<
    "mainnet" | "preprod",
    {
      baseUrl: string;
      apiKey: string;
    }
  >;
  debug: boolean;
  waitForPairing: boolean;
  onError(data: { error?: string }): void;
  onClose(data: { code: number; reason: string }): void;
  onWalletUpdate?(wallet: {
    baseAddress: string;
    stakeAddress: string;
    network: "mainnet" | "preprod";
  }): void;
};

export const DEFAULT_CONFIG: Config = {
  bridge: {
    baseUrl: "https://bridge.hodei.io/api/dev",
  },
  anvil: {
    mainnet: {
      baseUrl: "https://prod.api.ada-anvil.app/v2/services",
      apiKey: "mainnet_IIrhwohjiEAJ2LFOgI8p5F735xz4C6XsgH6KfzpC",
    },
    preprod: {
      baseUrl: "https://preprod.api.ada-anvil.app/v2/services",
      apiKey: "testnet_C301LOscFsUccwR4zCqEtTJvizEAUc3AaVhRDdcY",
    },
  },
  debug: false,
  waitForPairing: true,
  onError: ({ error }) =>
    console.error("[HODEI] unhandled error:", error ?? "unknown"),
  onClose: ({ code, reason }) =>
    console.error("[HODEI] unhandled closure:", code, reason),
};
