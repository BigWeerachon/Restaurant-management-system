import { context, metrics, propagation, SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import type { MiddlewareHandler } from "hono";
import type { Env } from "../http";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The route pattern that answered (`/v1/orders/:id/pay`), not the URL: a metric labelled with ids would never stop growing. */
export function routeLabel(matched: readonly { method: string; path: string }[], status: number): string {
  const handler = [...matched].reverse().find((m) => m.method !== "ALL");
  return handler?.path ?? (status === 404 ? "unmatched" : "unknown");
}

export const tracer = () => trace.getTracer("sabai-api", "1.0.0");
export const meter = () => metrics.getMeter("sabai-api", "1.0.0");

/** Every failure an API answer carries, by its domain code (`BILLING_RESTRICTED`, `PLAN_LIMIT_REACHED`, `INTERNAL`…): what a dashboard alerts on. */
export function countError(code: string, route: string): void {
  meter().createCounter("sabai.api.errors", { description: "API error responses by domain code" }).add(1, { code, route });
}

/**
 * One server span and the standard request metrics per call. Continues the caller's trace when it sent a
 * `traceparent` header. Attributes are ids and patterns only — never a body, a header, a query string or a name.
 */
export function observe(): MiddlewareHandler<Env> {
  const duration = meter().createHistogram("http.server.request.duration", {
    unit: "s",
    description: "How long the API took to answer",
    advice: { explicitBucketBoundaries: [0.005, 0.01, 0.025, 0.05, 0.1, 0.2, 0.5, 1, 2.5, 5, 10] },
  });
  const inFlight = meter().createUpDownCounter("http.server.active_requests", { description: "Requests being answered right now" });

  return async (c, next) => {
    const started = performance.now();
    const headers: Record<string, string> = {};
    c.req.raw.headers.forEach((v, k) => {
      headers[k] = v;
    });
    const parent = propagation.extract(context.active(), headers);
    const method = c.req.method;
    const span = tracer().startSpan(`${method} ${c.req.path}`, { kind: SpanKind.SERVER, attributes: { "http.request.method": method, "sabai.request_id": c.get("requestId") } }, parent);
    inFlight.add(1, { "http.request.method": method });
    try {
      await context.with(trace.setSpan(parent, span), next);
    } catch (error) {
      span.recordException(error instanceof Error ? error : new Error("non-error thrown"));
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      const status = c.res.status;
      const route = routeLabel(c.req.matchedRoutes, status);
      const tenant = c.req.header("x-tenant-id");
      const actor = c.get("actor");
      span.updateName(`${method} ${route}`);
      span.setAttributes({
        "http.route": route,
        "http.response.status_code": status,
        ...(tenant && UUID.test(tenant) ? { "sabai.tenant_id": tenant } : {}),
        ...(actor ? { "sabai.actor_id": actor.membershipId ?? actor.userId ?? "" } : {}),
      });
      // A 4xx is the caller's doing (a wrong PIN, a plan limit); only the server's own failures mark the span as failed.
      if (status >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
      span.end();
      inFlight.add(-1, { "http.request.method": method });
      duration.record((performance.now() - started) / 1000, { "http.request.method": method, "http.route": route, "http.response.status_class": `${Math.floor(status / 100)}xx` });
    }
  };
}
