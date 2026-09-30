/**
 * Live updates (checklist 5.1). The API tells every open screen of a branch what just happened — an order was
 * paid, a ticket was bumped, stock was received — as a stream of small events with ids only. This module
 * listens, works out which parts of the store that event makes stale, and reads just those again, and only
 * the parts a mounted screen is actually showing.
 */
import { apiBaseUrl, getApiSession, tryRenewSession } from "./http-client";
import { isSliceActive, realtimeStatus, setRealtimeStatus } from "./realtime-status";
import { createSseParser } from "./sse";
import type { Slice } from "./types";

// Where the screens read all of this from is `realtime-status.ts`; it is re-exported so the stream and its users have one address.
export { activeSlices, realtimeStatus, registerActiveSlices, useRealtimeStatus, type RealtimeStatus } from "./realtime-status";

// ---------------------------------------------------------------------------
// What an event makes stale
// ---------------------------------------------------------------------------
const BY_EVENT: [prefix: string, slices: Slice[]][] = [
  ["kitchen.", ["tickets", "orders"]],
  ["order.paid", ["orders", "shifts", "stock", "finance", "reports"]],
  ["order.refunded", ["orders", "shifts", "stock", "finance", "reports"]],
  ["order.", ["orders", "tickets", "reports"]],
  ["shift.", ["shifts", "orders", "reports"]],
  ["menu.availability", ["availability"]],
  ["inventory.goods_received", ["stock", "purchasing", "finance", "reports"]],
  ["inventory.count", ["stock", "counts", "reports"]],
  ["inventory.", ["stock", "reports"]],
  ["purchasing.", ["purchasing", "reports"]],
  ["finance.", ["finance", "orders", "shifts", "reports"]],
  ["subscription.", ["settings", "reports", "billing"]],
  ["branch.", ["settings", "reports"]],
];

/** The slices of the store an event of this type makes out of date (first matching rule wins). */
export function slicesForEvent(type: string): Slice[] {
  for (const [prefix, slices] of BY_EVENT) if (type.startsWith(prefix)) return slices;
  return ["reports"];
}

// ---------------------------------------------------------------------------
// Reading only what changed, and not more often than needed
// ---------------------------------------------------------------------------
/**
 * Collects slices asked for within `windowMs` and reads them together, once. Asks that arrive while a read is
 * running are held and read straight after, so a busy minute is a handful of reads, not one per event.
 */
export function createRefresher(read: (slices: Slice[]) => Promise<void>, windowMs = 250) {
  let wanted = new Set<Slice>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;

  const go = async () => {
    timer = null;
    if (running) return;
    const slices = [...wanted];
    wanted = new Set();
    if (slices.length === 0) return;
    running = true;
    try {
      await read(slices);
    } catch (e) {
      console.warn("live refresh failed", e);
    } finally {
      running = false;
      if (wanted.size > 0) timer = setTimeout(go, windowMs);
    }
  };

  return {
    ask(slices: readonly Slice[]) {
      for (const s of slices) wanted.add(s);
      if (!timer && !running) timer = setTimeout(go, windowMs);
    },
    stop() {
      if (timer) clearTimeout(timer);
      timer = null;
      wanted = new Set();
    },
  };
}

// ---------------------------------------------------------------------------
// The stream itself
// ---------------------------------------------------------------------------
export interface RealtimeOptions {
  branchId: string;
  /** Called with the slices made stale by what happened (already limited to the ones on screen). */
  onStale: (slices: Slice[]) => void;
  /** Called when the stream is back after it was down: things may have happened meanwhile, so everything on screen is read again. */
  onCatchUp: () => void;
  /** Called if the server says this session is no longer any good. */
  onUnauthorized?: () => void;
  fetchImpl?: typeof fetch;
  /** Waits before trying again, in ms: 1s, 2s, 4s, ... up to 30s. */
  backoff?: (attempt: number) => number;
  /** How long a stream may stay silent before it is treated as dead. The server sends a ping every 20 s. */
  stallMs?: number;
}

const defaultBackoff = (attempt: number) => Math.min(1000 * 2 ** attempt, 30_000);

/** Opens the branch's event stream and keeps it open (reconnecting when it drops) until the returned function is called. */
export function startRealtime(opts: RealtimeOptions): () => void {
  const doFetch = opts.fetchImpl ?? fetch;
  const backoff = opts.backoff ?? defaultBackoff;
  const stallMs = opts.stallMs ?? 45_000;
  let current: AbortController | null = null;
  let stopped = false;
  let attempt = 0;
  let wasDown = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let renewedOnce = false;
  const decoder = new TextDecoder();

  const onMessage = (m: { event: string; data: string }) => {
    if (m.event === "ready") {
      attempt = 0;
      renewedOnce = false;
      setRealtimeStatus("live");
      if (wasDown) opts.onCatchUp();
      wasDown = false;
    } else if (m.event === "domain") {
      try {
        const { type } = JSON.parse(m.data) as { type?: string };
        if (type) opts.onStale(slicesForEvent(type).filter((s) => isSliceActive(s)));
      } catch {
        // A message we cannot read is not worth dropping the stream over.
      }
    }
  };

  const connect = async () => {
    if (stopped) return;
    setRealtimeStatus(wasDown ? "offline" : "connecting");
    const { token, tenantId } = getApiSession();
    if (!token) return setRealtimeStatus("off");
    const mine = new AbortController();
    current = mine;
    let lastByteAt = Date.now();
    // A connection can die without telling anyone (Wi-Fi that stops answering): no bytes, not even a ping, means dead.
    const watchdog = setInterval(() => {
      if (Date.now() - lastByteAt > stallMs) mine.abort();
    }, Math.max(Math.min(stallMs / 3, 5000), 10));
    try {
      const url = new URL("/v1/events", apiBaseUrl());
      url.searchParams.set("branchId", opts.branchId);
      const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: "text/event-stream" };
      if (tenantId) headers["X-Tenant-Id"] = tenantId;
      const res = await doFetch(url, { headers, signal: mine.signal });
      // The token may simply have run out: renew it and connect again before deciding the session is over.
      if (res.status === 401 && !renewedOnce) {
        renewedOnce = true;
        if (await tryRenewSession()) {
          retryTimer = setTimeout(connect, 0);
          return;
        }
      }
      if (res.status === 401 || res.status === 403) {
        stopped = true;
        setRealtimeStatus("off");
        opts.onUnauthorized?.();
        return;
      }
      if (!res.ok || !res.body) throw new Error(`event stream answered ${res.status}`);
      const parse = createSseParser(onMessage);
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        lastByteAt = Date.now();
        parse(decoder.decode(value, { stream: true }));
      }
    } catch {
      // Dropped, refused, unreachable, or given up on: all handled the same way below.
    } finally {
      clearInterval(watchdog);
    }
    if (stopped) return;
    wasDown = true;
    setRealtimeStatus("offline");
    retryTimer = setTimeout(connect, backoff(attempt++));
  };

  // The browser knows before the stream does: when the network goes, say so at once; when it returns, do not wait out the back-off.
  const onOffline = () => {
    if (!stopped) current?.abort();
  };
  const onOnline = () => {
    if (stopped || realtimeStatus() === "live") return;
    if (retryTimer) clearTimeout(retryTimer);
    void connect();
  };
  if (typeof window !== "undefined") {
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
  }

  void connect();
  return () => {
    stopped = true;
    current?.abort();
    if (retryTimer) clearTimeout(retryTimer);
    if (typeof window !== "undefined") {
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    }
    setRealtimeStatus("off");
  };
}
