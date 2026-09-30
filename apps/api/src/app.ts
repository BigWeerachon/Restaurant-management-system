import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { verifyToken } from "./auth";
import { ApiFailure, toErrorResponse } from "./errors";
import { openApiDocument, type Deps, type Env } from "./http";
import { registerBilling } from "./routes/billing";
import { registerCatalog } from "./routes/catalog";
import { registerDevAuth } from "./routes/dev-auth";
import { registerFinance } from "./routes/finance";
import { registerDevices } from "./routes/devices";
import { registerIdentity } from "./routes/identity";
import { registerInventory } from "./routes/inventory";
import { registerKitchen } from "./routes/kitchen";
import { registerPos } from "./routes/pos";
import { registerReports } from "./routes/reports";
import { registerSettings } from "./routes/settings";
import { registerShop } from "./routes/shop";

/**
 * Modular monolith: one deployable, modules separated by route files and by
 * the database commands they call. Each module can be split into its own
 * service later behind the same URL space (see docs/04-architecture.md).
 */
export function createApp(deps: Deps): Hono<Env> {
  const app = new Hono<Env>();

  app.use("*", async (c, next) => {
    const incoming = c.req.header("x-request-id");
    const requestId = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
    c.set("requestId", requestId);
    c.set("locale", c.req.header("accept-language")?.toLowerCase().startsWith("en") ? "en" : "th");
    c.set("actor", null);
    c.header("X-Request-Id", requestId);
    const started = performance.now();
    await next();
    deps.log.info("request", {
      requestId,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: Math.round(performance.now() - started),
    });
  });

  app.use("*", secureHeaders());
  app.use(
    "*",
    cors({
      origin: deps.config.corsOrigins,
      allowHeaders: ["Authorization", "Content-Type", "X-Tenant-Id", "Idempotency-Key", "X-Request-Id", "Accept-Language", "X-Device-Token"],
      exposeHeaders: ["X-Request-Id", "Idempotent-Replayed"],
      maxAge: 600,
    }),
  );

  app.use("/v1/*", async (c, next) => {
    const header = c.req.header("authorization");
    if (header?.startsWith("Bearer ")) {
      c.set("actor", await verifyToken(header.slice(7), deps.config.jwtSecret));
    }
    await next();
  });

  app.onError((err, c) => {
    const requestId = c.get("requestId") ?? randomUUID();
    const { status, body, internal } = toErrorResponse(err, requestId, c.get("locale") ?? "th");
    if (internal) {
      deps.log.error("unhandled", { requestId, error: err instanceof Error ? { message: err.message, stack: err.stack } : String(err) });
    }
    return c.json(body, status as 500);
  });

  app.notFound((c) => {
    const { body } = toErrorResponse(new ApiFailure("NOT_FOUND", 404), c.get("requestId") ?? randomUUID(), c.get("locale") ?? "th");
    return c.json(body, 404);
  });

  app.get("/health", async (c) => {
    await deps.sql`select 1`;
    return c.json({ ok: true, service: "sabai-api", time: new Date().toISOString() });
  });

  // Dev-only convenience login (no password) so local/CI clients can obtain a
  // bearer token without a real Supabase project. Never mounted in production.
  if (deps.config.env !== "production") registerDevAuth(app, deps);

  registerIdentity(app, deps);
  registerDevices(app, deps);
  registerShop(app, deps);
  registerCatalog(app, deps);
  registerPos(app, deps);
  registerKitchen(app, deps);
  registerInventory(app, deps);
  registerFinance(app, deps);
  registerReports(app, deps);
  registerSettings(app, deps);
  registerBilling(app, deps);

  app.get("/v1/openapi.json", (c) => c.json(openApiDocument()));

  return app;
}
