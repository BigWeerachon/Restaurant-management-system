import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearApiSession, setApiSession, setSessionRenewer } from "./http-client";
import { activeSlices, createRefresher, realtimeStatus, registerActiveSlices, slicesForEvent, startRealtime } from "./realtime";
import type { Slice } from "./types";

/** A response whose body the test writes to, piece by piece, and can end. */
function stream() {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start: (c) => (controller = c) });
  return {
    response: new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }),
    send: (text: string) => controller.enqueue(encoder.encode(text)),
    end: () => controller.close(),
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const domain = (type: string) => `event: domain\ndata: ${JSON.stringify({ id: "e", type, aggregateId: "a" })}\n\n`;

describe("which parts of the store an event makes stale", () => {
  it("maps what happens in the shop to what a screen would show", () => {
    expect(slicesForEvent("kitchen.ticket_fired")).toEqual(["tickets", "orders"]);
    expect(slicesForEvent("kitchen.item_toggled")).toEqual(["tickets", "orders"]);
    expect(slicesForEvent("order.opened")).toEqual(["orders", "tickets", "reports"]);
    expect(slicesForEvent("order.paid")).toEqual(expect.arrayContaining(["orders", "shifts", "stock", "finance"]));
    expect(slicesForEvent("order.refunded")).toEqual(expect.arrayContaining(["orders", "stock", "finance"]));
    expect(slicesForEvent("menu.availability_changed")).toEqual(["availability"]);
    expect(slicesForEvent("inventory.goods_received")).toEqual(expect.arrayContaining(["stock", "purchasing", "finance"]));
    expect(slicesForEvent("inventory.count_approved")).toEqual(expect.arrayContaining(["stock", "counts"]));
    expect(slicesForEvent("inventory.waste_recorded")).toEqual(["stock", "reports"]);
    expect(slicesForEvent("purchasing.po_sent")).toEqual(["purchasing", "reports"]);
    expect(slicesForEvent("finance.day_closed")).toEqual(expect.arrayContaining(["finance", "shifts", "orders"]));
    expect(slicesForEvent("shift.closed")).toEqual(expect.arrayContaining(["shifts"]));
  });

  it("only says the activity feed is stale for an event it knows nothing about", () => {
    expect(slicesForEvent("something.new")).toEqual(["reports"]);
  });
});

describe("screens telling what they show", () => {
  it("counts screens, so a slice stays wanted until the last one showing it goes", () => {
    const a = registerActiveSlices(["orders", "tickets"]);
    const b = registerActiveSlices(["orders"]);
    expect(activeSlices().sort()).toEqual(["orders", "tickets"]);
    a();
    expect(activeSlices()).toEqual(["orders"]);
    b();
    expect(activeSlices()).toEqual([]);
  });
});

describe("reading what changed, in one go", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("puts a burst of events into one read of the union of what they touch", async () => {
    const read = vi.fn(async (_: Slice[]) => {});
    const r = createRefresher(read, 250);
    r.ask(["orders"]);
    r.ask(["tickets", "orders"]);
    await vi.advanceTimersByTimeAsync(100);
    r.ask(["stock"]);
    expect(read).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);
    expect(read).toHaveBeenCalledTimes(1);
    expect([...read.mock.calls[0]![0]].sort()).toEqual(["orders", "stock", "tickets"]);
  });

  it("holds asks that come while it is reading and reads them straight after, once", async () => {
    let release!: () => void;
    const read = vi.fn((_: Slice[]) => new Promise<void>((res) => (release = res)));
    const r = createRefresher(read, 100);
    r.ask(["orders"]);
    await vi.advanceTimersByTimeAsync(150);
    expect(read).toHaveBeenCalledTimes(1);
    r.ask(["tickets"]);
    r.ask(["tickets"]);
    await vi.advanceTimersByTimeAsync(500);
    expect(read).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(150);
    expect(read).toHaveBeenCalledTimes(2);
    expect(read.mock.calls[1]![0]).toEqual(["tickets"]);
  });

  it("does nothing when it is stopped, and survives a read that fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const read = vi.fn(async (_: Slice[]) => {
      throw new Error("offline");
    });
    const r = createRefresher(read, 50);
    r.ask(["orders"]);
    r.stop();
    await vi.advanceTimersByTimeAsync(200);
    expect(read).not.toHaveBeenCalled();
    r.ask(["orders"]);
    await vi.advanceTimersByTimeAsync(100);
    expect(read).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
    r.ask(["stock"]);
    await vi.advanceTimersByTimeAsync(100);
    expect(read).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});

