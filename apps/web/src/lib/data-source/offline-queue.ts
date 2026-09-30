/**
 * The offline queue (checklist 5.2). When the till cannot reach the server, a sale must not be lost: the
 * command is kept on this device — in IndexedDB, so it survives a reload or a crash — and sent again, in the
 * order it was made, as soon as the line is back.
 *
 * What makes replaying safe is the idempotency key. Every queued command carries the key it was first sent
 * with, so if the first try did reach the server (and only the answer was lost) the repeat is answered with the
 * first result instead of taking the payment twice.
 *
 * This file is plain logic with no browser globals except an optional IndexedDB store, so it is tested directly.
 */
import { DomainError } from "../demo/engine";

export interface QueuedCommand {
  /** The Idempotency-Key the command is sent with — also its identity in the queue. */
  id: string;
  /** Order in which commands were made; replay follows it. */
  seq: number;
  kind: "submitOrder" | "payOrder";
  /** Commands for one order depend on each other (pay needs the order to exist), so they stop together. */
  orderId: string;
  path: string;
  body: unknown;
  tenantId: string;
  branchId: string;
  /** What to call it on screen, e.g. "ออเดอร์ #012 · 3 รายการ". */
  summary: string;
  createdAt: string;
  state: "pending" | "failed";
  /** How many times the server has answered with a temporary failure (5xx). */
  attempts: number;
  /** Set when the server refused the command for good (a business rule), or gave up after many tries. */
  errorCode?: string;
  errorParams?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Where commands are kept
// ---------------------------------------------------------------------------
export interface QueueStore {
  all(): Promise<QueuedCommand[]>;
  put(command: QueuedCommand): Promise<void>;
  remove(id: string): Promise<void>;
}

export function memoryStore(): QueueStore {
  const rows = new Map<string, QueuedCommand>();
  return {
    async all() {
      return [...rows.values()].map((r) => structuredClone(r));
    },
    async put(c) {
      rows.set(c.id, structuredClone(c));
    },
    async remove(id) {
      rows.delete(id);
    },
  };
}

const DB_NAME = "sabai-offline";
const STORE = "commands";

/** IndexedDB store; the promise wrapper keeps callers free of request/transaction plumbing. */
export function indexedDbStore(factory: IDBFactory = indexedDB, name = DB_NAME): QueueStore {
  let opened: Promise<IDBDatabase> | null = null;
  const open = () =>
    (opened ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open(name, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error("IndexedDB blocked"));
    }).catch((e) => {
      opened = null;
      throw e;
    }));
  const run = async <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  };
  return {
    all: () => run("readonly", (s) => s.getAll() as IDBRequest<QueuedCommand[]>),
    put: async (c) => void (await run("readwrite", (s) => s.put(c))),
    remove: async (id) => void (await run("readwrite", (s) => s.delete(id))),
  };
}

/** IndexedDB where the browser has it (and lets us use it — private windows sometimes do not), memory otherwise. */
export function defaultStore(): QueueStore {
  if (typeof indexedDB === "undefined") return memoryStore();
  const idb = indexedDbStore();
  const memory = memoryStore();
  // If IndexedDB fails at any point the sale is still kept — in memory, until the page is closed.
  let broken = false;
  const guard = async <T>(fromIdb: () => Promise<T>, fromMemory: () => Promise<T>): Promise<T> => {
    if (broken) return fromMemory();
    try {
      return await fromIdb();
    } catch (e) {
      console.warn("offline queue: IndexedDB unavailable, keeping commands in memory", e);
      broken = true;
      return fromMemory();
    }
  };
  return {
    all: () => guard(() => idb.all(), () => memory.all()),
    put: (c) => guard(() => idb.put(c), () => memory.put(c)),
    remove: (id) => guard(() => idb.remove(id), () => memory.remove(id)),
  };
}

