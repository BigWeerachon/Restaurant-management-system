import { describe, expect, it, vi } from "vitest";
import { parseDsn } from "../src/dsn";
import { buildEnvelope, buildEvent, describeError, parseStack } from "../src/envelope";
import { createErrorReporter } from "../src/reporter";

const DSN = "https://publickey123@o1.ingest.example.io/4501";
const base = { release: "abc123", environment: "test", platform: "node" as const, service: "sabai-api" };

describe("the DSN", () => {
  it("is the Sentry shape, and anything else is no DSN at all", () => {
    expect(parseDsn(DSN)).toEqual({ endpoint: "https://o1.ingest.example.io/api/4501/envelope/", publicKey: "publickey123", projectId: "4501" });
    expect(parseDsn("https://k@errors.example.com:8443/sentry/7")).toEqual({ endpoint: "https://errors.example.com:8443/sentry/api/7/envelope/", publicKey: "k", projectId: "7" });
    for (const bad of [undefined, null, "", "not a url", "https://example.com/1", "https://k@example.com", "ftp://k@example.com/1"]) expect(parseDsn(bad as never), String(bad)).toBeNull();
  });
});

describe("what an error report says", () => {
  function boom() {
    return new TypeError("cannot read x of undefined for a@b.com");
  }

  it("has the kind of error, where it happened, and what request it was — and nothing about the person", () => {
    const e = boom();
    const ev = buildEvent(e, { requestId: "r-1", code: "INTERNAL", route: "/v1/orders/:id/pay", method: "POST", url: "https://api.example.com/v1/orders/1/pay?token=abc", tenantId: "t-1", actorId: "m-1", extra: { pin: "1234", note: "call 0891234567" } }, base, new Date("2026-10-01T00:00:00Z"));
    expect(ev.exception.values[0]!.type).toBe("TypeError");
    expect(ev.exception.values[0]!.value).toBe("cannot read x of undefined for [email]");
    expect(ev.exception.values[0]!.stacktrace!.frames.length).toBeGreaterThan(0);
    expect(ev.tags).toEqual({ service: "sabai-api", code: "INTERNAL", route: "/v1/orders/:id/pay", request_id: "r-1", tenant_id: "t-1" });
    expect(ev.user).toEqual({ id: "m-1" });
    expect(ev.request).toEqual({ url: "https://api.example.com/v1/orders/1/pay", method: "POST" });
    expect(ev.extra).toEqual({ pin: "[redacted]", note: "call [number]" });
    expect(ev.release).toBe("abc123");
    expect(ev.timestamp).toBe(new Date("2026-10-01T00:00:00Z").getTime() / 1000);
    expect(ev.event_id).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(ev)).not.toMatch(/a@b\.com|0891234567|token=abc/);
  });

  it("sends a database error's code and constraint, never its message (that has the row's values in it)", () => {
    const pg = Object.assign(new Error('new row for relation "orders" violates check constraint "x"; Failing row contains (Somchai, 0891234567)'), {
      name: "PostgresError",
      code: "23514",
      severity: "ERROR",
      routine: "ExecConstraints",
      constraint_name: "orders_total_check",
      table_name: "orders",
    });
    expect(describeError(pg)).toEqual({ type: "PostgresError", value: "SQLSTATE 23514 (orders_total_check) on orders" });
    expect(JSON.stringify(buildEvent(pg, {}, base))).not.toMatch(/Somchai|0891234567|Failing row/);
  });

  it("reads a V8 stack oldest-call-first, without a path from anyone's machine", () => {
    const frames = parseStack(["TypeError: x", "    at handler (/home/alice/work/repo/apps/api/src/routes/pos.ts:42:9)", "    at async next (/home/alice/work/repo/node_modules/hono/dist/compose.js:10:3)", "    at file:///home/alice/work/repo/packages/domain/src/x.ts:1:2"].join("\n"));
    expect(frames.map((f) => f.filename)).toEqual(["app:///packages/domain/src/x.ts", "app:///node_modules/hono/dist/compose.js", "app:///apps/api/src/routes/pos.ts"]);
    expect(frames.at(-1)).toMatchObject({ function: "handler", lineno: 42, colno: 9 });
    expect(JSON.stringify(frames)).not.toContain("alice");
  });

  it("copes with things that are not errors", () => {
    expect(describeError("plain string with a@b.com")).toEqual({ type: "NonError", value: "plain string with [email]" });
    expect(describeError({ pin: "1", x: 2 }).value).toContain("[redacted]");
    expect(describeError(undefined).type).toBe("NonError");
  });

  it("wraps the event in a Sentry envelope", () => {
    const ev = buildEvent(new Error("x"), {}, base);
    const [head, item, body] = buildEnvelope(ev, DSN, new Date("2026-10-01T00:00:00Z")).split("\n");
    expect(JSON.parse(head!)).toEqual({ event_id: ev.event_id, sent_at: "2026-10-01T00:00:00.000Z", dsn: DSN });
    expect(JSON.parse(item!)).toEqual({ type: "event" });
    expect(JSON.parse(body!).event_id).toBe(ev.event_id);
  });
});

