import { metrics, trace } from "@opentelemetry/api";
import { AggregationTemporality, InMemoryMetricExporter, MeterProvider, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { loadConfig } from "../src/config";
import { createLogger } from "../src/logger";
import { routeLabel } from "../src/observability/instrument";
import { startTelemetry, type Telemetry } from "../src/observability/telemetry";
import { createTestContext } from "./helpers";

const spans = new InMemorySpanExporter();
const metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
const reader = new PeriodicExportingMetricReader({ exporter: metricExporter, exportIntervalMillis: 60_000 });
let telemetry: Telemetry;
let ctx: Awaited<ReturnType<typeof createTestContext>>;

// Set up before the app exists: the app's instruments are created with whatever provider is there at that moment.
beforeAll(async () => {
  metrics.setGlobalMeterProvider(new MeterProvider({ readers: [reader] }));
  telemetry = await startTelemetry(
    { serviceName: "sabai-api-test", environment: "test", release: "r-test", otlpEndpoint: null, traceSampleRatio: 1, errorDsn: null },
    { spanProcessors: [new SimpleSpanProcessor(spans)] },
  );
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.close();
  await telemetry.shutdown();
});

const finished = () => spans.getFinishedSpans();
const attr = (s: { attributes: Record<string, unknown> }, k: string) => s.attributes[k];

describe("what the API tells the outside world about itself", () => {
  it("is off when no collector is configured, and costs nothing", async () => {
    const off = await startTelemetry({ serviceName: "x", environment: "test", release: null, otlpEndpoint: null, traceSampleRatio: 1, errorDsn: null });
    expect(off.enabled).toBe(false);
    await off.shutdown();
    expect(telemetry.enabled).toBe(true);
  });

  it("makes one server span per request, named for the route that answered — never for the ids in the URL", async () => {
    spans.reset();
    const call = ctx.client();
    await call("GET", "/health");
    await call("POST", "/v1/billing/invoices/0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b/void", {});
    await call("GET", "/nothing-here");
    const server = finished().filter((s) => attr(s, "http.request.method"));
    const names = server.map((s) => s.name);
    expect(names).toEqual(["GET /health", "POST /v1/billing/invoices/:id/void", "GET unmatched"]);
    expect(server.map((s) => attr(s, "http.response.status_code"))).toEqual([200, 401, 404]);
    expect(server.map((s) => attr(s, "http.route"))).toEqual(["/health", "/v1/billing/invoices/:id/void", "unmatched"]);
    // Only a server's own failure marks a span as failed; a 401 or a 404 is the caller's.
    expect(server.every((s) => s.status.code !== 2)).toBe(true);
    expect(JSON.stringify(server.map((s) => s.attributes))).not.toContain("0190a1b2");
  });

  it("carries ids and patterns only — no query string, no body, no header", async () => {
    spans.reset();
    await ctx.client()("GET", "/health?token=abc123&pin=1234", undefined, { authorization: "Bearer very.secret.value", "x-device-token": "sbd_supersecretsupersecret" });
    const dump = JSON.stringify(finished().map((s) => ({ n: s.name, a: s.attributes })));
    expect(dump).not.toMatch(/abc123|1234|very\.secret|sbd_super/);
  });

  it("continues the caller's trace when it sends a traceparent", async () => {
    spans.reset();
    const traceId = "4bf92f3577b34da6a3ce929d0e0e4736";
    await ctx.client()("GET", "/health", undefined, { traceparent: `00-${traceId}-00f067aa0ba902b7-01` });
    const s = finished().find((x) => attr(x, "http.request.method"))!;
    expect(s.spanContext().traceId).toBe(traceId);
    expect(s.parentSpanContext?.spanId).toBe("00f067aa0ba902b7");
  });

  it("times the database inside the request that asked for it, and records the shop and the person by id", async () => {
    const owner = await ctx.newUser();
    spans.reset();
    const r = await ctx.client(owner.token)("POST", "/v1/tenants", { name: "ร้านวัดผล", businessType: "cafe", ownerName: "คุณเอ" });
    expect(r.status).toBe(201);
    const all = finished();
    const request = all.find((s) => attr(s, "http.route") === "/v1/tenants")!;
    const db = all.filter((s) => s.name === "db.transaction");
    expect(db.length).toBeGreaterThan(0);
    expect(db.every((s) => s.spanContext().traceId === request.spanContext().traceId)).toBe(true);
    expect(db.some((s) => s.parentSpanContext?.spanId === request.spanContext().spanId)).toBe(true);
    expect(attr(request, "sabai.actor_id")).toBe(owner.id);
    // A refusal the person can act on is not the database's fault.
    spans.reset();
    const call = ctx.client(owner.token, r.json.tenant_id);
    const denied = await call("GET", "/v1/billing");
    expect(denied.status).toBe(200);
    const bad = await call("POST", "/v1/branches", { code: "x", name: "y" });
    expect(bad.status).toBe(422);
    expect(finished().filter((s) => s.name === "db.transaction").every((s) => s.status.code !== 2)).toBe(true);
  });

  it("counts requests by route, method and status class, and errors by domain code", async () => {
    await ctx.client()("GET", "/v1/me");
    await ctx.client()("GET", "/health");
    await reader.forceFlush();
    const all = metricExporter.getMetrics().flatMap((r) => r.scopeMetrics.flatMap((s) => s.metrics));
    const duration = all.find((m) => m.descriptor.name === "http.server.request.duration")!;
    expect(duration.descriptor.unit).toBe("s");
    const points = duration.dataPoints.map((p) => ({ ...p.attributes, count: (p.value as { count: number }).count }));
    expect(points).toEqual(expect.arrayContaining([expect.objectContaining({ "http.route": "/health", "http.response.status_class": "2xx" }), expect.objectContaining({ "http.route": "/v1/me", "http.response.status_class": "4xx" })]));
    const errors = all.find((m) => m.descriptor.name === "sabai.api.errors")!;
    expect(errors.dataPoints.some((p) => p.attributes.code === "AUTH_REQUIRED" && p.attributes.route === "/v1/me")).toBe(true);
    // No metric is labelled by an id, a tenant or a person: the number of series stays small.
    expect(JSON.stringify(all.map((m) => m.dataPoints.map((p) => p.attributes)))).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });
});

describe("what goes wrong, and who hears about it", () => {
  it("logs and reports an unexpected failure with the request's id — and tells the caller nothing technical", async () => {
    const lines: string[] = [];
    const captured: { err: unknown; ctx: object }[] = [];
    const broken = new Proxy(ctx.sql, { apply: () => Promise.reject(new Error("connection to db.internal:5432 refused for owner@example.com")) });
    const app = createApp({
      ...ctx.deps,
      sql: broken as never,
      log: createLogger({ sink: (l) => lines.push(l) }),
      reporter: { enabled: true, capture: (err, c) => captured.push({ err, ctx: c ?? {} }), flush: async () => {} },
    });
    const res = await app.request("/health?secret=1", { headers: { "x-request-id": "req-abcdef12" } });
    const body = (await res.json()) as { error: { code: string; message: string; reference: string } };
    expect(res.status).toBe(500);
    expect(body.error.code).toBe("INTERNAL");
    expect(JSON.stringify(body)).not.toMatch(/db\.internal|owner@|refused|secret/);
    expect(captured).toHaveLength(1);
    expect(captured[0]!.ctx).toMatchObject({ requestId: "req-abcdef12", code: "INTERNAL", route: "/health", method: "GET" });
    const logged = lines.map((l) => JSON.parse(l)).find((l) => l.msg === "unhandled");
    expect(logged).toMatchObject({ level: "error", requestId: "req-abcdef12", route: "/health" });
    // The log has what an engineer needs; the address in it is masked.
    expect(JSON.stringify(logged)).not.toContain("owner@example.com");
    expect(JSON.stringify(logged)).toContain("[email]");
  });

  it("does not report what the caller did wrong (a wrong PIN, a plan limit, a missing sign-in)", async () => {
    const captured: unknown[] = [];
    const app = createApp({ ...ctx.deps, reporter: { enabled: true, capture: (e) => captured.push(e), flush: async () => {} } });
    expect((await app.request("/v1/me")).status).toBe(401);
    expect((await app.request("/nope")).status).toBe(404);
    expect(captured).toEqual([]);
  });
});

describe("structured logs", () => {
  it("never puts a credential in a line, however carelessly it is logged", () => {
    const lines: string[] = [];
    const log = createLogger({ sink: (l) => lines.push(l), service: "sabai-api" });
    log.info("oops", { headers: { authorization: "Bearer abc.def.ghi", "x-device-token": "sbd_abcdefghijklmnopqrstu" }, pin: "1234", note: "call 0891234567", ok: "fine" });
    const line = JSON.parse(lines[0]!);
    expect(line).toMatchObject({ level: "info", msg: "oops", service: "sabai-api", ok: "fine", pin: "[redacted]", note: "call [number]" });
    expect(line.headers.authorization).toBe("[redacted]");
    expect(lines[0]).not.toMatch(/abc\.def|sbd_abc|1234"|0891234567/);
    expect(new Date(line.time).getTime()).not.toBeNaN();
  });

  it("carries the trace's ids while a span is active, so a line can be found from a trace and back", () => {
    const lines: string[] = [];
    const log = createLogger({ sink: (l) => lines.push(l) });
    trace.getTracer("t").startActiveSpan("work", (span) => {
      log.info("inside");
      span.end();
    });
    log.info("outside");
    const [inside, outside] = lines.map((l) => JSON.parse(l));
    expect(inside.trace_id).toMatch(/^[0-9a-f]{32}$/);
    expect(inside.span_id).toMatch(/^[0-9a-f]{16}$/);
    expect(outside.trace_id).toBeUndefined();
  });

  it("stays silent when asked", () => {
    const lines: string[] = [];
    createLogger({ silent: true, sink: (l) => lines.push(l) }).error("x");
    expect(lines).toEqual([]);
  });
});

describe("observability configuration", () => {
  it("is all off by default", () => {
    expect(loadConfig({}).observability).toEqual({ serviceName: "sabai-api", environment: "development", release: null, otlpEndpoint: null, traceSampleRatio: 1, errorDsn: null });
  });

  it("reads the standard OpenTelemetry names, a Sentry-style DSN, and a release from the platform", () => {
    const c = loadConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: " https://otlp.example.com ", OTEL_SERVICE_NAME: "sabai-api-eu", ERROR_TRACKING_DSN: "https://k@errors.example.com/1", VERCEL_GIT_COMMIT_SHA: "abc123", NODE_ENV: "production", JWT_SECRET: "x".repeat(32) }).observability;
    expect(c).toEqual({ serviceName: "sabai-api-eu", environment: "production", release: "abc123", otlpEndpoint: "https://otlp.example.com", traceSampleRatio: 1, errorDsn: "https://k@errors.example.com/1" });
    expect(loadConfig({ SENTRY_DSN: "https://k@s.example.com/2" }).observability.errorDsn).toBe("https://k@s.example.com/2");
    expect(loadConfig({ RELEASE: "v1", GIT_SHA: "zzz" }).observability.release).toBe("v1");
  });

  it("keeps the sampling ratio between 0 and 1, and reads nonsense as 0 rather than crashing", () => {
    expect(loadConfig({ OTEL_TRACES_SAMPLE_RATIO: "0.25" }).observability.traceSampleRatio).toBe(0.25);
    expect(loadConfig({ OTEL_TRACES_SAMPLE_RATIO: "7" }).observability.traceSampleRatio).toBe(1);
    expect(loadConfig({ OTEL_TRACES_SAMPLE_RATIO: "-1" }).observability.traceSampleRatio).toBe(0);
    expect(loadConfig({ OTEL_TRACES_SAMPLE_RATIO: "abc" }).observability.traceSampleRatio).toBe(0);
  });
});

describe("route labels", () => {
  it("are the last handler's pattern, ignoring middleware", () => {
    expect(routeLabel([{ method: "ALL", path: "*" }, { method: "ALL", path: "/v1/*" }, { method: "POST", path: "/v1/orders/:id/pay" }], 200)).toBe("/v1/orders/:id/pay");
    expect(routeLabel([{ method: "ALL", path: "*" }], 404)).toBe("unmatched");
    expect(routeLabel([{ method: "ALL", path: "*" }], 500)).toBe("unknown");
  });
});
