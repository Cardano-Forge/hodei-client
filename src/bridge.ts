import { type Config, DEFAULT_RETRY_CONFIG } from "./config";
import { createApiError } from "./error";
import { deleteToken, getToken, setToken } from "./storage";
import {
  type DeferredPromise,
  debounce,
  deferredPromise,
  getFailureReason,
} from "./utils";

export type BridgeOpts = {
  config: Config;
  onStateChange(state: BridgeState): void;
};

export type BridgeConnection = {
  id: number;
  ws: WebSocket;
  state: BridgeState;
  controller: AbortController;
  reconnection: AbortController | undefined;
  events: EventTarget;
};

const CLOSE_CODES = {
  NormalClosure: 1000,
  SessionDeleted: 4001,
};

const WS_STATES: Record<number, string> = {
  [WebSocket.CONNECTING]: "connecting",
  [WebSocket.OPEN]: "open",
  [WebSocket.CLOSING]: "closing",
  [WebSocket.CLOSED]: "closed",
};

export class Bridge {
  readonly config: Config;
  private readonly _onStateChange: (state: BridgeState) => void;
  private _debug: boolean;

  private _sigReqPromises = new Map<string, DeferredPromise<string, string>>();

  private _connectPromise: Promise<ConnectionState> | undefined;
  private _connection?: BridgeConnection;

  constructor(opts: BridgeOpts) {
    this.config = opts.config;
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

  debugLogState() {
    this.debugLog(
      JSON.stringify(
        {
          isConnected: this.isConnected(),
          connection: this.connection
            ? {
                id: this.connection.id,
                ws: WS_STATES[this.connection.ws.readyState],
                state: this.connection.state,
                controller: {
                  aborted: this.connection.controller.signal.aborted,
                },
                reconnection: {
                  status: this.connection.reconnection ? "active" : "inactive",
                  aborted: this.connection.reconnection?.signal.aborted,
                },
              }
            : undefined,
          sigReqPromises: Array.from(this._sigReqPromises.keys()),
        },
        null,
        2,
      ),
    );
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

    this._connection?.ws.close(CLOSE_CODES.NormalClosure, "reconnecting");
    this._connectPromise = this._connect();

    try {
      return await this._connectPromise;
    } finally {
      this._connectPromise = undefined;
    }
  }

  disconnect(): void {
    this.debugLog("disconnecting");
    this._connection?.reconnection?.abort("disconnecting");
    this._connection?.ws.close(CLOSE_CODES.NormalClosure, "disconnected");
    this._connection = undefined;
  }

  unlink(): void {
    this.send({ type: "client.session_unlinked", payload: {} });
  }

  getState(): BridgeState | undefined {
    return this.connection?.state;
  }

  private async _connect(): Promise<ConnectionState> {
    this._connection?.ws.close(CLOSE_CODES.NormalClosure, "reconnecting");

    const baseUrl = this.config.bridge.baseUrl.replace("http", "ws");
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

          if (
            json.payload.status === "paired" &&
            this._sigReqPromises.size > 0
          ) {
            const updatedPromises: typeof this._sigReqPromises = new Map();
            for (const resp of json.payload.sigReqs ?? []) {
              const deferred = this._sigReqPromises.get(resp.requestId);
              if (!deferred) {
                continue;
              }

              this._sigReqPromises.delete(resp.requestId);

              if (!resp.response) {
                updatedPromises.set(resp.requestId, deferred);
                continue;
              }

              ws.send(
                JSON.stringify({
                  type: "client.sig_req_ack",
                  payload: {
                    vaultId: json.payload.vaultId,
                    requestId: resp.requestId,
                  },
                }),
              );

              if (resp.response.status === "accepted") {
                deferred.resolve(resp.response.data);
              } else {
                deferred.reject(resp.response.data);
              }
            }

            for (const deferred of this._sigReqPromises.values()) {
              deferred.reject("request expired");
            }

            this._sigReqPromises = updatedPromises;
          }

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
      "close",
      (event) => {
        this.debugLog("ws closed while connecting");
        deferred.reject(`Closed while connecting: ${getFailureReason(event)}`);
        connectionController.abort();
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
        // Keep stable references so that event listeners keep working
        events: this._connection?.events ?? new EventTarget(),
        reconnection: this._connection?.reconnection,
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

            this.debugLog("received message", json);

            this._connection?.events.dispatchEvent(
              new CustomEvent("message", {
                detail: json,
              }),
            );

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
        async (event) => {
          if (await this.reconnect()) {
            this.debugLog("scheduled reconnect after error");
            return;
          }

          this.debugLog(`received error: ${getFailureReason(event)}`);

          connection.state = {
            status: "error",
            error: getFailureReason(event),
          };

          this._onStateChange(connection.state);

          connection.controller.abort("socket error");
        },
        { signal: connection.controller.signal },
      );

      ws.addEventListener(
        "close",
        async (event) => {
          if (event.code === CLOSE_CODES.SessionDeleted) {
            this.debugLog("session deleted");
            deleteToken();
          }

          if (
            event.code !== CLOSE_CODES.NormalClosure &&
            event.code !== CLOSE_CODES.SessionDeleted
          ) {
            const state = await this.reconnect();
            if (state) {
              this.debugLog("reconnected after close");
              return;
            }
          }

          this.debugLog(`received close: ${event.code} ${event.reason}`);

          connection.state = {
            status: "closed",
            reason: event.reason,
            code: event.code,
          };

          this._onStateChange(connection.state);

          connection.controller.abort("socket closed");
        },
        { signal: connection.controller.signal },
      );

      return state;
    } catch (error) {
      ws.close(undefined, `failed to connect: ${getFailureReason(error)}`);
      throw error;
    }
  }

