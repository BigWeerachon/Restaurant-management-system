import { serve } from "@hono/node-server";
import { createErrorReporter } from "@sabai/observability";
import { createApp } from "./app";
import { startBillingJob } from "./billing/job";
import { startMaintenanceJob } from "./maintenance";
import { loadConfig } from "./config";
import { createDb } from "./db";
import { EventHub } from "./events";
import { createLogger } from "./logger";
import { installProcessGuards } from "./process-guards";
import { startTelemetry } from "./observability/telemetry";

const config = loadConfig();
const log = createLogger({ service: config.observability.serviceName });
// Started first, so that everything below is inside it. Does nothing unless a collector is configured.
const telemetry = await startTelemetry(config.observability);
const reporter = createErrorReporter({
  dsn: config.observability.errorDsn,
  environment: config.env,
  service: config.observability.serviceName,
  release: config.observability.release,
  platform: "node",
  onDrop: (reason) => log.warn("error_report_not_sent", { reason }),
});
const sql = createDb(config.databaseUrl);
const events = new EventHub();
await events.start(sql);

const app = createApp({ sql, config, log, events, reporter });
const stopBillingJob = startBillingJob(sql, log, config.billing.jobIntervalMinutes);
const stopMaintenanceJob = startMaintenanceJob(sql, log, config.maintenance.idempotencyPurgeMinutes);
const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  log.info("listening", { port: info.port, env: config.env, tracing: telemetry.enabled, error_tracking: reporter.enabled });
});

async function shutdown(signal: string) {
  log.info("shutdown", { signal });
  server.close();
  stopBillingJob();
  stopMaintenanceJob();
  await events.close();
  await sql.end({ timeout: 5 });
  await reporter.flush();
  await telemetry.shutdown();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

installProcessGuards({ log, reporter });
