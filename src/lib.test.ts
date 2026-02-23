import {
  afterEach,
  assert,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { ConnectionState } from "./bridge";
import type { Config } from "./config";
import * as storage from "./storage";
import {
  latestWS,
  MockWebSocket,
  pairedPayload,
  pairingPayload,
  setupMocks,
} from "./test-utils";

beforeEach(() => {
  setupMocks();

  if (!customElements.get("hodei-client")) {
    customElements.define(
      "hodei-client",
      class extends HTMLElement {
        connectedCallback() {
          this.dispatchEvent(new Event("mounted"));
        }
      },
    );
  }

  delete window.cardano;
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const el of document.querySelectorAll("hodei-client")) {
    el.remove();
  }
});

describe("initialize", () => {
  it("creates window.cardano.hodei with correct shape", async () => {
    const { initialize } = await import("./lib");
    const api = initialize();
    expect(api).toBeDefined();
    assert(api);
    expect(api.name).toBe("hodei");
    expect(typeof api.icon).toBe("string");
    expect(api.apiVersion).toBe("1");
    expect(typeof api.enable).toBe("function");
    expect(typeof api.isEnabled).toBe("function");
  });

  it("returns same instance on repeated calls (singleton)", async () => {
    const { initialize } = await import("./lib");
    const first = initialize();
    const second = initialize();
    expect(first).toBe(second);
  });
});

async function enableWallet(
  connectionState: ConnectionState,
  config?: Partial<Config>,
) {
  const { initialize } = await import("./lib");
  const initial = initialize(config);
  assert(initial);

  const enablePromise = initial.enable();

  await vi.waitFor(() => {
    expect(MockWebSocket.instances.length).toBeGreaterThan(0);
  });

  const ws = latestWS();

  ws.simulateMessage({
    type: "client.connected",
    payload: connectionState,
  });

  const api = await enablePromise;

  return { initial, api, ws };
}

async function enablePairedWallet(config?: Partial<Config>) {
  return enableWallet(pairedPayload, config);
}

async function enablePairingWallet(config?: Partial<Config>) {
  return enableWallet(pairingPayload, config);
}

describe("wallet API (paired)", () => {
  it("getNetworkId returns 1 for mainnet", async () => {
    const { api } = await enablePairedWallet();
    expect(await api.getNetworkId()).toBe(1);
  });

  it("getNetworkId returns 0 for preprod", async () => {
    const { api, ws } = await enablePairedWallet();
    ws.simulateMessage({
      type: "client.wallet_updated",
      payload: {
        baseAddress: "addr_base",
        stakeAddress: "addr_stake",
        network: "preprod",
      },
    });
    expect(await api.getNetworkId()).toBe(0);
  });

  it("getUsedAddresses returns [baseAddress]", async () => {
    const { api } = await enablePairedWallet();
    expect(await api.getUsedAddresses()).toEqual([pairedPayload.baseAddress]);
  });

  it("getUnusedAddresses returns []", async () => {
    const { api } = await enablePairedWallet();
    expect(await api.getUnusedAddresses()).toEqual([]);
  });

  it("getChangeAddress returns baseAddress", async () => {
    const { api } = await enablePairedWallet();
    expect(await api.getChangeAddress()).toBe(pairedPayload.baseAddress);
  });

  it("getRewardAddresses returns [stakeAddress]", async () => {
    const { api } = await enablePairedWallet();
    expect(await api.getRewardAddresses()).toEqual([
      pairedPayload.stakeAddress,
    ]);
  });

  it("getUtxos delegates to anvil", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve(["utxo1", "utxo2"]),
      text: () => Promise.resolve(""),
    });
    vi.stubGlobal("fetch", mockFetch);
    const { api } = await enablePairedWallet();
    const utxos = await api.getUtxos();
    expect(utxos).toEqual(["utxo1", "utxo2"]);
  });

  it("getBalance delegates to anvil", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({}),
      text: () => Promise.resolve("1000000"),
    });
    vi.stubGlobal("fetch", mockFetch);
    const { api } = await enablePairedWallet();
    const balance = await api.getBalance();
    expect(balance).toBe("1000000");
  });

  it("submitTx delegates to anvil", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ txHash: "hash123" }),
      text: () => Promise.resolve(""),
    });
    vi.stubGlobal("fetch", mockFetch);
    const { api } = await enablePairedWallet();
    const hash = await api.submitTx("cborTx");
    expect(hash).toBe("hash123");
  });
});

describe("wallet API (not paired)", () => {
  it("all methods throw with code -3 when not paired", async () => {
    const { api, ws } = await enablePairedWallet({
      onClose: () => {},
    });

    ws.close(1000, "done");

    const methods = [
      () => api.getNetworkId(),
      () => api.getUsedAddresses(),
      () => api.getChangeAddress(),
      () => api.getRewardAddresses(),
    ];

    for (const method of methods) {
      try {
        await method();
        expect.unreachable("should have thrown");
      } catch (e: unknown) {
        expect((e as { code: number }).code).toBe(-3);
      }
    }
  });
});

