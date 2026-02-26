import type { Config } from "./config";
import { deleteToken, getToken, setToken } from "./storage";
import { deferredPromise, getFailureReason } from "./utils";

export type BridgeOpts = {
  config: Config;
  onStateChange(state: BridgeState): void;
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
    this._debug = opts.config?.debug ?? false;
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
      this.connection?.state.status === "paired" ||
      this.connection?.state.status === "pairing"
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

  unlink(): void {
    this.send({ type: "client.session_unlinked", payload: {} });
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
          assertConnectedMessage(json);
          this.debugLog("received connection message");
          deferred.resolve(json.payload);
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
            assertIncomingMessage(json);
            switch (json.type) {
              case "client.wallet_updated": {
                this.debugLog("received wallet_updated message");

                connection.state = {
                  ...json.payload,
                  status: "paired",
                  sessionId: connection.state.sessionId,
                  token: connection.state.token,
                };

                this._onStateChange(connection.state);

                break;
              }
            }
          } catch (error) {
            this.debugLog(
              `error parsing message ${event.data}: ${getFailureReason(error)}`,
            );
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

    const delay = 2 ** ++this._attempts * 1000;
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

    this.debugLog(
      `checked token: ${checked.valid ? "valid" : `invalid: ${checked.reason}`}`,
    );

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

export async function checkToken(
  input: CheckTokenInput,
): Promise<CheckedToken> {
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

export type ConnectionState =
  | {
      status: "pairing";
      sessionId: string;
      token: string;
      pin: string;
    }
  | {
      status: "paired";
      sessionId: string;
      token: string;
      baseAddress: string;
      stakeAddress: string;
      network: "mainnet" | "preprod";
    };

export type BridgeState =
  | ConnectionState
  | { status: "closed"; reason: string; code: number }
  | { status: "error"; error?: string };

type ConnectedMessage = {
  type: "client.connected";
  payload: ConnectionState;
};

type WalletUpdatedMessage = {
  type: "client.wallet_updated";
  payload: {
    baseAddress: string;
    stakeAddress: string;
    network: "mainnet" | "preprod";
  };
};

type SigReqAcceptedMessage = {
  type: "client.sig_req_accepted";
  payload: { requestId: string; signature: string };
};

type SigReqRejectedMessage = {
  type: "client.sig_req_rejected";
  payload: { requestId: string; reason: string };
};

export type SigReqResponseMessage =
  | SigReqAcceptedMessage
  | SigReqRejectedMessage;

type IncomingMessage = WalletUpdatedMessage | SigReqResponseMessage;

export type SigReqCreatedMessage = {
  type: "client.sig_req_created";
  payload:
    | { requestId: string; tx: string; partialSign: boolean }
    | { requestId: string; data: string; address: string };
};

type SessionUnlinkedMessage = {
  type: "client.session_unlinked";
  payload: Record<string, never>;
};

type OutgoingMessage = SigReqCreatedMessage | SessionUnlinkedMessage;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isConnectionState(value: unknown): value is ConnectionState {
  return (
    isRecord(value) && (value.status === "pairing" || value.status === "paired")
  );
}

function assertConnectedMessage(
  value: unknown,
): asserts value is ConnectedMessage {
  if (
    !isRecord(value) ||
    value.type !== "client.connected" ||
    !isConnectionState(value.payload)
  ) {
    throw new Error("Invalid connected message");
  }
}

const incomingMessageTypes = new Set([
  "client.wallet_updated",
  "client.sig_req_accepted",
  "client.sig_req_rejected",
]);

export function assertIncomingMessage(
  value: unknown,
): asserts value is IncomingMessage {
  if (
    !isRecord(value) ||
    typeof value.type !== "string" ||
    !incomingMessageTypes.has(value.type)
  ) {
    throw new Error("Invalid incoming message");
  }
}

export function assertSigReqResponse(
  value: unknown,
): asserts value is SigReqResponseMessage {
  if (
    !isRecord(value) ||
    (value.type !== "client.sig_req_accepted" &&
      value.type !== "client.sig_req_rejected")
  ) {
    throw new Error("Invalid sig req response");
  }
}

const bridgeStateStatuses = new Set(["pairing", "paired", "closed", "error"]);

export function isBridgeState(value: unknown): value is BridgeState {
  return (
    isRecord(value) &&
    typeof value.status === "string" &&
    bridgeStateStatuses.has(value.status)
  );
}
