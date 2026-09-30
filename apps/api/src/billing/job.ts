import type { Sql } from "../db";
import type { Logger } from "../logger";

/** The nightly job (`app.billing_run`): renewals, overdue, grace over, trials over. Safe to run as often as you like. */
export async function runBillingJob(sql: Sql, log: Logger): Promise<Record<string, unknown>> {
  const [row] = await sql<{ r: Record<string, unknown> }[]>`select app.billing_run() as r`;
  const result = row?.r ?? {};
  log.info("billing_run", result);
  return result;
}

/** Runs the job now and then inside this process. Returns a function that stops it. */
export function startBillingJob(sql: Sql, log: Logger, everyMinutes: number): () => void {
  if (!(everyMinutes > 0)) return () => {};
  const run = () => runBillingJob(sql, log).catch((error) => log.error("billing_run_failed", { error: error instanceof Error ? error.message : String(error) }));
  const first = setTimeout(run, 30_000);
  const timer = setInterval(run, everyMinutes * 60_000);
  first.unref();
  timer.unref();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
