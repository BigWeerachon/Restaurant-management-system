/**
 * The one offline queue of this browser, wired to the real API and to the signed-in session, plus the hook the
 * screens use to show it. The logic itself is in `offline-queue.ts`.
 */
import { useSyncExternalStore } from "react";
import { apiFetch, getApiSession } from "./http-client";
import { createOfflineQueue, defaultStore, type DrainResult, type OfflineQueue, type QueueSnapshot } from "./offline-queue";

const EMPTY: QueueSnapshot = { items: [], pending: 0, failed: 0 };

let queue: OfflineQueue | null = null;
const settledListeners = new Set<(result: DrainResult) => void>();

/** Called after the queue changed something on the server (or set a command aside): time to read the screens again. */
export function onQueueSettled(fn: (result: DrainResult) => void): () => void {
  settledListeners.add(fn);
  return () => settledListeners.delete(fn);
}

/** Made on first use (IndexedDB does not exist while the server renders a page). */
export function offlineQueue(): OfflineQueue {
  queue ??= createOfflineQueue({
    store: defaultStore(),
    tenantId: () => getApiSession().tenantId,
    onSettled: (result) => {
      for (const l of settledListeners) l(result);
    },
    send: async (command) => {
      await apiFetch(command.path, { method: "POST", body: command.body, idempotencyKey: command.id });
    },
    // Only one tab at a time replays the queue; the others see the result when they read the disk again.
    exclusive: async <T>(fn: () => Promise<T>): Promise<T> => {
      if (typeof navigator === "undefined" || !navigator.locks) return fn();
      return (await navigator.locks.request("sabai-offline-queue", fn)) as T;
    },
  });
  return queue;
}

/** Orders that still have something waiting to be sent: their local version is newer than the server's. */
export function queuedOrderIds(): Set<string> {
  return queue ? queue.orderIds() : new Set();
}

export function useOfflineQueue(): QueueSnapshot {
  return useSyncExternalStore(
    (l) => offlineQueue().subscribe(l),
    () => (queue ? queue.snapshot() : EMPTY),
    () => EMPTY,
  );
}

/** Tests start each case from an empty queue. */
export function resetOfflineQueueForTests() {
  queue = null;
  settledListeners.clear();
}