describe("signTx", () => {
  it("sends sig_req_created message and resolves on sig_req_accepted", async () => {
    const mockUUID = vi.fn().mockReturnValue("req-123");
    vi.stubGlobal("crypto", { randomUUID: mockUUID });

    const { api, ws } = await enablePairedWallet();

    const signPromise = api.signTx("cborTx", false);

    await vi.waitFor(() => {
      expect(ws.sentMessages.length).toBeGreaterThan(0);
    });

    const sent = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);
    expect(sent.type).toBe("client.sig_req_created");
    expect(sent.payload.requestId).toBe("req-123");
    expect(sent.payload.tx).toBe("cborTx");
    expect(sent.payload.partialSign).toBe(false);

    ws.simulateMessage({
      type: "client.sig_req_accepted",
      payload: { requestId: "req-123", signature: "sig-abc" },
    });

    const result = await signPromise;
    expect(result).toBe("sig-abc");
  });

  it("rejects on sig_req_rejected", async () => {
    vi.stubGlobal("crypto", { randomUUID: () => "req-456" });

    const { api, ws } = await enablePairedWallet();
    const signPromise = api.signTx("tx", false);

    await vi.waitFor(() => {
      expect(ws.sentMessages.length).toBeGreaterThan(0);
    });

    ws.simulateMessage({
      type: "client.sig_req_rejected",
      payload: { requestId: "req-456", reason: "user declined" },
    });

    await expect(signPromise).rejects.toContain("user declined");
  });

  it("ignores non-matching requestId", async () => {
    vi.stubGlobal("crypto", { randomUUID: () => "req-789" });

    const { api, ws } = await enablePairedWallet();
    const signPromise = api.signTx("tx", false);

    await vi.waitFor(() => {
      expect(ws.sentMessages.length).toBeGreaterThan(0);
    });

    ws.simulateMessage({
      type: "client.sig_req_accepted",
      payload: { requestId: "wrong-id", signature: "sig" },
    });

    ws.simulateMessage({
      type: "client.sig_req_accepted",
      payload: { requestId: "req-789", signature: "correct-sig" },
    });

    expect(await signPromise).toBe("correct-sig");
  });
});

describe("signData", () => {
  it("splits accepted response on :: into {signature, key}", async () => {
    vi.stubGlobal("crypto", { randomUUID: () => "req-data-1" });

    const { api, ws } = await enablePairedWallet();
    const signPromise = api.signData("addr_stake", "deadbeef");

    await vi.waitFor(() => {
      expect(ws.sentMessages.length).toBeGreaterThan(0);
    });

    const sent = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);
    expect(sent.payload.address).toBe("addr_stake");
    expect(sent.payload.data).toBe("deadbeef");

    ws.simulateMessage({
      type: "client.sig_req_accepted",
      payload: { requestId: "req-data-1", signature: "sig-part::key-part" },
    });

    const result = await signPromise;
    expect(result).toEqual({ signature: "sig-part", key: "key-part" });
  });

  it("throws internalError (code -2) if response has no ::", async () => {
    vi.stubGlobal("crypto", { randomUUID: () => "req-data-2" });

    const { api, ws } = await enablePairedWallet();
    const signPromise = api.signData("addr_stake", "deadbeef");

    await vi.waitFor(() => {
      expect(ws.sentMessages.length).toBeGreaterThan(0);
    });

    ws.simulateMessage({
      type: "client.sig_req_accepted",
      payload: { requestId: "req-data-2", signature: "no-separator" },
    });

    try {
      await signPromise;
      expect.unreachable("should have thrown");
    } catch (e: unknown) {
      expect((e as { code: number }).code).toBe(-2);
    }
  });
});

describe("isEnabled", () => {
  it("returns true when bridge is connected", async () => {
    const { initial } = await enablePairedWallet();
    expect(await initial.isEnabled()).toBe(true);
  });

  it("returns false when no token and not connected", async () => {
    const { initialize } = await import("./lib");
    const initial = initialize();
    assert(initial);
    expect(await initial.isEnabled()).toBe(false);
  });

  it("delegates to checkToken when token exists but not yet enabled", async () => {
    vi.spyOn(storage, "getToken").mockReturnValue("some-token");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200 }));
    const { initialize } = await import("./lib");
    const initial = initialize();
    assert(initial);
    expect(await initial.isEnabled()).toBe(true);
  });

  it("returns false when checkToken returns invalid", async () => {
    vi.spyOn(storage, "getToken").mockReturnValue("bad-token");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 404 }));
    const { initialize } = await import("./lib");
    const initial = initialize();
    assert(initial);
    expect(await initial.isEnabled()).toBe(false);
  });
});

describe("command handling", () => {
  it("dialog_closed while pairing disconnects bridge", async () => {
    const { ws } = await enablePairingWallet({
      onClose: () => {},
    });
    const el = document.querySelector("hodei-client");
    assert(el);
    expect(ws.closedWith).toBeUndefined();
    el.dispatchEvent(
      new CustomEvent("command", {
        detail: { sender: "client", type: "dialog_closed" },
      }),
    );
    expect(ws.closedWith?.code).toBe(1000);
  });

  it("disconnected command disconnects bridge", async () => {
    const { ws } = await enablePairedWallet({
      onClose: () => {},
    });
    const el = document.querySelector("hodei-client");
    assert(el);
    expect(ws.closedWith).toBeUndefined();
    el.dispatchEvent(
      new CustomEvent("command", {
        detail: { sender: "client", type: "disconnected" },
      }),
    );
    expect(ws.closedWith?.code).toBe(1000);
  });

  it("unlinked command sends unlink message over WS", async () => {
    const { ws } = await enablePairedWallet();
    const el = document.querySelector("hodei-client");
    assert(el);
    expect(ws.closedWith).toBeUndefined();
    el.dispatchEvent(
      new CustomEvent("command", {
        detail: { sender: "client", type: "unlinked" },
      }),
    );
    const sent = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);
    expect(sent.type).toBe("client.session_unlinked");
  });
});
