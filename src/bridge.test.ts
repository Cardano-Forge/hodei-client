import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertSigReqResponse,
  Bridge,
  checkToken,
  isBridgeState,
} from "./bridge";
import { DEFAULT_CONFIG } from "./config";
import * as storage from "./storage";
import {
  latestWS,
  MockWebSocket,
  pairedPayload,
  pairingPayload,
  setupMocks,
} from "./test-utils";

function makeBridge(onStateChange = vi.fn()) {
  return {
    bridge: new Bridge({ config: DEFAULT_CONFIG, onStateChange }),
    onStateChange,
  };
}

async function waitForWS() {
  await vi.waitFor(() => {
    expect(MockWebSocket.instances.length).toBeGreaterThan(0);
  });
}

async function connectPaired(onStateChange = vi.fn()) {
  const { bridge } = makeBridge(onStateChange);
  const p = bridge.connect();
  await waitForWS();
  const ws = latestWS();
  ws.simulateMessage({
    type: "client.connected",
    payload: pairedPayload,
  });
  await p;
  onStateChange.mockClear();
  return { bridge, onStateChange, ws };
}

beforeEach(() => {
  setupMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("checkToken", () => {
  it("returns valid on 200", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200 }));
    const result = await checkToken({ config: DEFAULT_CONFIG, token: "tok" });
    expect(result).toEqual({ valid: true, token: "tok" });
  });

  it("returns notFound on 404", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 404 }));
    const result = await checkToken({ config: DEFAULT_CONFIG, token: "tok" });
    expect(result).toEqual({ valid: false, reason: "notFound" });
  });

  it("returns alreadyConnected on 409", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 409 }));
    const result = await checkToken({ config: DEFAULT_CONFIG, token: "tok" });
    expect(result).toEqual({ valid: false, reason: "alreadyConnected" });
  });

  it("sends correct Authorization header", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ status: 200 });
    vi.stubGlobal("fetch", mockFetch);
    await checkToken({ config: DEFAULT_CONFIG, token: "my-token" });
    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers.Authorization).toBe("Bearer my-token");
  });
});

describe("Bridge.connect", () => {
  it("converts http to ws in URL and appends /client/ws", async () => {
    const { bridge } = makeBridge();
    const p = bridge.connect();
    await waitForWS();
    latestWS().simulateMessage({
      type: "client.connected",
      payload: pairingPayload,
    });
    await p;
    expect(latestWS().url).toContain("ws://localhost:8000/client/ws");
  });

  it("connects without token param when no stored token", async () => {
    const { bridge } = makeBridge();
    const p = bridge.connect();
    await waitForWS();
    latestWS().simulateMessage({
      type: "client.connected",
      payload: pairingPayload,
    });
    await p;
    expect(latestWS().url).not.toContain("token=");
  });

  it("appends token param when stored token is valid", async () => {
    vi.spyOn(storage, "getToken").mockReturnValue("stored-tok");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200 }));
    const { bridge } = makeBridge();
    const p = bridge.connect();
    await waitForWS();
    latestWS().simulateMessage({
      type: "client.connected",
      payload: pairingPayload,
    });
    await p;
    expect(latestWS().url).toContain("token=stored-tok");
  });

  it("throws when stored token returns 409 (already connected)", async () => {
    vi.spyOn(storage, "getToken").mockReturnValue("tok");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 409 }));
    const { bridge } = makeBridge();
    await expect(bridge.connect()).rejects.toThrow("Already connected");
  });

  it("deletes token and connects without param when token returns 404", async () => {
    vi.spyOn(storage, "getToken").mockReturnValue("old-tok");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 404 }));
    const { bridge } = makeBridge();
    const p = bridge.connect();
    await waitForWS();
    latestWS().simulateMessage({
      type: "client.connected",
      payload: pairingPayload,
    });
    await p;
    expect(storage.deleteToken).toHaveBeenCalled();
    expect(latestWS().url).not.toContain("token=");
  });

  it("resolves with pairing state and calls onStateChange", async () => {
    const { bridge, onStateChange } = makeBridge();
    const p = bridge.connect();
    await waitForWS();
    latestWS().simulateMessage({
      type: "client.connected",
      payload: pairingPayload,
    });
    const state = await p;
    expect(state.status).toBe("pairing");
    expect(onStateChange).toHaveBeenCalledWith(
      expect.objectContaining({ status: "pairing" }),
    );
    expect(storage.setToken).toHaveBeenCalledWith("tok-1");
  });

  it("resolves with paired state", async () => {
    const { bridge, onStateChange } = makeBridge();
    const p = bridge.connect();
    await waitForWS();
    latestWS().simulateMessage({
      type: "client.connected",
      payload: pairedPayload,
    });
    const state = await p;
    expect(state.status).toBe("paired");
    expect(onStateChange).toHaveBeenCalledWith(
      expect.objectContaining({ status: "paired" }),
    );
  });

  it("rejects on invalid first message", async () => {
    const { bridge } = makeBridge();
    const p = bridge.connect();
    await waitForWS();
    latestWS().simulateMessage({ type: "garbage", payload: {} });
    await expect(p).rejects.toContain("Invalid connected message");
  });
});

