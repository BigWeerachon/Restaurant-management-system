import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext } from "./helpers";

type Ctx = Awaited<ReturnType<typeof createTestContext>>;
let ctx: Ctx;
let call: ReturnType<Ctx["client"]>;
let cashierCall: ReturnType<Ctx["client"]>;
let tenantId: string;
let branchA: string;
let branchB: string;
let locationA: string;
let locationB: string;
let coffee: string;

beforeAll(async () => {
  ctx = await createTestContext();
  const owner = await ctx.newUser();
  const shop = await ctx.client(owner.token)("POST", "/v1/tenants", { name: "ร้านโอนของ", businessType: "cafe", ownerName: "คุณเอ", vatRegistered: true });
  tenantId = shop.json.tenant_id;
  branchA = shop.json.branch_id;
  call = ctx.client(owner.token, tenantId);

  branchB = (await call("POST", "/v1/branches", { code: "TB", name: "สาขาปลายทาง" })).json.id;
  const locations = await ctx.sql<{ id: string; branch_id: string }[]>`select id, branch_id from app.stock_locations where tenant_id = ${tenantId} and is_default`;
  locationA = locations.find((l) => l.branch_id === branchA)!.id;
  locationB = locations.find((l) => l.branch_id === branchB)!.id;
  coffee = (await call("POST", "/v1/ingredients", { name: "เมล็ดกาแฟ", baseUnit: "g", openingQty: 1000, branchId: branchA })).json.id;

  await call("POST", "/v1/members", { displayName: "น้องแคช", roleKey: "cashier", pin: "1111" });
  const pin = await call("POST", "/v1/auth/pin", { branchId: branchA, pin: "1111" });
  cashierCall = ctx.client(pin.json.token, tenantId);
});
afterAll(async () => {
  await ctx.close();
});

const stockAt = async (branchId: string) => {
  const rows = await call("GET", `/v1/stock?branchId=${branchId}`);
  return rows.json.find((x: any) => x.ingredient_id === coffee)?.qty_on_hand ?? 0;
};

describe("sending stock to another branch", () => {
  let transfer: string;

  it("draws up a transfer that moves nothing yet", async () => {
    const r = await call("POST", "/v1/transfers", { fromLocationId: locationA, toLocationId: locationB, note: "ส่งไปสาขาปลายทาง", lines: [{ ingredientId: coffee, qty: 300 }] });
    expect(r.status).toBe(201);
    transfer = r.json.id;
    expect(await stockAt(branchA)).toBe(1000);
    expect(await stockAt(branchB)).toBe(0);
  });

  it("refuses what makes no sense, in plain words", async () => {
    expect((await call("POST", "/v1/transfers", { fromLocationId: locationA, toLocationId: locationB, lines: [] })).status).toBe(422);
    expect((await call("POST", "/v1/transfers", { fromLocationId: locationA, toLocationId: locationB, lines: [{ ingredientId: coffee, qty: 0 }] })).status).toBe(422);
    expect((await call("POST", "/v1/transfers", { fromLocationId: locationA, toLocationId: locationA, lines: [{ ingredientId: coffee, qty: 5 }] })).status).toBeGreaterThanOrEqual(400);
    expect((await call("POST", `/v1/transfers/${crypto.randomUUID()}/send`)).status).toBe(404);
  });

  it("lets only someone with the right to move stock send or receive it", async () => {
    expect((await cashierCall("POST", "/v1/transfers", { fromLocationId: locationA, toLocationId: locationB, lines: [{ ingredientId: coffee, qty: 1 }] })).status).toBe(403);
    expect((await cashierCall("POST", `/v1/transfers/${transfer}/send`)).status).toBe(403);
    expect((await call("POST", `/v1/transfers/${transfer}/receive`, { lines: [] })).json.error.code).toBe("TRANSFER_NOT_SENT");
  });

  it("takes the stock off the source when it is sent, once", async () => {
    const sent = await call("POST", `/v1/transfers/${transfer}/send`);
    expect(sent.json).toMatchObject({ id: transfer, status: "sent" });
    expect(await stockAt(branchA)).toBe(700);
    expect(await stockAt(branchB)).toBe(0);
    const again = await call("POST", `/v1/transfers/${transfer}/send`);
    expect(again.json.error.code).toBe("TRANSFER_NOT_DRAFT");
    expect(await stockAt(branchA)).toBe(700);
  });

  it("will not let the receiver take in more than was sent, and keeps the transfer open", async () => {
    const over = await call("POST", `/v1/transfers/${transfer}/receive`, { lines: [{ ingredientId: coffee, qtyReceived: 301 }] });
    expect(over.status).toBeGreaterThanOrEqual(400);
    expect(over.json.error.code).toBe("TRANSFER_OVER_RECEIVED");
    expect(over.json.error.message).toBeTruthy();
    expect(await stockAt(branchB)).toBe(0);
  });

  it("stocks what arrived and writes the missing part off as a loss at the receiving branch", async () => {
    const received = await call("POST", `/v1/transfers/${transfer}/receive`, { lines: [{ ingredientId: coffee, qtyReceived: 280 }] });
    expect(received.json).toMatchObject({ id: transfer, status: "received" });
    expect(await stockAt(branchB)).toBe(280);
    expect(await stockAt(branchA)).toBe(700);
    const moves = await call("GET", `/v1/stock-movements?branchId=${branchB}&ingredientId=${coffee}`);
    const loss = moves.json.find((m: any) => m.reason === "waste");
    expect(loss).toMatchObject({ reason_code: "transfer_loss", qty: -20 });
    expect((await call("POST", `/v1/transfers/${transfer}/receive`, { lines: [] })).json.error.code).toBe("TRANSFER_NOT_SENT");
    expect(await stockAt(branchB)).toBe(280);
  });
});