// ---------------------------------------------------------------------------
// The queue
// ---------------------------------------------------------------------------
export interface QueueSnapshot {
  /** Every command of the signed-in shop, in the order they will be sent. */
  items: readonly QueuedCommand[];
  pending: number;
  failed: number;
}

export interface DrainResult {
  sent: number;
  /** Why it stopped early, if it did: the line is down, the session has to be renewed, or the server is struggling. */
  stopped: "network" | "auth" | "server" | null;
}

export interface QueueDeps {
  store: QueueStore;
  /** Sends one command (POST with its own idempotency key). Throws a `DomainError`. */
  send: (command: QueuedCommand) => Promise<void>;
  /** The shop that is signed in now: commands of other shops are left alone until that shop signs in again. */
  tenantId: () => string | null;
  /** Called after a drain that changed something on the server (or gave up on a command) so screens can read again. */
  onSettled?: (result: DrainResult) => void;
  /** Runs `fn` while no other tab is draining. Defaults to running it straight away. */
  exclusive?: <T>(fn: () => Promise<T>) => Promise<T>;
  /** After this many temporary server failures in a row a command is set aside as failed instead of being retried forever. */
  maxAttempts?: number;
}

const TRANSIENT = new Set(["NETWORK_OFFLINE", "TIMEOUT", "RATE_LIMITED"]);

