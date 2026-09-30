import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { startBillingJob } from "./billing/job";
import { loadConfig } from "./config";
import { createDb } from "./db";
import { EventHub } from "./events";
import { createLogger } from "./logger";

const config = loadConfig();
const log = createLogger();
const sql = createDb(config.databaseUrl);
const events = new EventHub();
await events.start(sql);

const app = createApp({ sql, config, log, events });
const stopBillingJob = startBillingJob(sql, log, config.billing.jobIntervalMinutes);
const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  log.info("listening", { port: info.port, env: config.env });
});

async function shutdown(signal: string) {
  log.info("shutdown", { signal });
  server.close();
  stopBillingJob();
  await events.close();
  await sql.end({ timeout: 5 });
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