describe("the live event stream", () => {
  let stops: (() => void)[] = [];
  beforeEach(() => {
    clearApiSession();
    setApiSession({ token: "staff-token", tenantId: "t-1" });
  });
  afterEach(() => {
    for (const s of stops) s();
    stops = [];
    vi.useRealTimers();
  });

  const start = (opts: Partial<Parameters<typeof startRealtime>[0]> & { fetchImpl: typeof fetch }) => {
    const stop = startRealtime({ branchId: "br-1", onStale: () => {}, onCatchUp: () => {}, backoff: () => 5, ...opts });
    stops.push(stop);
    return stop;
  };

  it("asks for the branch's stream with the session's headers, and says it is live once the server does", async () => {
    const s = stream();
    const fetchImpl = vi.fn(async () => s.response) as unknown as typeof fetch;
    start({ fetchImpl });
    expect(realtimeStatus()).toBe("connecting");
    await tick();
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]! as [URL, RequestInit];
    expect(String(url)).toContain("/v1/events?branchId=br-1");
    expect(init.headers).toMatchObject({ Authorization: "Bearer staff-token", "X-Tenant-Id": "t-1", Accept: "text/event-stream" });
    s.send('event: ready\ndata: {"branchId":"br-1"}\n\n');
    await tick();
    expect(realtimeStatus()).toBe("live");
  });

  it("passes on only what is on screen when something happens", async () => {
    const s = stream();
    const onStale = vi.fn();
    const unregister = registerActiveSlices(["orders", "tickets"]);
    start({ fetchImpl: (async () => s.response) as unknown as typeof fetch, onStale });
    await tick();
    s.send("event: ready\ndata: {}\n\n" + domain("order.paid") + domain("menu.availability_changed"));
    await tick();
    // order.paid touches orders/shifts/stock/...: only "orders" is being shown; availability is not shown at all.
    expect(onStale.mock.calls.map((c) => c[0])).toEqual([["orders"], []]);
    unregister();
  });

  it("ignores pings and messages it cannot read", async () => {
    const s = stream();
    const onStale = vi.fn();
    start({ fetchImpl: (async () => s.response) as unknown as typeof fetch, onStale });
    await tick();
    s.send('event: ping\ndata: {}\n\nevent: domain\ndata: not json\n\nevent: domain\ndata: {"id":"x"}\n\n');
    await tick();
    expect(onStale).not.toHaveBeenCalled();
    expect(realtimeStatus()).toBe("connecting");
  });

  it("reconnects when the stream drops, says it is offline meanwhile, and asks for a catch-up once it is back", async () => {
    const first = stream();
    const second = stream();
    const responses = [first.response, second.response];
    const fetchImpl = vi.fn(async () => responses.shift()!) as unknown as typeof fetch;
    const onCatchUp = vi.fn();
    start({ fetchImpl, onCatchUp });
    await tick();
    first.send("event: ready\ndata: {}\n\n");
    await tick();
    expect(onCatchUp).not.toHaveBeenCalled(); // the first connection needs no catching up
    first.end();
    await tick();
    expect(realtimeStatus()).toBe("offline");
    await new Promise((r) => setTimeout(r, 30));
    second.send("event: ready\ndata: {}\n\n");
    await tick();
    expect(realtimeStatus()).toBe("live");
    expect(onCatchUp).toHaveBeenCalledTimes(1);
  });

  it("keeps trying, with a longer wait each time, when the server cannot be reached", async () => {
    const waits: number[] = [];
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls++;
      throw new TypeError("network down");
    }) as unknown as typeof fetch;
    start({ fetchImpl, backoff: (n) => (waits.push(n), 5) });
    await new Promise((r) => setTimeout(r, 60));
    expect(calls).toBeGreaterThan(2);
    expect(waits.slice(0, 3)).toEqual([0, 1, 2]);
    expect(realtimeStatus()).toBe("offline");
  });

  it("gives up on a stream that has gone silent (a Wi-Fi that stopped answering) and connects again", async () => {
    const first = stream();
    const second = stream();
    const responses = [first.response, second.response];
    // The connection must actually be cut when it is given up on, as a real fetch would.
    const fetchImpl = vi.fn(async (_url: URL, init: RequestInit) => {
      const res = responses.shift()!;
      if (res === first.response) init.signal?.addEventListener("abort", () => first.end(), { once: true });
      return res;
    }) as unknown as typeof fetch;
    const onCatchUp = vi.fn();
    start({ fetchImpl, onCatchUp, stallMs: 60 });
    await tick();
    first.send("event: ready\ndata: {}\n\n");
    await tick();
    expect(realtimeStatus()).toBe("live");
    // Nothing more arrives, not even a ping.
    await new Promise((r) => setTimeout(r, 150));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    second.send("event: ready\ndata: {}\n\n");
    await tick();
    expect(realtimeStatus()).toBe("live");
    expect(onCatchUp).toHaveBeenCalledTimes(1);
  });

  it("keeps a stream that is quiet but alive: pings count as life", async () => {
    const s = stream();
    const fetchImpl = vi.fn(async () => s.response) as unknown as typeof fetch;
    start({ fetchImpl, stallMs: 90 });
    await tick();
    s.send("event: ready\ndata: {}\n\n");
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 40));
      s.send("event: ping\ndata: {}\n\n");
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(realtimeStatus()).toBe("live");
  });

  it("stops for good, and says so, when the session is refused", async () => {
    const onUnauthorized = vi.fn();
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls++;
      return new Response("{}", { status: 401 });
    }) as unknown as typeof fetch;
    start({ fetchImpl, onUnauthorized });
    await new Promise((r) => setTimeout(r, 40));
    expect(calls).toBe(1);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(realtimeStatus()).toBe("off");
  });

  it("renews a token the server refused, and connects again with the new one before giving up", async () => {
    const onUnauthorized = vi.fn();
    const renew = vi.fn(async () => {
      setApiSession({ token: "renewed" });
      return "renewed";
    });
    setSessionRenewer({ canRenew: () => true, shouldRenew: () => false, renew });
    const s = stream();
    const seen: string[] = [];
    const fetchImpl = vi.fn(async (_u: URL, init: any) => {
      seen.push(init.headers.Authorization);
      return seen.length === 1 ? new Response("{}", { status: 401 }) : s.response;
    }) as unknown as typeof fetch;
    start({ fetchImpl, onUnauthorized });
    await new Promise((r) => setTimeout(r, 40));
    s.send("event: ready\ndata: {}\n\n");
    await tick();
    expect(renew).toHaveBeenCalledTimes(1);
    expect(seen).toEqual(["Bearer staff-token", "Bearer renewed"]);
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(realtimeStatus()).toBe("live");
    setSessionRenewer(null);
  });

  it("gives up when the renewed token is refused too, and when it cannot be renewed", async () => {
    const onUnauthorized = vi.fn();
    setSessionRenewer({ canRenew: () => true, shouldRenew: () => false, renew: async () => "still-bad" });
    let calls = 0;
    start({ fetchImpl: (async () => (calls++, new Response("{}", { status: 401 }))) as unknown as typeof fetch, onUnauthorized });
    await new Promise((r) => setTimeout(r, 60));
    expect(calls).toBe(2); // one refusal, one retry, then done
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    setSessionRenewer({ canRenew: () => true, shouldRenew: () => false, renew: async () => null });
    const again = vi.fn();
    let calls2 = 0;
    start({ fetchImpl: (async () => (calls2++, new Response("{}", { status: 401 }))) as unknown as typeof fetch, onUnauthorized: again });
    await new Promise((r) => setTimeout(r, 40));
    expect(calls2).toBe(1);
    expect(again).toHaveBeenCalledTimes(1);
    setSessionRenewer(null);
  });

  it("closes the stream and goes quiet when stopped", async () => {
    const s = stream();
    const stop = start({ fetchImpl: (async () => s.response) as unknown as typeof fetch });
    await tick();
    s.send("event: ready\ndata: {}\n\n");
    await tick();
    stop();
    expect(realtimeStatus()).toBe("off");
  });

  it("does not connect at all without a session", async () => {
    clearApiSession();
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    start({ fetchImpl });
    await tick();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(realtimeStatus()).toBe("off");
  });
});
