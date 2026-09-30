import { redactFields, redactText, scrubUrl } from "./redact";

export interface ErrorContext {
  requestId?: string;
  /** A domain error code, or the HTTP status. */
  code?: string;
  route?: string;
  method?: string;
  url?: string;
  tenantId?: string;
  /** A pseudonymous id (a membership id), never a name or an email. */
  actorId?: string;
  extra?: Record<string, unknown>;
}

export interface EventBase {
  release: string | null;
  environment: string;
  platform: "node" | "javascript";
  service: string;
}

interface Frame {
  function?: string;
  filename: string;
  lineno?: number;
  colno?: number;
}

/** "at fn (file:1:2)", "at async fn (file:1:2)", "at file:1:2" (V8), oldest call first as Sentry wants it. */
export function parseStack(stack: string | undefined): Frame[] {
  if (!stack) return [];
  const frames: Frame[] = [];
  for (const line of stack.split("\n")) {
    const m = /^\s*at\s+(?:async\s+)?(?:(.*?)\s+\()?(.*?):(\d+):(\d+)\)?\s*$/.exec(line);
    if (!m) continue;
    const filename = (m[2] ?? "")
      .replace(/^file:\/\//, "")
      .replace(/[?#].*$/, "")
      // A path on somebody's machine is not for a report: keep from the repository (or dependency) on.
      .replace(/^.*?\/(apps|packages)\//, "app:///$1/")
      .replace(/^.*?\/node_modules\//, "app:///node_modules/");
    frames.push({ ...(m[1] ? { function: m[1] } : {}), filename, lineno: Number(m[3]), colno: Number(m[4]) });
  }
  return frames.reverse();
}

const isPostgresError = (e: unknown): e is { code: string; constraint_name?: string; table_name?: string } =>
  typeof e === "object" && e !== null && typeof (e as { code?: unknown }).code === "string" && "severity" in e && "routine" in e;

/** The type and message of an error, safe to send. A database error's message and detail carry the row's values, so only its code goes. */
export function describeError(err: unknown): { type: string; value: string } {
  if (isPostgresError(err)) {
    return { type: "PostgresError", value: `SQLSTATE ${err.code}${err.constraint_name ? ` (${err.constraint_name})` : ""}${err.table_name ? ` on ${err.table_name}` : ""}` };
  }
  if (err instanceof Error) return { type: err.name || "Error", value: redactText(err.message) };
  return { type: "NonError", value: redactText(typeof err === "string" ? err : JSON.stringify(redactFields(err)) ?? String(err)) };
}

function hex(bytes: number): string {
  const a = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function buildEvent(err: unknown, ctx: ErrorContext, base: EventBase, now: Date = new Date()) {
  const { type, value } = describeError(err);
  const frames = parseStack(err instanceof Error ? err.stack : undefined);
  const first = frames.at(-1);
  return {
    event_id: hex(16),
    timestamp: now.getTime() / 1000,
    platform: base.platform,
    level: "error",
    ...(base.release ? { release: base.release } : {}),
    environment: base.environment,
    tags: {
      service: base.service,
      ...(ctx.code ? { code: ctx.code } : {}),
      ...(ctx.route ? { route: ctx.route } : {}),
      ...(ctx.requestId ? { request_id: ctx.requestId } : {}),
      ...(ctx.tenantId ? { tenant_id: ctx.tenantId } : {}),
    },
    ...(ctx.actorId ? { user: { id: ctx.actorId } } : {}),
    // The URL and method only: never headers, cookies or a body.
    ...(ctx.url || ctx.method ? { request: { ...(ctx.url ? { url: scrubUrl(ctx.url) } : {}), ...(ctx.method ? { method: ctx.method } : {}) } } : {}),
    ...(ctx.extra ? { extra: redactFields(ctx.extra) } : {}),
    exception: { values: [{ type, value, ...(frames.length ? { stacktrace: { frames } } : {}) }] },
    // Two reports with the same kind of error from the same place are one problem.
    fingerprint: [type, first ? `${first.filename}:${first.lineno}` : value.slice(0, 80)],
  };
}

export type SentryEvent = ReturnType<typeof buildEvent>;

/** The Sentry envelope: a header line, an item header line, the event. */
export function buildEnvelope(event: SentryEvent, dsn: string, now: Date = new Date()): string {
  return [JSON.stringify({ event_id: event.event_id, sent_at: now.toISOString(), dsn }), JSON.stringify({ type: "event" }), JSON.stringify(event)].join("\n");
}
