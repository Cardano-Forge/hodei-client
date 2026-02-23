import { vi } from "vitest";
import type { ConnectionState } from "./bridge";
import * as storage from "./storage";

type WSListener = (event: unknown) => void;

export class MockWebSocket {
  static instances: MockWebSocket[] = [];
  url: string;
  readyState = 0;
  listeners: Record<string, WSListener[]> = {};
  sentMessages: string[] = [];
  closedWith?: { code?: number; reason?: string };

  constructor(url: string | URL) {
    this.url = url.toString();
    MockWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = 1;
    });
  }

  addEventListener(
    type: string,
    listener: WSListener,
    opts?: { signal?: AbortSignal },
  ) {
    if (!this.listeners[type]) this.listeners[type] = [];
    if (opts?.signal?.aborted) return;
    this.listeners[type].push(listener);
    opts?.signal?.addEventListener("abort", () => {
      this.listeners[type] = this.listeners[type].filter((l) => l !== listener);
    });
  }

  removeEventListener(type: string, listener: WSListener) {
    if (this.listeners[type]) {
      this.listeners[type] = this.listeners[type].filter((l) => l !== listener);
    }
  }

  send(data: string) {
    this.sentMessages.push(data);
  }

  close(code?: number, reason?: string) {
    if (this.readyState === 3) return;
    this.closedWith = { code, reason };
    this.readyState = 3;
    this.emit("close", { code: code ?? 1005, reason: reason ?? "" });
  }

  emit(type: string, data: unknown) {
    for (const listener of this.listeners[type] ?? []) {
      listener(data);
    }
  }

  simulateMessage(data: unknown) {
    this.emit("message", { data: JSON.stringify(data) });
  }

  simulateClose(code: number, reason = "") {
    this.readyState = 3;
    this.emit("close", { code, reason });
  }
}

export function latestWS(): MockWebSocket {
  return MockWebSocket.instances[MockWebSocket.instances.length - 1];
}

export const pairedPayload = {
  status: "paired" as const,
  sessionId: "sess-1",
  token: "tok-1",
  baseAddress: "addr_base",
  stakeAddress: "addr_stake",
  network: "mainnet" as const,
} satisfies ConnectionState;

export const pairingPayload = {
  status: "pairing" as const,
  sessionId: "sess-1",
  token: "tok-1",
  pin: "1234",
} satisfies ConnectionState;

export function setupMocks() {
  MockWebSocket.instances = [];
  vi.stubGlobal("WebSocket", MockWebSocket);
  vi.spyOn(storage, "getToken").mockReturnValue(undefined);
  vi.spyOn(storage, "setToken").mockImplementation(() => {});
  vi.spyOn(storage, "deleteToken").mockImplementation(() => {});
}
