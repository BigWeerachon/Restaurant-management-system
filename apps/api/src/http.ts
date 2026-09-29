import { createHash } from "node:crypto";
import type { Context, Hono } from "hono";
import { z, type ZodType } from "zod";
import type { Actor } from "./auth";
import type { Config } from "./config";
import { asActor, type Sql, type Tx } from "./db";
import { ApiFailure } from "./errors";
import type { EventHub } from "./events";
import type { Logger } from "./logger";

export interface Deps {
  sql: Sql;
  config: Config;
  log: Logger;
  events?: EventHub;
}

export type Env = {
  Variables: {
    requestId: string;
    actor: Actor | null;
    locale: "th" | "en";
  };
};

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface RouteMeta<B extends ZodType | undefined = undefined, Q extends ZodType | undefined = undefined> {
  method: Method;
  path: string;
  summary: string;
  tag: string;
  /** Default true. */
  auth?: boolean;
  /** Tenant-scoped reads need X-Tenant-Id. */
  tenant?: boolean;
  body?: B;
  query?: Q;
  /** Documented permission (enforced by the database). */
  permission?: string;
  status?: 200 | 201 | 202;
  /**
   * Whether a repeated POST with the same Idempotency-Key is answered with the first result. Default true. Off for
   * calls that mint a credential (PIN sign-in): their answer must not sit in the replay table.
   */
  idempotent?: boolean;
}

export interface RouteCtx<B, Q> {
  c: Context<Env>;
  deps: Deps;
  body: B;
  query: Q;
  /** Path parameters used by v1 routes ({id}, {date}); validated by the database commands. */
  params: { id: string; date: string };
  actor: Actor;
  requestId: string;
  tenantId: string;
  /** Run SQL as the actor inside one transaction (RLS enforced). */
  tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}

type Infer<T> = T extends ZodType ? z.output<T> : undefined;

export const routeRegistry: RouteMeta<ZodType | undefined, ZodType | undefined>[] = [];

const UUID = z.uuid();

export function route<B extends ZodType | undefined = undefined, Q extends ZodType | undefined = undefined>(
  app: Hono<Env>,
  deps: Deps,
  meta: RouteMeta<B, Q>,
  handler: (ctx: RouteCtx<Infer<B>, Infer<Q>>) => Promise<unknown>,
): void {
  routeRegistry.push(meta as RouteMeta<ZodType | undefined, ZodType | undefined>);
  const honoPath = meta.path.replace(/\{(\w+)\}/g, ":$1");

  app.on(meta.method, honoPath, async (c) => {
    const actor = c.get("actor");
    if (meta.auth !== false && !actor) throw new ApiFailure("AUTH_REQUIRED", 401);

    const rawTenant = c.req.header("x-tenant-id") ?? "";
    if (meta.tenant && !UUID.safeParse(rawTenant).success) {
      throw new ApiFailure("VALIDATION", 400, {}, { "X-Tenant-Id": "ต้องระบุร้านที่กำลังใช้งาน" });
    }

    let rawBody: unknown = undefined;
    if (meta.body) {
      const text = await c.req.text();
      try {
        rawBody = text ? JSON.parse(text) : {};
      } catch {
        throw new ApiFailure("VALIDATION", 400, {}, { _: "รูปแบบข้อมูลไม่ถูกต้อง" });
      }
    }
    const body = (meta.body ? meta.body.parse(rawBody) : undefined) as Infer<B>;
    const query = (meta.query ? meta.query.parse(c.req.query()) : undefined) as Infer<Q>;
    const requestId = c.get("requestId");

    // Idempotent replay for retried POSTs (flaky shop Wi-Fi, double taps).
    const idemKey = c.req.header("idempotency-key");
    // A call made inside a shop is scoped to the shop. One made before any shop exists (opening the first one) is scoped
    // to the signed-in person — without that, a retried "create my shop" made a second, third… shop.
    const idemScope = meta.idempotent === false ? null : UUID.safeParse(rawTenant).success ? rawTenant : (actor?.userId ?? null);
    let requestHash: string | null = null;
    if (meta.method === "POST" && idemKey && idemScope) {
      requestHash = createHash("sha256").update(`${meta.method} ${c.req.path}\n${JSON.stringify(rawBody ?? null)}`).digest("hex");
      const [hit] = await deps.sql<{ request_hash: string; status: number; response: unknown }[]>`
        select request_hash, status, response from app.api_idempotency
         where tenant_id = ${idemScope} and key = ${idemKey} and created_at > now() - interval '24 hours'`;
      if (hit) {
        if (hit.request_hash !== requestHash) throw new ApiFailure("CONFLICT", 409, { reason: "idempotency_key_reused" });
        c.header("Idempotent-Replayed", "true");
        return c.json(hit.response as object, hit.status as 200);
      }
    }

    const result = await handler({
      c,
      deps,
      body,
      query,
      params: c.req.param() as unknown as { id: string; date: string },
      actor: actor as Actor,
      requestId,
      tenantId: rawTenant,
      tx: (fn) => asActor(deps.sql, actor as Actor, requestId, fn),
    });
    if (result instanceof Response) return result;

    const status = meta.status ?? 200;
    if (requestHash && idemScope && idemKey) {
      await deps.sql`
        insert into app.api_idempotency (tenant_id, key, method, path, request_hash, status, response)
        values (${idemScope}, ${idemKey}, ${meta.method}, ${c.req.path}, ${requestHash}, ${status}, ${deps.sql.json(result as never)})
        on conflict (tenant_id, key) do nothing`;
    }
    return c.json(result as object, status);
  });
}