export function createOfflineQueue(deps: QueueDeps) {
  const maxAttempts = deps.maxAttempts ?? 5;
  const exclusive = deps.exclusive ?? (<T>(fn: () => Promise<T>) => fn());
  let all: QueuedCommand[] = [];
  let snapshot: QueueSnapshot = { items: [], pending: 0, failed: 0 };
  const listeners = new Set<() => void>();
  let running: Promise<DrainResult> | null = null;
  let counter = 0;

  const publish = () => {
    const tenant = deps.tenantId();
    const items = all.filter((c) => c.tenantId === tenant);
    const next = { items, pending: items.filter((c) => c.state === "pending").length, failed: items.filter((c) => c.state === "failed").length };
    // Keep the same object while nothing a screen shows has changed, so React does not re-render for nothing.
    const same = (a: QueuedCommand, b: QueuedCommand) => a.id === b.id && a.state === b.state && a.attempts === b.attempts && a.errorCode === b.errorCode;
    if (next.items.length === snapshot.items.length && next.items.every((c, i) => same(c, snapshot.items[i]!))) return;
    snapshot = next;
    for (const l of listeners) l();
  };

  const sortAll = () => all.sort((a, b) => a.seq - b.seq);

  // The disk is the truth: another tab may have added or finished commands since this one last looked.
  const load = async () => {
    all = await deps.store.all();
    sortAll();
    publish();
  };

  let loading: Promise<void> | null = null;
  const ensureLoaded = () => (loading ??= load().catch((e) => {
    loading = null;
    throw e;
  }));

  const drop = async (id: string) => {
    all = all.filter((c) => c.id !== id);
    await deps.store.remove(id);
  };

  const save = async (c: QueuedCommand) => {
    await deps.store.put(c);
  };

  const drainNow = async (): Promise<DrainResult> => {
    let sent = 0;
    let stopped: DrainResult["stopped"] = null;
    let changed = false;
    await exclusive(async () => {
      await load();
      const tenant = deps.tenantId();
      const blocked = new Set<string>();
      for (const c of all.filter((x) => x.state === "failed" && x.tenantId === tenant)) blocked.add(c.orderId);
      for (const cmd of [...all]) {
        if (cmd.tenantId !== tenant || cmd.state !== "pending" || blocked.has(cmd.orderId)) continue;
        try {
          await deps.send(cmd);
          await drop(cmd.id);
          sent++;
          changed = true;
        } catch (e) {
          const code = e instanceof DomainError ? e.code : "INTERNAL";
          if (code === "AUTH_REQUIRED") {
            stopped = "auth";
            break;
          }
          if (TRANSIENT.has(code)) {
            stopped = "network";
            break;
          }
          if (code === "INTERNAL") {
            // The server is having a bad moment; try again later, but not for ever.
            const next = { ...cmd, attempts: cmd.attempts + 1 };
            if (next.attempts >= maxAttempts) {
              Object.assign(next, { state: "failed", errorCode: "INTERNAL" });
              blocked.add(cmd.orderId);
              changed = true;
            } else {
              stopped = "server";
            }
            all = all.map((x) => (x.id === cmd.id ? next : x));
            await save(next);
            if (stopped) break;
            continue;
          }
          // The server answered and said no (order already closed, item sold out, ...): retrying cannot help. Put it aside
          // for a person to look at, and hold back everything else that belongs to the same order.
          const failed: QueuedCommand = { ...cmd, state: "failed", attempts: cmd.attempts + 1, errorCode: code, errorParams: e instanceof DomainError ? e.params : undefined };
          all = all.map((x) => (x.id === cmd.id ? failed : x));
          await save(failed);
          blocked.add(cmd.orderId);
          changed = true;
        }
      }
    });
    publish();
    const result = { sent, stopped };
    if (changed) deps.onSettled?.(result);
    return result;
  };

  return {
    snapshot: () => snapshot,
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    /** Reads what an earlier visit left on disk, once. Call before looking at or adding to the queue. */
    ensureLoaded,
    /** Reads the disk again (another tab may have changed it). */
    load,
    /** The shop signed in or out: what the screens count changes with it. */
    refreshView: publish,

    /** Any command of this order still waiting (or set aside)? Then later ones must queue behind it, not jump ahead. */
    hasFor(orderId: string): boolean {
      const tenant = deps.tenantId();
      return all.some((c) => c.orderId === orderId && c.tenantId === tenant);
    },
    /** Orders with something still to send — the ones whose local version must not be overwritten by a reload. */
    orderIds(): Set<string> {
      const tenant = deps.tenantId();
      return new Set(all.filter((c) => c.tenantId === tenant).map((c) => c.orderId));
    },

    async enqueue(input: Omit<QueuedCommand, "seq" | "createdAt" | "state" | "attempts">): Promise<QueuedCommand> {
      const command: QueuedCommand = { ...input, seq: Date.now() * 1000 + (counter++ % 1000), createdAt: new Date().toISOString(), state: "pending", attempts: 0 };
      // On disk first: a command that is on screen but not saved would be lost by a crash right now.
      await save(command);
      all = [...all, command];
      sortAll();
      publish();
      return command;
    },

    /** Sends what is waiting, in order, one at a time. A second call while one is running joins it. */
    drain(): Promise<DrainResult> {
      running ??= drainNow().finally(() => {
        running = null;
      });
      return running;
    },

    /** Gives up on a command that was refused — and on the ones after it for the same order, which can no longer make sense. */
    async discard(id: string): Promise<void> {
      const target = all.find((c) => c.id === id);
      if (!target) return;
      const doomed = all.filter((c) => c.orderId === target.orderId && c.tenantId === target.tenantId && c.seq >= target.seq);
      for (const c of doomed) await drop(c.id);
      publish();
      deps.onSettled?.({ sent: 0, stopped: null });
    },

    /** Puts a refused command back in line (and the ones held behind it). */
    async retry(id: string): Promise<DrainResult> {
      const target = all.find((c) => c.id === id);
      if (target) {
        const same = all.filter((c) => c.orderId === target.orderId && c.tenantId === target.tenantId && c.state === "failed");
        for (const c of same) {
          const again: QueuedCommand = { ...c, state: "pending", attempts: 0, errorCode: undefined, errorParams: undefined };
          all = all.map((x) => (x.id === c.id ? again : x));
          await save(again);
        }
        publish();
      }
      return this.drain();
    },
  };
}

export type OfflineQueue = ReturnType<typeof createOfflineQueue>;
