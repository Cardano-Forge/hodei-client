import * as z from "zod/mini";
import { getFailureReason } from "./utils";
import { deleteToken, getToken, setToken } from "./storage";
import type { Config } from "./config";

export function connectToBridge(input: ConnectToBridgeInput): BridgeApi {
  const url = new URL("/client/ws", input.config.serverUrl.replace("http", "ws"));

  const token = getToken();
  if (token) {
    url.searchParams.set("token", token);
  }

  const ws = new WebSocket(url);

  const controller = new AbortController();

  let state: BridgeState | undefined;

  const api: BridgeApi = {
    getState: () => state,
    disconnect: () => {
      controller.abort();
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    },
  };

  ws.addEventListener(
    "message",
    (event) => {
      try {
        if (state?.status === "error") {
          throw new Error("Received message after error");
        }

        if (state?.status === "closed") {
          throw new Error("Received message after closed");
        }

        const json = JSON.parse(event.data);
        const message = messageSchema.parse(json);

        switch (message.type) {
          case "client.connected": {
            state = message.payload;
            setToken(state.token);
            input.onStateChange(state);
            break;
          }
          case "client.wallet_updated": {
            if (!state) {
              throw new Error("Received wallet update before connection");
            }

            state = {
              status: "paired",
              sessionId: state.sessionId,
              token: state.token,
              ...message.payload,
            };
            input.onStateChange(state);
            break;
          }
        }
      } catch (error) {
        console.log("[HODEI] error parsing message:", getFailureReason(error));
      }
    },
    { signal: controller.signal },
  );

  ws.addEventListener(
    "error",
    (event) => {
      try {
        if (state?.status === "error") {
          throw new Error("Received error after error");
        }

        if (state?.status === "closed") {
          throw new Error("Received error after closed");
        }

        state = {
          status: "error",
          error: getFailureReason(event),
        };

        input.onStateChange(state);
      } finally {
        api.disconnect();
      }
    },
    { signal: controller.signal },
  );

  ws.addEventListener(
    "close",
    async (event) => {
      try {
        // Session deleted
        if (event.code === 4001) {
          deleteToken();
        }

        if (state?.status === "error") {
          throw new Error("Received close after error");
        }

        if (state?.status === "closed") {
          throw new Error("Received close after closed");
        }

        state = {
          status: "closed",
          reason: event.reason,
          code: event.code,
        };

        input.onStateChange(state);
      } finally {
        api.disconnect();
      }
    },
    { signal: controller.signal },
  );

  return api;
}

type ConnectToBridgeInput = {
  config: Config;
  onStateChange(state: BridgeState): void;
};

type BridgeState =
  | ConnectionState
  | { status: "closed"; reason: string; code: number }
  | { status: "error"; error?: string };

export type BridgeApi = {
  getState(): BridgeState | undefined;
  disconnect(): void;
};

const connectionStateSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("pairing"),
    sessionId: z.string(),
    token: z.string(),
    pin: z.string(),
  }),
  z.object({
    status: z.literal("paired"),
    sessionId: z.string(),
    token: z.string(),
    baseAddress: z.string(),
    stakeAddress: z.string(),
    network: z.enum(["mainnet", "preprod"]),
  }),
]);
type ConnectionState = z.infer<typeof connectionStateSchema>;

const connectedMessageSchema = z.object({
  type: z.literal("client.connected"),
  payload: connectionStateSchema,
});

const walletUpdatedMessageSchema = z.object({
  type: z.literal("client.wallet_updated"),
  payload: z.object({
    baseAddress: z.string(),
    stakeAddress: z.string(),
    network: z.enum(["mainnet", "preprod"]),
  }),
});

const messageSchema = z.discriminatedUnion("type", [
  connectedMessageSchema,
  walletUpdatedMessageSchema,
]);
