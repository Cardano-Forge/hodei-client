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
  debug?: boolean;
  onError(data: { error?: string }): void;
  onClose(data: { code: number; reason: string }): void;
};

export const DEFAULT_CONFIG: Config = {
  bridge: {
    baseUrl: "http://localhost:8000",
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
  onError: ({ error }) =>
    console.error("[HODEI] unhandled error:", error ?? "unknown"),
  onClose: ({ code, reason }) =>
    console.error("[HODEI] unhandled closure:", code, reason),
};
