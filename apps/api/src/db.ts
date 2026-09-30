import { SpanStatusCode, trace } from "@opentelemetry/api";
import postgres from "postgres";
import type { Actor } from "./auth";

export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;

export function createDb(url: string, max = 10): Sql {
  return postgres(url, {
    max,
    idle_timeout: 20,
    connect_timeout: 10,
    // numeric stays a string (exact money); bigint counts are small → number.
    types: {
      bigint: { to: 20, from: [20], serialize: (x: number) => String(x), parse: (x: string) => Number(x) },
    },
    onnotice: () => {},
  });
}

/**
 * Runs `fn` in one transaction as the `authenticated` role with the actor's
 * JWT claims, so Postgres RLS and the command-level permission checks apply
 * exactly as they would for any other client. The API never bypasses RLS for
 * business data.
 */
export async function asActor<T>(sql: Sql, actor: Actor, requestId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  // One span per transaction: how long the database took, inside the request that asked.
  return trace.getTracer("sabai-api", "1.0.0").startActiveSpan("db.transaction", { attributes: { "db.system.name": "postgresql", "sabai.request_id": requestId } }, async (span) => {
    try {
      const result = await sql.begin(async (tx) => {
        await tx`select set_config('request.jwt.claims', ${JSON.stringify(actor.claims)}, true),
                        set_config('app.request_id', ${requestId}, true)`;
        await tx`set local role authenticated`;
        return fn(tx);
      });
      return result as T;
    } catch (error) {
      // A refusal the person can act on (a plan limit, a wrong PIN) is not a fault of the database.
      const code = (error as { code?: string })?.code;
      if (code !== "P0001") span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}