/** OpenAPI 3.1 document generated from the same zod schemas that validate requests. */
export function openApiDocument(): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  const toSchema = (s: ZodType) => {
    try {
      return z.toJSONSchema(s, { io: "input", unrepresentable: "any" });
    } catch {
      return {};
    }
  };
  for (const r of routeRegistry) {
    const op: Record<string, unknown> = {
      summary: r.summary,
      tags: [r.tag],
      ...(r.permission ? { "x-permission": r.permission } : {}),
      security: r.auth === false ? [] : [{ bearer: [] }],
      parameters: [
        ...[...r.path.matchAll(/\{(\w+)\}/g)].map((m) => ({ name: m[1], in: "path", required: true, schema: { type: "string" } })),
        ...(r.tenant ? [{ name: "X-Tenant-Id", in: "header", required: true, schema: { type: "string", format: "uuid" } }] : []),
        ...(r.method === "POST" ? [{ name: "Idempotency-Key", in: "header", required: false, schema: { type: "string" } }] : []),
      ],
      ...(r.body ? { requestBody: { required: true, content: { "application/json": { schema: toSchema(r.body) } } } } : {}),
      responses: {
        [String(r.status ?? 200)]: { description: "OK" },
        default: { description: "Human-readable error", content: { "application/json": { schema: { $ref: "#/components/schemas/ApiError" } } } },
      },
    };
    if (r.query) {
      const js = toSchema(r.query) as { properties?: Record<string, unknown>; required?: string[] };
      for (const [name, schema] of Object.entries(js.properties ?? {})) {
        (op.parameters as unknown[]).push({ name, in: "query", required: js.required?.includes(name) ?? false, schema });
      }
    }
    paths[r.path] ??= {};
    paths[r.path]![r.method.toLowerCase()] = op;
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Sabai Restaurant OS API",
      version: "1.0.0",
      description: "Task-oriented API. Money is a THB decimal string; errors carry a human message and a reference.",
    },
    servers: [{ url: "/" }],
    components: {
      securitySchemes: { bearer: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
      schemas: {
        ApiError: {
          type: "object",
          properties: {
            error: {
              type: "object",
              required: ["code", "title", "message", "action", "actionLabel", "severity", "reference"],
              properties: {
                code: { type: "string" },
                title: { type: "string" },
                message: { type: "string" },
                action: { type: "string" },
                actionLabel: { type: "string" },
                severity: { enum: ["info", "warning", "error"] },
                reference: { type: "string" },
                fields: { type: "object", additionalProperties: { type: "string" } },
              },
            },
          },
        },
      },
    },
    paths,
  };
}
