export type Config = {
  serverUrl: string;
  onError(data: { error?: string }): void;
  onClose(data: { code: number; reason: string }): void;
};
