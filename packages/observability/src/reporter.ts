import { buildEnvelope, buildEvent, type ErrorContext, type EventBase, type SentryEvent } from "./envelope";
import { parseDsn } from "./dsn";

export interface ErrorReporter {
  readonly enabled: boolean;
  /** Fire and forget: never throws, never waits, never lets reporting break the thing being reported. */
  capture(err: unknown, ctx?: ErrorContext): void;
  /** Waits for what has been queued (before the process exits). */
  flush(timeoutMs?: number): Promise<void>;
}

export interface ReporterOptions extends Partial<Pick<EventBase, "release" | "platform">> {
  dsn: string | null | undefined;
  environment: string;
  service: string;
  fetch?: typeof fetch;
  now?: () => Date;
  /** A burst of failures is one incident, not a thousand reports (default 20 a minute). */
  maxPerMinute?: number;
  /** The same problem again within this many seconds is counted, not sent (default 60). */
  dedupeSeconds?: number;
  /** Told whenever a report is not sent (rate limit, duplicate, network), for a log line or a counter. */
  onDrop?: (reason: "rate_limit" | "duplicate" | "network", ctx: ErrorContext | undefined) => void;
}

const NOOP: ErrorReporter = { enabled: false, capture() {}, async flush() {} };

/** Reports unexpected errors to a Sentry-compatible endpoint. With no (or an unreadable) DSN it does nothing. */
export function createErrorReporter(opts: ReporterOptions): ErrorReporter {
  const dsn = parseDsn(opts.dsn);
  if (!dsn || !opts.dsn) return NOOP;
  const doFetch = opts.fetch ?? globalThis.fetch;
  const now = opts.now ?? (() => new Date());
  const max = opts.maxPerMinute ?? 20;
  const dedupeMs = (opts.dedupeSeconds ?? 60) * 1000;
  const base: EventBase = { release: opts.release ?? null, environment: opts.environment, platform: opts.platform ?? "node", service: opts.service };
  const sent: number[] = [];
  const seen = new Map<string, number>();
  const pending = new Set<Promise<unknown>>();

  const send = (event: SentryEvent, ctx: ErrorContext | undefined) => {
    const p = Promise.resolve()
      .then(() =>
        doFetch(dsn.endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/x-sentry-envelope",
            "x-sentry-auth": `Sentry sentry_version=7, sentry_client=sabai/1.0, sentry_key=${dsn.publicKey}`,
          },
          body: buildEnvelope(event, opts.dsn!, now()),
          keepalive: true,
          ...(typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? { signal: AbortSignal.timeout(3000) } : {}),
        }),
      )
      .catch(() => opts.onDrop?.("network", ctx));
    pending.add(p);
    void p.finally(() => pending.delete(p));
  };

  return {
    enabled: true,
    capture(err, ctx) {
      try {
        const at = now().getTime();
        const event = buildEvent(err, ctx ?? {}, base, now());
        const key = event.fingerprint.join("|");
        const last = seen.get(key);
        if (last !== undefined && at - last < dedupeMs) return opts.onDrop?.("duplicate", ctx);
        while (sent.length && at - sent[0]! > 60_000) sent.shift();
        if (sent.length >= max) return opts.onDrop?.("rate_limit", ctx);
        seen.set(key, at);
        if (seen.size > 200) for (const [k, t] of seen) if (at - t >= dedupeMs) seen.delete(k);
        sent.push(at);
        send(event, ctx);
      } catch {
        // Reporting must never be the thing that fails.
      }
    },
    async flush(timeoutMs = 2000) {
      await Promise.race([Promise.allSettled([...pending]), new Promise((r) => setTimeout(r, timeoutMs))]);
    },
  };
}