describe("the reporter", () => {
  const make = (over: Partial<Parameters<typeof createErrorReporter>[0]> = {}) => {
    const fetch = vi.fn(async () => new Response("ok"));
    let t = 1_000_000;
    const drops: string[] = [];
    const r = createErrorReporter({ dsn: DSN, environment: "test", service: "sabai-api", release: "r1", fetch: fetch as never, now: () => new Date(t), onDrop: (why) => drops.push(why), ...over });
    return { r, fetch, drops, tick: (ms: number) => (t += ms) };
  };

  it("does nothing without a DSN — the default, and what the demo on Vercel runs with", async () => {
    const fetch = vi.fn();
    for (const dsn of [undefined, null, "", "garbage"]) {
      const r = createErrorReporter({ dsn, environment: "x", service: "s", fetch: fetch as never });
      expect(r.enabled).toBe(false);
      r.capture(new Error("x"));
      await r.flush();
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("posts one envelope with the public key, to the project's endpoint", async () => {
    const { r, fetch } = make();
    r.capture(new Error("boom"), { requestId: "r-1" });
    await r.flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe("https://o1.ingest.example.io/api/4501/envelope/");
    expect(init.method).toBe("POST");
    expect(init.headers["content-type"]).toBe("application/x-sentry-envelope");
    expect(init.headers["x-sentry-auth"]).toContain("sentry_key=publickey123");
    expect(String(init.body)).toContain('"request_id":"r-1"');
  });

  it("sends the same problem once a minute, not once a request", async () => {
    const { r, fetch, drops, tick } = make();
    const fail = () => r.capture(new Error("boom"));
    for (let i = 0; i < 5; i++) fail();
    await r.flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(drops).toEqual(["duplicate", "duplicate", "duplicate", "duplicate"]);
    tick(61_000);
    fail();
    await r.flush();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("caps a storm of different failures, then carries on when it has passed", async () => {
    const { r, fetch, drops, tick } = make({ maxPerMinute: 3 });
    for (let i = 0; i < 6; i++) r.capture(Object.assign(new Error(`e${i}`), { name: `Error${i}` }));
    await r.flush();
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(drops.filter((d) => d === "rate_limit")).toHaveLength(3);
    tick(61_000);
    r.capture(Object.assign(new Error("later"), { name: "Later" }));
    await r.flush();
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("never throws, whatever goes wrong — the network, or the thing being reported", async () => {
    const { r, drops } = make({ fetch: (async () => Promise.reject(new Error("offline"))) as never });
    expect(() => r.capture(new Error("boom"))).not.toThrow();
    const hostile = { get message(): string { throw new Error("nope"); }, get stack(): string { throw new Error("nope"); } };
    expect(() => r.capture(hostile)).not.toThrow();
    expect(() => r.capture(null)).not.toThrow();
    await r.flush();
    expect(drops).toContain("network");
  });

  it("does not wait forever on flush", async () => {
    const { r } = make({ fetch: (() => new Promise(() => {})) as never });
    r.capture(new Error("boom"));
    const t0 = Date.now();
    await r.flush(50);
    expect(Date.now() - t0).toBeLessThan(500);
  });
});