  send(message: OutgoingMessage) {
    this.connection?.ws.send(JSON.stringify(message));
  }

  handleSigReq(payload: SigReqCreatedMessage["payload"]): Promise<string> {
    if (!this.isConnected()) {
      throw createApiError("refused", new Error("Wallet is not connected"));
    }

    const deferred = deferredPromise<string>();

    this._sigReqPromises.set(payload.requestId, deferred);

    this.connection.events.addEventListener("message", (event) => {
      if (!(event instanceof CustomEvent)) {
        return;
      }
      try {
        const message = event.detail;
        assertSigReqResponse(message);
        if (message.payload.requestId !== payload.requestId) {
          return;
        }

        this._sigReqPromises.delete(payload.requestId);

        if (this.connection.state.status === "paired") {
          this.send({
            type: "client.sig_req_ack",
            payload: {
              vaultId: this.connection.state.vaultId,
              requestId: payload.requestId,
            },
          });
        }

        if (message.type === "client.sig_req_accepted") {
          deferred.resolve(message.payload.signature);
        } else {
          deferred.reject(message.payload.reason);
        }
      } catch (error) {
        this.debugLog(
          `error parsing message ${event.detail}: ${getFailureReason(error)}`,
        );
      }
    });

    this.send({
      type: "client.sig_req_created",
      payload: payload,
    });

    return deferred.promise;
  }