describe("post-connection messages", () => {
  it("wallet_updated merges payload keeping sessionId/token", async () => {
    const { onStateChange, ws } = await connectPaired();
    ws.simulateMessage({
      type: "client.wallet_updated",
      payload: {
        baseAddress: "new_base",
        stakeAddress: "new_stake",
        network: "preprod",
      },
    });
    expect(onStateChange).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "paired",
        sessionId: "sess-1",
        token: "tok-1",
        baseAddress: "new_base",
        stakeAddress: "new_stake",
        network: "preprod",
      }),
    );
  });

  it("ignores invalid message types without crashing", async () => {
    const { onStateChange, ws } = await connectPaired();
    ws.simulateMessage({ type: "unknown.type", payload: {} });
    expect(onStateChange).not.toHaveBeenCalled();
  });
});

describe("disconnection", () => {
  it("disconnect() closes WS with code 1000", async () => {
    const { bridge, ws } = await connectPaired();
    bridge.disconnect();
    expect(ws.closedWith?.code).toBe(1000);
  });

  it("close event code 4001 deletes stored token", async () => {
    const { ws } = await connectPaired();
    ws.simulateClose(4001);
    expect(storage.deleteToken).toHaveBeenCalled();
  });

  it("close event code 1000 sets state to closed and calls onStateChange", async () => {
    const { onStateChange, ws } = await connectPaired();
    ws.simulateClose(1000, "bye");
    expect(onStateChange).toHaveBeenCalledWith(
      expect.objectContaining({ status: "closed", code: 1000, reason: "bye" }),
    );
  });
});

describe("reconnection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function connectWithFakeTimers() {
    const onStateChange = vi.fn();
    const bridge = new Bridge({ config: DEFAULT_CONFIG, onStateChange });
    const p = bridge.connect();
    await vi.advanceTimersByTimeAsync(0);
    latestWS().simulateMessage({
      type: "client.connected",
      payload: pairedPayload,
    });
    await p;
    onStateChange.mockClear();
    return { bridge, onStateChange, ws: latestWS() };
  }

  it("non-1000 close triggers reconnect", async () => {
    await connectWithFakeTimers();
    const countBefore = MockWebSocket.instances.length;
    latestWS().simulateClose(1006, "abnormal");
    await vi.advanceTimersByTimeAsync(2000);
    expect(MockWebSocket.instances.length).toBe(countBefore + 1);
  });

  it("exponential backoff: 2s, 4s, 8s, 16s, 32s", async () => {
    await connectWithFakeTimers();

    const delays = [2000, 4000, 8000, 16000, 32000];
    for (const delay of delays) {
      const countBefore = MockWebSocket.instances.length;
      latestWS().simulateClose(1006);
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(MockWebSocket.instances.length).toBe(countBefore);
      await vi.advanceTimersByTimeAsync(1);
      expect(MockWebSocket.instances.length).toBe(countBefore + 1);
      latestWS().emit("error", { message: "fail" });
    }
  });

  it("max 5 attempts then stops reconnecting", async () => {
    await connectWithFakeTimers();

    latestWS().simulateClose(1006);

    const delays = [2000, 4000, 8000, 16000, 32000];
    for (const delay of delays) {
      const countBefore = MockWebSocket.instances.length;
      await vi.advanceTimersByTimeAsync(delay);
      expect(MockWebSocket.instances.length).toBe(countBefore + 1);
      latestWS().emit("error", { message: "fail" });
    }

    const countAfter = MockWebSocket.instances.length;
    await vi.advanceTimersByTimeAsync(64000);
    expect(MockWebSocket.instances.length).toBe(countAfter);
  });
});

describe("send", () => {
  it("serializes message to JSON and calls ws.send", async () => {
    const { bridge, ws } = await connectPaired();
    const msg = {
      type: "client.sig_req_created" as const,
      payload: { requestId: "r1", tx: "tx1", partialSign: false },
    };
    bridge.send(msg);
    expect(ws.sentMessages[0]).toBe(JSON.stringify(msg));
  });

  it("no-op when not connected", () => {
    const { bridge } = makeBridge();
    bridge.send({ type: "client.session_unlinked", payload: {} });
  });
});

describe("isBridgeState", () => {
  it.each([
    "pairing",
    "paired",
    "closed",
    "error",
  ])("accepts status %s", (status) => {
    expect(isBridgeState({ status })).toBe(true);
  });

  it("rejects invalid shapes", () => {
    expect(isBridgeState(null)).toBe(false);
    expect(isBridgeState({})).toBe(false);
    expect(isBridgeState({ status: "unknown" })).toBe(false);
    expect(isBridgeState("pairing")).toBe(false);
  });
});

describe("assertSigReqResponse", () => {
  it("accepts sig_req_accepted", () => {
    expect(() =>
      assertSigReqResponse({
        type: "client.sig_req_accepted",
        payload: { requestId: "1", signature: "sig" },
      }),
    ).not.toThrow();
  });

  it("accepts sig_req_rejected", () => {
    expect(() =>
      assertSigReqResponse({
        type: "client.sig_req_rejected",
        payload: { requestId: "1", reason: "no" },
      }),
    ).not.toThrow();
  });

  it("throws on anything else", () => {
    expect(() => assertSigReqResponse({ type: "client.connected" })).toThrow();
    expect(() => assertSigReqResponse(null)).toThrow();
  });
});
