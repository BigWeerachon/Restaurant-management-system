import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext } from "./helpers";

type Ctx = Awaited<ReturnType<typeof createTestContext>>;
let ctx: Ctx;
let tenantId: string;
let call: ReturnType<Ctx["client"]>;

beforeAll(async () => {
  ctx = await createTestContext();
  const owner = await ctx.newUser();
  const shop = await ctx.client(owner.token)("POST", "/v1/tenants", { name: "ร้านทดสอบคีย์ซ้ำ", businessType: "cafe", ownerName: "คุณเอ", vatRegistered: true });
  tenantId = shop.json.tenant_id;
  call = ctx.client(owner.token, tenantId);
});
afterAll(async () => {
  await ctx.close();
});

const expense = (description: string) => ({ category: "utilities", description, amount: 100, paidFrom: "bank" });
const count = async (description: string) =>
  (await ctx.sql<{ n: number }[]>`select count(*)::int as n from app.expenses where tenant_id = ${tenantId} and description = ${description}`)[0]!.n;
/** What the API stores to recognise "the same request" (apps/api/src/http.ts). */
const hashOf = (path: string, body: unknown) => createHash("sha256").update(`POST ${path}\n${JSON.stringify(body)}`).digest("hex");
const plant = (key: string, path: string, body: unknown, status: number, response: unknown, ageSeconds = 0) =>
  ctx.sql`
    insert into app.api_idempotency (tenant_id, key, method, path, request_hash, status, response, created_at)
    values (${tenantId}, ${key}, 'POST', ${path}, ${hashOf(path, body)}, ${status}, ${ctx.sql.json(response as never)}, now() - ${ageSeconds + " seconds"}::interval)`;

describe("Idempotency-Key", () => {
  it("runs the command once when the same request arrives several times at once", async () => {
    const body = expense("ค่าไฟ ส่งพร้อมกัน 4 ครั้ง");
    const key = `same-time-${Date.now()}`;
    const results = await Promise.all([1, 2, 3, 4].map(() => call("POST", "/v1/expenses", body, { "idempotency-key": key })));

    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201]);
    expect(await count(body.description)).toBe(1);
    expect(new Set(results.map((r) => r.json.id)).size).toBe(1);
    // One of them did the work; the other three were answered with its result.
    expect(results.filter((r) => r.headers.get("idempotent-replayed") === "true")).toHaveLength(3);
  });

  it("answers a repeat sent afterwards with the first result", async () => {
    const body = expense("ค่าน้ำ ส่งซ้ำทีหลัง");
    const key = `later-${Date.now()}`;
    const first = await call("POST", "/v1/expenses", body, { "idempotency-key": key });
    const again = await call("POST", "/v1/expenses", body, { "idempotency-key": key });

    expect(first.headers.get("idempotent-replayed")).toBeNull();
    expect(again.headers.get("idempotent-replayed")).toBe("true");
    expect(again.json).toEqual(first.json);
    expect(await count(body.description)).toBe(1);
  });

  it("refuses the same key for a different request", async () => {
    const key = `reused-${Date.now()}`;
    await call("POST", "/v1/expenses", expense("ค่าแก๊ส"), { "idempotency-key": key });
    const other = await call("POST", "/v1/expenses", expense("ค่าเช่า"), { "idempotency-key": key });

    expect(other.status).toBe(409);
    expect(await count("ค่าเช่า")).toBe(0);
  });

  it("does not keep a failure: the same key can be used again once the mistake is fixed", async () => {
    const key = `failed-first-${Date.now()}`;
    const bad = await call("POST", "/v1/expenses", { description: "ไม่ระบุหมวด", amount: 100, paidFrom: "bank" }, { "idempotency-key": key });
    expect(bad.status).toBe(422);
    const left = await ctx.sql`select 1 from app.api_idempotency where tenant_id = ${tenantId} and key = ${key}`;
    expect(left).toHaveLength(0);

    const good = await call("POST", "/v1/expenses", expense("หมวดครบแล้ว"), { "idempotency-key": key });
    expect(good.status).toBe(201);
    expect(good.headers.get("idempotent-replayed")).toBeNull();
    expect(await count("หมวดครบแล้ว")).toBe(1);
  });

  it("refuses a key the store cannot hold before running anything, instead of failing after the command ran", async () => {
    const short = await call("POST", "/v1/expenses", expense("คีย์สั้น"), { "idempotency-key": "abc" });
    expect(short.status).toBe(400);
    const long = await call("POST", "/v1/expenses", expense("คีย์ยาว"), { "idempotency-key": "k".repeat(129) });
    expect(long.status).toBe(400);
    expect(await count("คีย์สั้น")).toBe(0);
    expect(await count("คีย์ยาว")).toBe(0);
  });

  it("waits for a request that is still running and then answers with its result", async () => {
    const body = expense("กำลังบันทึกอยู่");
    const key = `running-${Date.now()}`;
    await plant(key, "/v1/expenses", body, 0, {}); // claimed a moment ago, not finished
    const finishFirst = new Promise<void>((resolve, reject) => {
      setTimeout(() => {
        ctx.sql`update app.api_idempotency set status = 201, response = ${ctx.sql.json({ id: "first-result" })} where tenant_id = ${tenantId} and key = ${key}`.then(() => resolve(), reject);
      }, 300);
    });

    const started = Date.now();
    const r = await call("POST", "/v1/expenses", body, { "idempotency-key": key });

    await finishFirst;
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
    expect(r.status).toBe(201);
    expect(r.json).toEqual({ id: "first-result" });
    expect(r.headers.get("idempotent-replayed")).toBe("true");
    expect(await count(body.description)).toBe(0); // the second request did not run the command
  });

  it("gives up waiting with a message that says nothing was saved twice", async () => {
    const body = expense("ค้างไม่เสร็จ");
    const key = `stuck-${Date.now()}`;
    await plant(key, "/v1/expenses", body, 0, {});

    const r = await call("POST", "/v1/expenses", body, { "idempotency-key": key });

    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe("REQUEST_IN_PROGRESS");
    expect(r.json.error.message).toContain("ไม่บันทึกซ้ำ");
    expect(await count(body.description)).toBe(0);
  }, 20_000);

  it("takes over a claim whose request died, and an answer older than a day", async () => {
    const abandoned = expense("คำขอที่ตายไปแล้ว");
    const keyA = `died-${Date.now()}`;
    await plant(keyA, "/v1/expenses", abandoned, 0, {}, 3 * 60); // claimed 3 minutes ago, never finished
    const a = await call("POST", "/v1/expenses", abandoned, { "idempotency-key": keyA });
    expect(a.status).toBe(201);
    expect(a.headers.get("idempotent-replayed")).toBeNull();
    expect(await count(abandoned.description)).toBe(1);

    const old = expense("คำตอบเก่าเกินหนึ่งวัน");
    const keyB = `old-${Date.now()}`;
    await plant(keyB, "/v1/expenses", old, 201, { id: "yesterday" }, 25 * 3600);
    const b = await call("POST", "/v1/expenses", old, { "idempotency-key": keyB });
    expect(b.status).toBe(201);
    expect(b.json.id).not.toBe("yesterday");
    expect(await count(old.description)).toBe(1);
  });
});
