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
  retry: RetryConfig | boolean;
  onError(data: { error?: string }): void;
  onClose(data: { code: number; reason: string }): void;
  onWalletUpdate?(wallet: {
    baseAddress: string;
    stakeAddress: string;
    network: "mainnet" | "preprod";
  }): void;
};

export type RetryConfig = {
  /** Maximum number of retries */
  maxRetries?: number;
  /** Base delay in milliseconds between retries */
  baseDelay: number;
  /** Maximum delay in milliseconds between retries */
  maxDelay?: number;
  /** Use exponential backoff (default: true) */
  backoff?: boolean;
};

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: undefined,
  baseDelay: 2000,
  maxDelay: 32_000,
  backoff: true,
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
  retry: true, // Use the DEFAULT_RETRY_CONFIG
  waitForPairing: true,
  onError: ({ error }) =>
    console.error("[HODEI] unhandled error:", error ?? "unknown"),
  onClose: ({ code, reason }) =>
    console.error("[HODEI] unhandled closure:", code, reason),
};
