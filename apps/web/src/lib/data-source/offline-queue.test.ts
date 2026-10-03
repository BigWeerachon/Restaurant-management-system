import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import { DomainError } from "../demo/engine";
import { createOfflineQueue, indexedDbStore, memoryStore, type QueueStore, type QueuedCommand } from "./offline-queue";

type Input = Omit<QueuedCommand, "seq" | "createdAt" | "state" | "attempts">;
const cmd = (id: string, orderId: string, kind: Input["kind"] = "submitOrder", tenantId = "t-1"): Input => ({
  id,
  kind,
  orderId,
  path: kind === "submitOrder" ? "/v1/orders" : `/v1/orders/${orderId}/pay`,
  body: { id: orderId },
  tenantId,
  branchId: "b-1",
  summary: `${kind} ${orderId}`,
});

function setup(opts: { store?: QueueStore; send?: (c: QueuedCommand) => Promise<void>; tenant?: string | null; maxAttempts?: number } = {}) {
  const sent: string[] = [];
  const settled = vi.fn();
  const store = opts.store ?? memoryStore();
  let tenant = opts.tenant === undefined ? "t-1" : opts.tenant;
  const queue = createOfflineQueue({
    store,
    tenantId: () => tenant,
    send:
      opts.send ??
      (async (c) => {
        sent.push(c.id);
      }),
    onSettled: settled,
    maxAttempts: opts.maxAttempts,
  });
  return { queue, sent, settled, store, setTenant: (t: string | null) => (tenant = t) };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("offline queue", () => {
  it("sends commands in the order they were made, once each, and empties itself", async () => {
    const { queue, sent, settled } = setup();
    await queue.enqueue(cmd("k1", "o-1", "submitOrder"));
    await queue.enqueue(cmd("k2", "o-1", "payOrder"));
    await queue.enqueue(cmd("k3", "o-2", "submitOrder"));
    expect(queue.snapshot()).toMatchObject({ pending: 3, failed: 0 });

    const r = await queue.drain();
    expect(r).toEqual({ sent: 3, stopped: null });
    expect(sent).toEqual(["k1", "k2", "k3"]);
    expect(queue.snapshot()).toMatchObject({ pending: 0, failed: 0, items: [] });
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it("keeps commands across a restart: a new queue on the same store finds them and sends them", async () => {
    const store = memoryStore();
    const first = setup({ store });
    await first.queue.enqueue(cmd("k1", "o-1"));
    await first.queue.enqueue(cmd("k2", "o-1", "payOrder"));

    const second = setup({ store });
    expect(second.queue.snapshot().items).toEqual([]); // nothing until it has read the disk
    await second.queue.ensureLoaded();
    expect(second.queue.snapshot().items.map((c) => c.id)).toEqual(["k1", "k2"]);
    expect(second.queue.hasFor("o-1")).toBe(true);
    await second.queue.drain();
    expect(second.sent).toEqual(["k1", "k2"]);
    expect(await store.all()).toEqual([]);
  });

  it("stops when the line is down, keeps everything, and sends the same commands with the same keys next time", async () => {
    let down = true;
    const attempts: string[] = [];
    const { queue } = setup({
      send: async (c) => {
        attempts.push(c.id);
        if (down) throw new DomainError("NETWORK_OFFLINE");
      },
    });
    await queue.enqueue(cmd("k1", "o-1"));
    await queue.enqueue(cmd("k2", "o-2"));

    expect(await queue.drain()).toEqual({ sent: 0, stopped: "network" });
    expect(attempts).toEqual(["k1"]); // no point trying the rest
    expect(queue.snapshot()).toMatchObject({ pending: 2, failed: 0 });

    down = false;
    expect(await queue.drain()).toEqual({ sent: 2, stopped: null });
    expect(attempts).toEqual(["k1", "k1", "k2"]);
  });

  it("treats \"the same request is still being saved\" like a lost line: keep it, do not count it against the command, try again next time", async () => {
    let busy = true;
    const { queue } = setup({
      maxAttempts: 2,
      send: async () => {
        if (busy) throw new DomainError("REQUEST_IN_PROGRESS");
      },
    });
    await queue.enqueue(cmd("k1", "o-1"));

    // Far more often than maxAttempts: it is never set aside as failed, because nothing is wrong with the command.
    for (let i = 0; i < 4; i++) expect(await queue.drain()).toEqual({ sent: 0, stopped: "network" });
    expect(queue.snapshot()).toMatchObject({ pending: 1, failed: 0 });

    busy = false;
    expect(await queue.drain()).toEqual({ sent: 1, stopped: null });
  });

  it("does not tell screens to reload when nothing reached the server", async () => {
    const { queue, settled } = setup({ send: async () => Promise.reject(new DomainError("NETWORK_OFFLINE")) });
    await queue.enqueue(cmd("k1", "o-1"));
    await queue.drain();
    expect(settled).not.toHaveBeenCalled();
  });

  it("sets aside a command the server refuses and holds the rest of that order, but carries on with other orders", async () => {
    const attempts: string[] = [];
    const { queue, settled } = setup({
      send: async (c) => {
        attempts.push(c.id);
        if (c.id === "k1") throw new DomainError("MENU_ITEM_SOLD_OUT", { name: "ข้าวกะเพรา" });
      },
    });
    await queue.enqueue(cmd("k1", "o-1", "submitOrder"));
    await queue.enqueue(cmd("k2", "o-1", "payOrder"));
    await queue.enqueue(cmd("k3", "o-2", "submitOrder"));

    const r = await queue.drain();
    expect(r).toEqual({ sent: 1, stopped: null });
    expect(attempts).toEqual(["k1", "k3"]); // the payment for o-1 must not be sent for an order that does not exist
    const items = queue.snapshot().items;
    expect(items.map((c) => [c.id, c.state])).toEqual([
      ["k1", "failed"],
      ["k2", "pending"],
    ]);
    expect(items[0]).toMatchObject({ errorCode: "MENU_ITEM_SOLD_OUT", errorParams: { name: "ข้าวกะเพรา" } });
    expect(queue.snapshot()).toMatchObject({ pending: 1, failed: 1 });
    expect(settled).toHaveBeenCalled();

    // Draining again must not resend the refused one or the one held behind it.
    attempts.length = 0;
    await queue.drain();
    expect(attempts).toEqual([]);
  });

  it("retry puts a refused command and the ones held behind it back in line", async () => {
    let refuse = true;
    const attempts: string[] = [];
    const { queue } = setup({
      send: async (c) => {
        attempts.push(c.id);
        if (refuse && c.id === "k1") throw new DomainError("CHANNEL_NOT_FOUND");
      },
    });
    await queue.enqueue(cmd("k1", "o-1", "submitOrder"));
    await queue.enqueue(cmd("k2", "o-1", "payOrder"));
    await queue.drain();
    expect(queue.snapshot().failed).toBe(1);

    refuse = false;
    const r = await queue.retry("k1");
    expect(r.sent).toBe(2);
    expect(attempts).toEqual(["k1", "k1", "k2"]);
    expect(queue.snapshot().items).toEqual([]);
  });

  it("discard drops the refused command and everything after it for the same order, and nothing else", async () => {
    const { queue, settled } = setup({ send: async (c) => (c.id === "k1" ? Promise.reject(new DomainError("ORDER_NOT_OPEN")) : undefined) });
    await queue.enqueue(cmd("k1", "o-1", "submitOrder"));
    await queue.enqueue(cmd("k2", "o-1", "payOrder"));
    await queue.enqueue(cmd("k3", "o-2", "submitOrder"));
    await queue.drain();
    settled.mockClear();

    await queue.discard("k1");
    expect(queue.snapshot().items).toEqual([]);
    expect(queue.orderIds().size).toBe(0);
    expect(settled).toHaveBeenCalled(); // screens drop the local copy of the discarded order
  });

  it("stops without penalty when the session has to be renewed", async () => {
    let signedIn = false;
    const { queue } = setup({ send: async () => (signedIn ? undefined : Promise.reject(new DomainError("AUTH_REQUIRED"))) });
    await queue.enqueue(cmd("k1", "o-1"));
    expect(await queue.drain()).toEqual({ sent: 0, stopped: "auth" });
    expect(queue.snapshot().items[0]).toMatchObject({ state: "pending", attempts: 0 });
    signedIn = true;
    expect(await queue.drain()).toEqual({ sent: 1, stopped: null });
  });

  it("gives a struggling server a few more tries, then sets the command aside", async () => {
    const { queue } = setup({ maxAttempts: 3, send: async () => Promise.reject(new DomainError("INTERNAL")) });
    await queue.enqueue(cmd("k1", "o-1"));
    expect((await queue.drain()).stopped).toBe("server");
    expect((await queue.drain()).stopped).toBe("server");
    expect(queue.snapshot().items[0]).toMatchObject({ state: "pending", attempts: 2 });
    await queue.drain();
    expect(queue.snapshot().items[0]).toMatchObject({ state: "failed", errorCode: "INTERNAL" });
  });

  it("leaves another shop's commands alone until that shop is signed in", async () => {
    const { queue, sent, setTenant } = setup();
    await queue.enqueue(cmd("mine", "o-1", "submitOrder", "t-1"));
    await queue.enqueue(cmd("theirs", "o-9", "submitOrder", "t-2"));
    expect(queue.snapshot().items.map((c) => c.id)).toEqual(["mine"]);

    await queue.drain();
    expect(sent).toEqual(["mine"]);

    setTenant("t-2");
    queue.refreshView();
    expect(queue.snapshot().items.map((c) => c.id)).toEqual(["theirs"]);
    await queue.drain();
    expect(sent).toEqual(["mine", "theirs"]);
  });

  it("nothing is sent while nobody is signed in", async () => {
    const { queue, sent } = setup({ tenant: null });
    await queue.enqueue(cmd("k1", "o-1", "submitOrder", "t-1"));
    await queue.drain();
    expect(sent).toEqual([]);
  });

  it("a second drain while one is running joins it instead of sending twice", async () => {
    const seen: string[] = [];
    const { queue } = setup({
      send: async (c) => {
        await wait(20);
        seen.push(c.id);
      },
    });
    await queue.enqueue(cmd("k1", "o-1"));
    const [a, b] = await Promise.all([queue.drain(), queue.drain()]);
    expect(seen).toEqual(["k1"]);
    expect(a).toBe(b);
  });

  it("commands added while a drain is running are picked up by the next one, in order", async () => {
    const seen: string[] = [];
    const { queue } = setup({
      send: async (c) => {
        await wait(10);
        seen.push(c.id);
      },
    });
    await queue.enqueue(cmd("k1", "o-1"));
    const running = queue.drain();
    await queue.enqueue(cmd("k2", "o-2"));
    await running;
    await queue.drain();
    expect(seen).toEqual(["k1", "k2"]);
  });

  it("tells subscribers when the counts change, and keeps the same snapshot object when they do not", async () => {
    const { queue } = setup();
    const listener = vi.fn();
    queue.subscribe(listener);
    const empty = queue.snapshot();
    queue.refreshView();
    expect(queue.snapshot()).toBe(empty);
    expect(listener).not.toHaveBeenCalled();

    await queue.enqueue(cmd("k1", "o-1"));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(queue.snapshot()).not.toBe(empty);
    await queue.drain();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("commands are saved before they show on screen, so a crash right after cannot lose a sale", async () => {
    const store = memoryStore();
    const put = vi.spyOn(store, "put");
    const { queue } = setup({ store });
    const p = queue.enqueue(cmd("k1", "o-1"));
    expect(put).toHaveBeenCalledTimes(1);
    await p;
    expect(await store.all()).toHaveLength(1);
  });
});

describe("IndexedDB store", () => {
  it("keeps commands in a real IndexedDB, and a second connection (a reload) reads them back", async () => {
    const factory = new IDBFactory();
    const one = indexedDbStore(factory, "test-1");
    const { queue } = setup({ store: one });
    await queue.enqueue(cmd("k1", "o-1", "submitOrder"));
    await queue.enqueue(cmd("k2", "o-1", "payOrder"));

    const afterReload = indexedDbStore(factory, "test-1");
    const rows = await afterReload.all();
    expect(rows.map((r) => r.id)).toEqual(["k1", "k2"]);
    expect(rows[0]).toMatchObject({ kind: "submitOrder", orderId: "o-1", state: "pending", body: { id: "o-1" } });

    const again = setup({ store: afterReload });
    await again.queue.ensureLoaded();
    await again.queue.drain();
    expect(again.sent).toEqual(["k1", "k2"]);
    expect(await afterReload.all()).toEqual([]);
  });

  it("stores state changes (a refused command stays refused after a reload)", async () => {
    const factory = new IDBFactory();
    const store = indexedDbStore(factory, "test-2");
    const { queue } = setup({ store, send: async () => Promise.reject(new DomainError("ORDER_NOT_OPEN")) });
    await queue.enqueue(cmd("k1", "o-1"));
    await queue.drain();

    const rows = await indexedDbStore(factory, "test-2").all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ state: "failed", errorCode: "ORDER_NOT_OPEN" });
  });
});
