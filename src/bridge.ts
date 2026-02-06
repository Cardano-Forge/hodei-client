import * as z from "zod/mini";
import { deferredPromise, getFailureReason } from "./utils";
import { deleteToken, getToken, setToken } from "./storage";
import type { Config } from "./config";

export type BridgeOpts = {
  config: Config;
  onStateChange(state: BridgeState): void;
};

type Connection = {
  id: number;
  ws: WebSocket;
  state: BridgeState;
  controller: AbortController;
};

export class Bridge {
  private readonly _config: Config;
  private readonly _onStateChange: (state: BridgeState) => void;

  private _connectPromise: Promise<ConnectionState> | undefined;
  private _connection?: Connection;

  constructor(opts: BridgeOpts) {
    this._config = opts.config;
    this._onStateChange = opts.onStateChange;
  }

  async connect(): Promise<ConnectionState> {
    if (this._connection) {
      throw new Error("Already connected");
    }

    if (!this._connectPromise) {
      this._connectPromise = this._connect().then((res) => {
        this._connectPromise = undefined;
        return res;
      });
    }

    return this._connectPromise;
  }

  disconnect(): void {
    this._connection?.controller.abort();
    this._connection?.ws.close();
    this._connection = undefined;
  }

  getState(): BridgeState | undefined {
    return this._connection?.state;
  }

  private async _connect(): Promise<ConnectionState> {
    this.disconnect();

    const baseUrl = this._config.bridge.baseUrl.replace("http", "ws");
    const url = new URL("/client/ws", baseUrl);

    const token = await this._getToken();
    if (token) {
      url.searchParams.set("token", token);
    }

    const connectionId = (this._connection?.id ?? 0) + 1;
    const ws = new WebSocket(url);
    const connectionController = new AbortController();
    const deferred = deferredPromise<ConnectionState>();

    console.log(`[HODEI] (${connectionId}) connecting`);

    ws.addEventListener(
      "message",
      (event) => {
        try {
          const json = JSON.parse(event.data);
          const message = connectedMessageSchema.parse(json);
          console.log(`[HODEI] (${connectionId}) received connection message`);
          deferred.resolve(message.payload);
        } catch (error) {
          deferred.reject(`Error parsing connection message: ${getFailureReason(error)}`);
        } finally {
          connectionController.abort();
        }
      },
      { signal: connectionController.signal },
    );

    ws.addEventListener(
      "error",
      (event) => {
        console.log(`[HODEI] (${connectionId}) received connection error`);
        deferred.reject(`Error connecting: ${getFailureReason(event)}`);
        connectionController.abort();
      },
      { signal: connectionController.signal },
    );

    try {
      const state = await deferred.promise;

      console.log(`[HODEI] (${connectionId}) connected`);

      setToken(state.token);

      const connection: Connection = {
        id: connectionId,
        ws,
        state: state as BridgeState,
        controller: new AbortController(),
      };

      this._connection = connection;

      this._onStateChange(connection.state);

      ws.addEventListener(
        "message",
        (event) => {
          try {
            if (connection.state.status === "error") {
              throw new Error("Received message after error");
            }

            if (connection.state.status === "closed") {
              throw new Error("Received message after closed");
            }

            const json = JSON.parse(event.data);
            const message = messageSchema.parse(json);
            switch (message.type) {
              case "client.wallet_updated": {
                console.log(`[HODEI] (${connection.id}) received wallet_updated message`);

                connection.state = {
                  status: "paired",
                  sessionId: connection.state.sessionId,
                  token: connection.state.token,
                  ...message.payload,
                };
                this._onStateChange(connection.state);
                break;
              }
            }
          } catch (error) {
            console.log(
              `[HODEI] (${connection.id}) error parsing message: ${getFailureReason(error)}`,
            );
          }
        },
        { signal: connection.controller.signal },
      );

      ws.addEventListener(
        "error",
        (event) => {
          if (this._scheduleReconnect()) {
            console.log(`[HODEI] (${connection.id}) scheduled reconnect after error`);
            return;
          }

          console.log(`[HODEI] (${connection.id}) received error: ${getFailureReason(event)}`);

          connection.state = {
            status: "error",
            error: getFailureReason(event),
          };

          this._onStateChange(connection.state);
        },
        { signal: connection.controller.signal },
      );

      ws.addEventListener(
        "close",
        async (event) => {
          // Session deleted
          if (event.code === 4001) {
            console.log(`[HODEI] (${connection.id}) session deleted`);
            deleteToken();
          }

          if (event.code !== 1000 && this._scheduleReconnect()) {
            console.log(`[HODEI] (${connection.id}) scheduled reconnect after close`);
            return;
          }

          console.log(`[HODEI] (${connection.id}) received close: ${event.code} ${event.reason}`);

          connection.state = {
            status: "closed",
            reason: event.reason,
            code: event.code,
          };

          this._onStateChange(connection.state);
        },
        { signal: connection.controller.signal },
      );

      return state;
    } catch (error) {
      ws.close();
      throw error;
    }
  }

  private _scheduleReconnect(): boolean {
    // TODO
    return false;
  }

  private async _getToken(): Promise<string | undefined> {
    const token = getToken();
    if (!token) {
      return undefined;
    }

    const checked = await checkToken({ config: this._config, token });

    console.log(`[HODEI] checked token: ${checked.valid ? "valid" : `invalid: ${checked.reason}`}`);

    if (checked.valid) {
      return token;
    }

    if (checked.reason === "alreadyConnected") {
      throw new Error("Already connected");
    }

    if (checked.reason === "notFound") {
      deleteToken();
    }

    return undefined;
  }
}

type CheckedToken =
  | { valid: true; token: string }
  | { valid: false; reason: "notFound" | "alreadyConnected" };

export type CheckTokenInput = {
  config: Config;
  token: string;
};

export async function checkToken(input: CheckTokenInput): Promise<CheckedToken> {
  const url = new URL("/client/check", input.config.bridge.baseUrl);

  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${input.token}` },
  });

  if (res.status === 404) {
    return { valid: false, reason: "notFound" };
  }

  if (res.status === 409) {
    return { valid: false, reason: "alreadyConnected" };
  }

  return { valid: true, token: input.token };
}

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

const messageSchema = z.discriminatedUnion("type", [walletUpdatedMessageSchema]);
