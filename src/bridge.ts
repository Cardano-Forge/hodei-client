import * as z from "zod/mini";
import { deferredPromise, getFailureReason } from "./utils";
import { deleteToken, getToken, setToken } from "./storage";
import type { Config } from "./config";

export type BridgeOpts = {
  config: Config;
  onStateChange(state: BridgeState): void;
  debug?: boolean;
};

export type BridgeConnection = {
  id: number;
  ws: WebSocket;
  state: BridgeState;
  controller: AbortController;
};

export class Bridge {
  private readonly _config: Config;
  private readonly _onStateChange: (state: BridgeState) => void;
  private _debug: boolean;

  private _connectPromise: Promise<ConnectionState> | undefined;
  private _connection?: BridgeConnection;

  constructor(opts: BridgeOpts) {
    this._config = opts.config;
    this._onStateChange = opts.onStateChange;
    this._debug = opts.debug ?? false;
  }

  setDebug(debug: boolean) {
    this._debug = debug;
  }

  private _debugLog(...args: unknown[]) {
    if (!this._debug) {
      return;
    }

    let header = "[HODEI]";
    if (this.connection) {
      header += ` (${this.connection.id})`;
    }

    console.log(header, ...args);
  }

  get connection(): BridgeConnection | undefined {
    return this._connection;
  }

  isConnected(): this is { connection: { state: ConnectionState } } {
    return (
      this.connection?.state.status === "paired" || this.connection?.state.status === "pairing"
    );
  }

  async connect(): Promise<ConnectionState> {
    if (this._connectPromise) {
      return this._connectPromise;
    }

    if (this.isConnected()) {
      return this.connection.state;
    }

    this._connectPromise = this._connect();

    try {
      return await this._connectPromise;
    } finally {
      this._connectPromise = undefined;
    }
  }

  disconnect(): void {
    this._connection?.controller.abort();
    this._connection?.ws.close();
    this._connection = undefined;
  }

  getState(): BridgeState | undefined {
    return this.connection?.state;
  }

  private async _connect(): Promise<ConnectionState> {
    this.disconnect();

    const baseUrl = this._config.bridge.baseUrl.replace("http", "ws");
    const url = new URL("/client/ws", baseUrl);

    const token = await this._getToken();
    if (token) {
      url.searchParams.set("token", token);
    }

    const connectionId = (this.connection?.id ?? 0) + 1;
    const ws = new WebSocket(url);
    const connectionController = new AbortController();
    const deferred = deferredPromise<ConnectionState>();

    this._debugLog("connecting");

    ws.addEventListener(
      "message",
      (event) => {
        try {
          const json = JSON.parse(event.data);
          const message = connectedMessageSchema.parse(json);
          this._debugLog("received connection message");
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
        this._debugLog("received connection error");
        deferred.reject(`Error connecting: ${getFailureReason(event)}`);
        connectionController.abort();
      },
      { signal: connectionController.signal },
    );

    try {
      const state = await deferred.promise;

      this._debugLog("connected");

      setToken(state.token);

      const connection: BridgeConnection = {
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
                this._debugLog("received wallet_updated message");

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
            this._debugLog(`error parsing message: ${getFailureReason(error)}`);
          }
        },
        { signal: connection.controller.signal },
      );

      ws.addEventListener(
        "error",
        (event) => {
          if (this._scheduleReconnect()) {
            this._debugLog("scheduled reconnect after error");
            return;
          }

          this._debugLog(`received error: ${getFailureReason(event)}`);

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
            this._debugLog("session deleted");
            deleteToken();
          }

          if (event.code !== 1000 && this._scheduleReconnect()) {
            this._debugLog("scheduled reconnect after close");
            return;
          }

          this._debugLog(`received close: ${event.code} ${event.reason}`);

          connection.state = {
            status: "closed",
            reason: event.reason,
            code: event.code,
          };

          this._onStateChange(connection.state);
        },
        { signal: connection.controller.signal },
      );

      this._attempts = 0;

      return state;
    } catch (error) {
      ws.close();
      throw error;
    }
  }

  private _attempts = 0;
  private _reconnectTimer?: number;
  private _scheduleReconnect(): boolean {
    if (this._reconnectTimer) {
      this._debugLog("clearing reconnect timer");
      clearTimeout(this._reconnectTimer);
    }

    if (this._attempts >= 5) {
      this._debugLog("max reconnect attempts reached");
      return false;
    }

    const delay = Math.pow(2, ++this._attempts) * 1000;
    this._debugLog(`reconnecting in ${delay / 1000}s`);

    const timer = setTimeout(() => {
      if (this._reconnectTimer !== timer) {
        this._debugLog("reconnect timer cleared. ignoring");
        return;
      }
      this._debugLog("reconnecting");
      this._reconnectTimer = undefined;
      this._connect().catch(() => this._scheduleReconnect());
    }, delay);

    this._reconnectTimer = timer;

    return true;
  }

  private async _getToken(): Promise<string | undefined> {
    const token = getToken();
    if (!token) {
      return undefined;
    }

    const checked = await checkToken({ config: this._config, token });

    this._debugLog(`checked token: ${checked.valid ? "valid" : `invalid: ${checked.reason}`}`);

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

export const bridgeStateSchema = z.discriminatedUnion("status", [
  connectionStateSchema,
  z.object({ status: z.literal("closed"), reason: z.string(), code: z.number() }),
  z.object({ status: z.literal("error"), error: z.optional(z.string()) }),
]);
export type BridgeState = z.infer<typeof bridgeStateSchema>;

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