describe("reopening a closed day", () => {
  let date: string;

  it("closes the day, then refuses to reopen a day that is not closed", async () => {
    const today = await call("GET", `/v1/reports/today?branchId=${branchA}`);
    date = today.json.today;
    expect((await call("POST", `/v1/days/${date}/close`, { branchId: branchA, note: "ปิดวันแรก" })).status).toBe(200);
    const notClosed = await call("POST", "/v1/days/2020-01-01/reopen", { branchId: branchA, reason: "ไม่เคยปิด" });
    expect(notClosed.json.error.code).toBe("DAY_NOT_CLOSED");
  });

  it("needs the right to manage finance, and a reason", async () => {
    expect((await cashierCall("POST", `/v1/days/${date}/reopen`, { branchId: branchA, reason: "ลองดู" })).status).toBe(403);
    expect((await call("POST", `/v1/days/${date}/reopen`, { branchId: branchA, reason: "" })).status).toBe(422);
    expect((await call("POST", `/v1/days/${date}/reopen`, { branchId: branchA, reason: "   " })).status).toBeGreaterThanOrEqual(400);
    const days = await call("GET", `/v1/days?branchId=${branchA}`);
    expect(days.json.find((d: any) => d.business_date === date).status).toBe("closed");
  });

  it("reopens it with the reason on record, then lets the day be closed again", async () => {
    const reopened = await call("POST", `/v1/days/${date}/reopen`, { branchId: branchA, reason: "นับของผิด ต้องแก้" });
    expect(reopened.json).toEqual({ ok: true });
    const days = await call("GET", `/v1/days?branchId=${branchA}`);
    const day = days.json.find((d: any) => d.business_date === date);
    expect(day.status).toBe("reopened");
    expect(day.note).toContain("นับของผิด ต้องแก้");
    expect((await call("POST", `/v1/days/${date}/reopen`, { branchId: branchA, reason: "อีกรอบ" })).json.error.code).toBe("DAY_NOT_CLOSED");

    // Used to fail with a database error: a reopened day could not be closed again.
    const again = await call("POST", `/v1/days/${date}/close`, { branchId: branchA, note: "ปิดอีกครั้ง" });
    expect(again.status).toBe(200);
    expect((await call("GET", `/v1/days?branchId=${branchA}`)).json.find((d: any) => d.business_date === date).status).toBe("closed");
  });

  it("keeps the books balanced through all of it", async () => {
    const [{ unbalanced }] = await ctx.sql<{ unbalanced: number }[]>`
      select count(*)::int as unbalanced from (
        select entry_id from app.journal_lines where tenant_id = ${tenantId} group by entry_id having sum(debit) <> sum(credit)) x`;
    expect(unbalanced).toBe(0);
  });
});
