import type { Sql } from "./db";
import type { Logger } from "./logger";

/** Deletes Idempotency-Key rows older than 24 h (`app.purge_idempotency`): they can never be replayed again. Safe to run as often as you like. */
export async function purgeIdempotency(sql: Sql, log: Logger): Promise<number> {
  const [row] = await sql<{ n: number }[]>`select app.purge_idempotency() as n`;
  const deleted = row?.n ?? 0;
  if (deleted > 0) log.info("idempotency_purged", { deleted });
  return deleted;
}

/** Runs the purge now and then inside this process. Returns a function that stops it. */
export function startMaintenanceJob(sql: Sql, log: Logger, everyMinutes: number): () => void {
  if (!(everyMinutes > 0)) return () => {};
  const run = () => purgeIdempotency(sql, log).catch((error) => log.error("idempotency_purge_failed", { error: error instanceof Error ? error.message : String(error) }));
  const first = setTimeout(run, 60_000);
  const timer = setInterval(run, everyMinutes * 60_000);
  first.unref();
  timer.unref();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
