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

  debugLog(...args: unknown[]) {
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
    this._connection?.ws.close(1000, "disconnected");
    this._connection = undefined;
  }

  getState(): BridgeState | undefined {
    return this.connection?.state;
  }

  private async _connect(): Promise<ConnectionState> {
    this.disconnect();

    const baseUrl = this._config.bridge.baseUrl.replace("http", "ws");
    const url = new URL(`${baseUrl}/client/ws`);

    const token = await this._getToken();
    if (token) {
      url.searchParams.set("token", token);
    }

    const connectionId = (this.connection?.id ?? 0) + 1;
    const ws = new WebSocket(url);
    const connectionController = new AbortController();
    const deferred = deferredPromise<ConnectionState>();

    this.debugLog("connecting");

    ws.addEventListener(
      "message",
      (event) => {
        try {
          const json = JSON.parse(event.data);
          const message = connectedMessageSchema.parse(json);
          this.debugLog("received connection message");
          deferred.resolve(message.payload);
        } catch (error) {
          deferred.reject(
            `Error parsing connection message ${event.data}: ${getFailureReason(error)}`,
          );
        } finally {
          connectionController.abort();
        }
      },
      { signal: connectionController.signal },
    );

    ws.addEventListener(
      "error",
      (event) => {
        this.debugLog("received connection error");
        deferred.reject(`Error connecting: ${getFailureReason(event)}`);
        connectionController.abort();
      },
      { signal: connectionController.signal },
    );

    try {
      const state = await deferred.promise;

      this.debugLog("connected");

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
            const message = incomingMessageSchema.parse(json);
            switch (message.type) {
              case "client.wallet_updated": {
                this.debugLog("received wallet_updated message");

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
            this.debugLog(`error parsing message ${event.data}: ${getFailureReason(error)}`);
          }
        },
        { signal: connection.controller.signal },
      );

      ws.addEventListener(
        "error",
        (event) => {
          if (this._scheduleReconnect()) {
            this.debugLog("scheduled reconnect after error");
            return;
          }

          this.debugLog(`received error: ${getFailureReason(event)}`);

          connection.state = {
            status: "error",
            error: getFailureReason(event),
          };

          this._onStateChange(connection.state);

          connection.controller.abort();
        },
        { signal: connection.controller.signal },
      );

      ws.addEventListener(
        "close",
        async (event) => {
          // Session deleted
          if (event.code === 4001) {
            this.debugLog("session deleted");
            deleteToken();
          }

          if (event.code !== 1000 && this._scheduleReconnect()) {
            this.debugLog("scheduled reconnect after close");
            return;
          }

          this.debugLog(`received close: ${event.code} ${event.reason}`);

          connection.state = {
            status: "closed",
            reason: event.reason,
            code: event.code,
          };

          this._onStateChange(connection.state);

          connection.controller.abort();
        },
        { signal: connection.controller.signal },
      );

      this._attempts = 0;

      return state;
    } catch (error) {
      ws.close(undefined, `failed to connect: ${getFailureReason(error)}`);
      throw error;
    }
  }

  send(message: OutgoingMessage) {
    this.connection?.ws.send(JSON.stringify(message));
  }

  private _attempts = 0;
  private _reconnectTimer?: number;
  private _scheduleReconnect(): boolean {
    if (this._reconnectTimer) {
      this.debugLog("clearing reconnect timer");
      clearTimeout(this._reconnectTimer);
    }

    if (this._attempts >= 5) {
      this.debugLog("max reconnect attempts reached");
      return false;
    }

    const delay = Math.pow(2, ++this._attempts) * 1000;
    this.debugLog(`reconnecting in ${delay / 1000}s`);

    const timer = setTimeout(() => {
      if (this._reconnectTimer !== timer) {
        this.debugLog("reconnect timer cleared. ignoring");
        return;
      }
      this.debugLog("reconnecting");
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

    this.debugLog(`checked token: ${checked.valid ? "valid" : `invalid: ${checked.reason}`}`);

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
  const url = new URL(`${input.config.bridge.baseUrl}/client/check`);

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

const signTxAcceptedMessageSchema = z.object({
  type: z.literal("client.sign_tx_accepted"),
  payload: z.object({
    tx: z.string(),
    signature: z.string(),
  }),
});

const signTxRejectedMessageSchema = z.object({
  type: z.literal("client.sign_tx_rejected"),
  payload: z.object({
    tx: z.string(),
    reason: z.string(),
  }),
});

export const signTxResponseMessageSchema = z.discriminatedUnion("type", [
  signTxAcceptedMessageSchema,
  signTxRejectedMessageSchema,
]);

const incomingMessageSchema = z.discriminatedUnion("type", [
  walletUpdatedMessageSchema,
  signTxResponseMessageSchema,
]);

const signTxRequestedMessageSchema = z.object({
  type: z.literal("client.sign_tx_requested"),
  payload: z.object({
    tx: z.string(),
    partialSign: z.boolean(),
  }),
});

export const outgoingMessageSchema = z.discriminatedUnion("type", [signTxRequestedMessageSchema]);
type OutgoingMessage = z.infer<typeof outgoingMessageSchema>;