  async reconnect(): Promise<ConnectionState | undefined> {
    if (!this.isConnected()) {
      this.debugLog("failed to reconnect: not connected");
      return undefined;
    }

    this.connection.reconnection?.abort("reconnection was re-triggered");

    const reconnection = new AbortController();

    reconnection.signal.addEventListener(
      "abort",
      () => {
        this.debugLog("reconnection aborted:", reconnection.signal.reason);
        if (this.connection.reconnection === reconnection) {
          this.debugLog("clearing reconnection");
          this.connection.reconnection = undefined;
        } else {
          this.debugLog("clearing reconnection");
        }
      },
      { once: true },
    );

    this.connection.controller.signal.addEventListener(
      "abort",
      // When the parent connection is aborted, cancel the reconnection attempt
      () => reconnection.abort("parent connection aborted"),
      // When the reconnection is aborted, stop listening on the parent connection controller
      { signal: reconnection.signal },
    );

    this.connection.reconnection = reconnection;

    const cfg =
      this.config.retry === true ? DEFAULT_RETRY_CONFIG : this.config.retry;

    let state: ConnectionState | undefined;

    let retries = 0;
    if (cfg !== false && cfg.skipImmediate) {
      this.debugLog("skipping immediate reconnect attempt");
      retries = 1;
    }

    do {
      let delay: number;
      if (!cfg || retries === 0) {
        delay = 0;
      } else {
        const baseDelay = Math.max(0, cfg.baseDelay);
        if (cfg.backoff) {
          delay = baseDelay * 2 ** (retries - 1);
        } else {
          delay = baseDelay;
        }
        if (cfg.maxDelay) {
          delay = Math.min(delay, cfg.maxDelay);
        }
      }

      if (retries > 0) {
        this.debugLog(`next attempt in ${delay / 1000} seconds`);
      }

      const deferred = deferredPromise<ConnectionState | undefined>();

      const timer = setTimeout(async () => {
        if (
          this.isConnected() &&
          this.connection?.ws.readyState === WebSocket.OPEN
        ) {
          deferred.resolve(this.connection.state);
          return;
        }
        try {
          const s = await this._connect();
          deferred.resolve(s);
        } catch (error) {
          deferred.reject(error);
        }
      }, delay);

      const handleAbort = () => {
        clearTimeout(timer);
        deferred.resolve(undefined);
      };
      const reconnectWithDebounce = debounce(() => {
        this.debugLog("restarting connection process: window focused");
        retries = -1;
        handleAbort();
      }, 250);
      const handleVisibilityChange = () => {
        if (document.visibilityState === "visible") {
          reconnectWithDebounce();
        }
      };

      const c = { signal: reconnection.signal, once: true };
      reconnection.signal.addEventListener("abort", handleAbort, c);
      document.addEventListener("visibilitychange", handleVisibilityChange, c);
      window.addEventListener("focus", reconnectWithDebounce, c);

      state = await deferred.promise.catch(() => undefined);

      reconnection.signal.removeEventListener("abort", handleAbort);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", reconnectWithDebounce);

      if (!state) {
        this.debugLog("reconnection attempt failed");
      }
    } while (
      !reconnection.signal.aborted &&
      !state &&
      cfg &&
      retries++ < (cfg.maxRetries ?? Number.POSITIVE_INFINITY)
    );

    // When reconnection is aborted, we want to act as if reconnection failed even if it didn't
    if (reconnection.signal.aborted) {
      this.debugLog("reconnection was aborted, cancelling reconnection");
      return undefined;
    }

    // Trigger reconnection cleanup
    reconnection.abort("done");

    if (state) {
      this.debugLog("reconnection successful");
    } else {
      this.debugLog("reconnection failed");
    }

    return state;
  }

  private async _getToken(): Promise<string | undefined> {
    const token = getToken();
    if (!token) {
      return undefined;
    }

    const checked = await checkToken({ config: this.config, token });

    this.debugLog(
      `checked token: ${checked.valid ? "valid" : `invalid: ${checked.reason}`}`,
    );

    if (checked.valid) {
      return token;
    }

    if (checked.reason === "tooManyConnections") {
      throw new Error("Too many connections");
    }

    if (checked.reason === "notFound") {
      deleteToken();
    }

    return undefined;
  }
}

type CheckedToken =
  | { valid: true; token: string }
  | { valid: false; reason: "notFound" | "tooManyConnections" };

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
    return { valid: false, reason: "tooManyConnections" };
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
      vaultId: string;
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
  payload: ConnectionState & {
    sigReqs?: {
      requestId: string;
      response?: {
        status: "accepted" | "rejected";
        data: string;
      };
    }[];
  };
};

type WalletUpdatedMessage = {
  type: "client.wallet_updated";
  payload: {
    vaultId: string;
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

export type SigReqAckMessage = {
  type: "client.sig_req_ack";
  payload: { vaultId: string; requestId: string };
};

export type SigReqCreatedMessage = {
  type: "client.sig_req_created";
  payload: {
    requestId: string;
    capabilities: "ack"[];
  } & (
    | { tx: string; partialSign: boolean }
    | { data: string; address: string }
  );
};

type SessionUnlinkedMessage = {
  type: "client.session_unlinked";
  payload: Record<string, never>;
};

export type OutgoingMessage =
  | SigReqAckMessage
  | SigReqCreatedMessage
  | SessionUnlinkedMessage;

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
