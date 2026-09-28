import { randomUUID } from "node:crypto";
import { createApp } from "../src/app";
import { mintUserToken } from "../src/auth";
import type { Config } from "../src/config";
import { createDb, type Sql } from "../src/db";
import { EventHub } from "../src/events";
import { createLogger } from "../src/logger";

export const SECRET = "test-secret-that-is-long-enough-for-hs256!!";

export function testDatabaseUrl(): string {
  const db = process.env.SABAI_API_TEST_DB ?? "sabai_api_test";
  const host = process.env.PGHOST ?? "localhost";
  const user = process.env.PGUSER ?? "postgres";
  const pass = process.env.PGPASSWORD ?? "postgres";
  return `postgres://${user}:${pass}@${host}:5432/${db}`;
}

export async function createTestContext() {
  const sql: Sql = createDb(testDatabaseUrl(), 5);
  const events = new EventHub();
  await events.start(sql);
  const config: Config = {
    env: "test",
    port: 0,
    databaseUrl: testDatabaseUrl(),
    jwtSecret: SECRET,
    corsOrigins: ["http://localhost:3000"],
    staffTokenTtlSeconds: 3600,
  };
  const deps = { sql, config, log: createLogger({ silent: true }), events };
  const app = createApp(deps);

  async function newUser(email = `${randomUUID()}@example.com`) {
    const id = randomUUID();
    await sql`insert into auth.users (id, email) values (${id}, ${email})`;
    return { id, token: await mintUserToken(SECRET, id) };
  }

  function client(token?: string, tenantId?: string) {
    return async function call<T = any>(
      method: string,
      path: string,
      body?: unknown,
      headers: Record<string, string> = {},
    ): Promise<{ status: number; json: T; headers: Headers }> {
      const res = await app.request(path, {
        method,
        headers: {
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(tenantId ? { "x-tenant-id": tenantId } : {}),
          ...headers,
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const text = await res.text();
      return { status: res.status, json: (text ? JSON.parse(text) : null) as T, headers: res.headers };
    };
  }

  async function close() {
    await events.close();
    await sql.end({ timeout: 2 });
  }

  return { app, sql, events, deps, newUser, client, close };
}

/** Time-ordered ids like the POS generates on-device. */
export function uuidv7(): string {
  const ms = BigInt(Date.now());
  const hex = ms.toString(16).padStart(12, "0");
  const rand = randomUUID().replace(/-/g, "");
  const variant = ((parseInt(rand[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7${rand.slice(13, 16)}-${variant}${rand.slice(17, 20)}-${rand.slice(20, 32)}`;
}
