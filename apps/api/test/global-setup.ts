import { execSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";

/** Builds a fresh database from the real migrations for every test run. */
export default function setup() {
  const root = resolve(__dirname, "../../..");
  const db = process.env.SABAI_API_TEST_DB ?? "sabai_api_test";
  const env = {
    ...process.env,
    PGHOST: process.env.PGHOST ?? "localhost",
    PGUSER: process.env.PGUSER ?? "postgres",
    PGPASSWORD: process.env.PGPASSWORD ?? "postgres",
    PGOPTIONS: "-c client_min_messages=warning",
  };
  const psql = (args: string) => execSync(`psql -q -v ON_ERROR_STOP=1 ${args}`, { env, cwd: root, stdio: ["ignore", "ignore", "inherit"] });
  psql(`-d postgres -c "drop database if exists ${db} with (force)" -c "create database ${db}"`);
  psql(`-d ${db} -f packages/db/sql/local-supabase-shim.sql`);
  for (const f of readdirSync(resolve(root, "supabase/migrations")).sort()) {
    psql(`-d ${db} -f supabase/migrations/${f}`);
  }
  process.env.TEST_DATABASE_URL = `postgres://${env.PGUSER}:${env.PGPASSWORD}@${env.PGHOST}:5432/${db}`;
}
