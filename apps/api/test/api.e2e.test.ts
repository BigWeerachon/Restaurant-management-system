import { addDays, calculateOrderTotals, PERMISSIONS, toSatang } from "@sabai/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, uuidv7 } from "./helpers";

type Ctx = Awaited<ReturnType<typeof createTestContext>>;
let ctx: Ctx;

// Shared story state: one café going through its first day.
const s: Record<string, any> = {};

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.close();
});

describe("platform basics", () => {
  it("is healthy and publishes an OpenAPI document generated from the contracts", async () => {
    const call = ctx.client();
    expect((await call("GET", "/health")).json.ok).toBe(true);
    const doc = (await call("GET", "/v1/openapi.json")).json;
    expect(doc.openapi).toBe("3.1.0");
    expect(Object.keys(doc.paths).length).toBeGreaterThan(35);
    expect(doc.paths["/v1/orders"].post.requestBody.content["application/json"].schema.properties.items).toBeTruthy();
  });

  it("answers unauthenticated calls with a human message and a reference, never internals", async () => {
    const r = await ctx.client()("GET", "/v1/me");
    expect(r.status).toBe(401);
    expect(r.json.error.code).toBe("AUTH_REQUIRED");
    expect(r.json.error.title).toBe("กรุณาเข้าสู่ระบบอีกครั้ง");
    expect(r.json.error.reference).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/);
    expect(r.headers.get("x-request-id")).toBeTruthy();
  });

  it("rejects forged tokens", async () => {
    const r = await ctx.client("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.bad")("GET", "/v1/me");
    expect(r.status).toBe(401);
  });

  it("keeps the permission catalog in code and database in sync", async () => {
    const rows = await ctx.sql<{ key: string }[]>`select key from app.permissions order by key`;
    expect(rows.map((r) => r.key)).toEqual(PERMISSIONS.map((p) => p.key).sort());
  });
});

describe("a café's first day, through the API", () => {
  it("signs up and lands on a ready-to-sell shop", async () => {
    s.owner = await ctx.newUser();
    const r = await ctx.client(s.owner.token)("POST", "/v1/tenants", {
      name: "สบายคาเฟ่",
      businessType: "cafe",
      ownerName: "คุณเอ",
      vatRegistered: true,
    });
    expect(r.status).toBe(201);
    s.tenantId = r.json.tenant_id;
    s.branchId = r.json.branch_id;
    s.call = ctx.client(s.owner.token, s.tenantId);

    const me = await s.call("GET", "/v1/me");
    const m = me.json.memberships[0];
    expect(m.role.key).toBe("owner");
    expect(m.home).toBe("/today");
    expect(m.navigation.primary.length).toBeLessThanOrEqual(5);
    expect(m.navigation.primary[0].key).toBe("today");
  });

  it("shows onboarding progress computed from data, with a clear next step", async () => {
    const r = await s.call("GET", "/v1/onboarding");
    expect(r.json.percent).toBe(0);
    expect(r.json.next.key).toBe("branch");
    expect(r.json.steps).toHaveLength(7);
  });

  it("explains form mistakes field by field, in Thai", async () => {
    const r = await s.call("POST", "/v1/ingredients", { name: "", baseUnit: "kg" });
    expect(r.status).toBe(422);
    expect(r.json.error.code).toBe("VALIDATION");
    expect(r.json.error.fields.name).toBe("ต้องมีชื่อ");
    expect(r.json.error.fields.baseUnit).toBeTruthy();
  });

  it("adds ingredients and a menu item with its recipe in one step", async () => {
    const coffee = await s.call("POST", "/v1/ingredients", { name: "เมล็ดกาแฟ", baseUnit: "g", displayUnit: "kg", standardCost: 0.45, reorderPoint: 500, parLevel: 2000 });
    const milk = await s.call("POST", "/v1/ingredients", { name: "นมสด", baseUnit: "ml", displayUnit: "l", standardCost: 0.045 });
    expect(coffee.status).toBe(201);
    s.coffee = coffee.json.id;
    s.milk = milk.json.id;

    const dup = await s.call("POST", "/v1/ingredients", { name: "เมล็ดกาแฟ", baseUnit: "g" });
    expect(dup.status).toBe(409);
    expect(dup.json.error.title).toBe("มีข้อมูลนี้อยู่แล้ว");

    const latte = await s.call("POST", "/v1/menu-items", {
      categoryName: "กาแฟ",
      name: "ลาเต้เย็น",
      price: 65,
      kitchenRoute: "bar",
      recipe: [
        { ingredientId: s.coffee, qty: 18 },
        { ingredientId: s.milk, qty: 180 },
      ],
    });
    expect(latte.status).toBe(201);
    expect(latte.json.cost).toBe("16.20");
    s.latte = latte.json.id;

    const americano = await s.call("POST", "/v1/menu-items", { categoryName: "กาแฟ", name: "อเมริกาโน่", price: 55, kitchenRoute: "bar", recipe: [{ ingredientId: s.coffee, qty: 18 }] });
    s.americano = americano.json.id;

    const costing = await s.call("GET", `/v1/menu-items/${s.latte}/costing`);
    expect(costing.json.cost).toBe("16.20");
    expect(costing.json.health).toBe("great");
    expect(costing.json.lines[0].name).toBeTruthy();
  });

  it("serves the whole POS catalog in one call", async () => {
    const r = await s.call("GET", `/v1/catalog?branchId=${s.branchId}`);
    expect(r.status).toBe(200);
    expect(r.json.items.map((i: any) => i.name)).toContain("ลาเต้เย็น");
    expect(r.json.items.find((i: any) => i.name === "ลาเต้เย็น").price).toBe("65.00");
    expect(r.json.paymentMethods.map((p: any) => p.kind)).toContain("cash");
    s.channels = r.json.channels;
    s.cash = r.json.paymentMethods.find((p: any) => p.kind === "cash").id;
  });

  it("receives goods from the market (paid in cash, no supplier needed)", async () => {
    const r = await s.call("POST", "/v1/receipts", {
      branchId: s.branchId,
      lines: [
        { ingredientId: s.coffee, packName: "ถุง 1 กก.", packQty: 1000, qtyPacks: 2, unitPrice: 500 },
        { ingredientId: s.milk, packName: "ขวด 2 ลิตร", packQty: 2000, qtyPacks: 3, unitPrice: 100 },
      ],
    });
    expect(r.status).toBe(201);
    expect(r.json.total).toBe("1300.00");
    const stock = await s.call("GET", `/v1/stock?branchId=${s.branchId}`);
    expect(stock.json.find((x: any) => x.name === "เมล็ดกาแฟ").qty_on_hand).toBe(2000);
  });

  it("asks to open a shift before taking cash, with a smart default float", async () => {
    const cur = await s.call("GET", `/v1/shifts/current?branchId=${s.branchId}`);
    expect(cur.json.shift).toBeNull();
    expect(cur.json.suggestedOpeningFloat).toBe("1000.00");
    const open = await s.call("POST", "/v1/shifts", { branchId: s.branchId, openingFloat: 1000 });
    expect(open.status).toBe(201);
    s.shift = open.json.id;
  });

  it("sells: submit is idempotent, the server re-prices, payment returns change", async () => {
    s.order = uuidv7();
    const body = {
      id: s.order,
      branchId: s.branchId,
      items: [
        { id: uuidv7(), menuItemId: s.latte, qty: 2 },
        { id: uuidv7(), menuItemId: s.americano, qty: 1, note: "ไม่ใส่น้ำแข็ง" },
      ],
    };
    const key = `order-${s.order}`;
    const first = await s.call("POST", "/v1/orders", body, { "idempotency-key": key });
    expect(first.status).toBe(200);
    expect(first.json.total).toBe("185.00");
    expect(first.json.vatAmount).toBe("12.10");
    const replay = await s.call("POST", "/v1/orders", body, { "idempotency-key": key });
    expect(replay.headers.get("idempotent-replayed")).toBe("true");
    expect(replay.json).toEqual(first.json);

    const tickets = await s.call("GET", `/v1/kds/tickets?branchId=${s.branchId}`);
    const ticket = tickets.json.tickets.find((t: any) => t.order_id === s.order);
    expect(ticket.items).toHaveLength(2);
    expect(tickets.json.stations.length).toBe(2);
    s.ticket = ticket.id;

    const wrong = await s.call("POST", `/v1/orders/${s.order}/pay`, { payments: [{ methodId: s.cash, amount: 100 }] });
    expect(wrong.status).toBe(422);
    expect(wrong.json.error.message).toContain("฿185.00");

    const paid = await s.call("POST", `/v1/orders/${s.order}/pay`, { payments: [{ methodId: s.cash, amount: 185, tendered: 500 }] });
    expect(paid.json.status).toBe("paid");
    expect(paid.json.change).toBe("315.00");
    expect(paid.json.receiptNo).toMatch(/^HQ-\d{4}-00001$/);

    const again = await s.call("POST", `/v1/orders/${s.order}/pay`, { payments: [{ methodId: s.cash, amount: 185 }] });
    expect(again.json.status).toBe("paid");

    const detail = await s.call("GET", `/v1/orders/${s.order}`);
    expect(detail.json.items).toHaveLength(2);
    expect(detail.json.payments[0].change_given).toBe("315.00");
  });

  it("keeps kitchen in the loop and lets cooks undo a mistaken bump", async () => {
    expect((await s.call("POST", `/v1/kds/tickets/${s.ticket}/status`, { status: "ready" })).status).toBe(200);
    expect((await s.call("POST", `/v1/kds/tickets/${s.ticket}/status`, { status: "in_progress" })).status).toBe(200);
    const tickets = await s.call("GET", `/v1/kds/tickets?branchId=${s.branchId}`);
    expect(tickets.json.tickets.find((t: any) => t.id === s.ticket).status).toBe("in_progress");
  });

  it("prices exactly like the domain library (parity for the offline POS)", async () => {
    const [channel] = s.channels.filter((c: any) => c.kind === "takeaway");
    for (const qty of [1, 3, 7]) {
      const id = uuidv7();
      const r = await s.call("POST", "/v1/orders", {
        id,
        branchId: s.branchId,
        channelId: channel.id,
        items: [
          { id: uuidv7(), menuItemId: s.latte, qty },
          { id: uuidv7(), menuItemId: s.americano, qty: qty + 1 },
        ],
      });
      await s.call("POST", `/v1/orders/${id}/discount`, { type: "percent", value: 12.5, reason: "โปรเปิดร้าน" });
      const detail = await s.call("GET", `/v1/orders/${id}`);
      const local = calculateOrderTotals({
        lines: [
          { qty, unitPrice: 6500, modifiersTotal: 0 },
          { qty: qty + 1, unitPrice: 5500, modifiersTotal: 0 },
        ],
        discount: { type: "percent", value: 12.5 },
        serviceChargeRate: 0,
        vatRate: 0.07,
        pricesIncludeVat: true,
      });
      expect(toSatang(detail.json.total)).toBe(local.total);
      expect(toSatang(detail.json.vatAmount)).toBe(local.vatAmount);
      expect(toSatang(detail.json.discountTotal)).toBe(local.discountTotal);
      expect(r.status).toBe(200);
      await s.call("POST", `/v1/orders/${id}/void`, { reason: "ทดสอบ" });
    }
  });
});

describe("staff on a shared device", () => {
  it("adds a PIN-only cashier and switches user by PIN", async () => {
    const add = await s.call("POST", "/v1/members", { displayName: "น้องแคช", roleKey: "cashier", pin: "1111", maxDiscountRate: 0.1 });
    expect(add.status).toBe(201);
    await s.call("POST", "/v1/members", { displayName: "พี่ผู้จัดการ", roleKey: "manager", pin: "9999" });

    const wrong = await s.call("POST", "/v1/auth/pin", { branchId: s.branchId, pin: "0000" });
    expect(wrong.status).toBe(401);
    expect(wrong.json.error.code).toBe("PIN_INVALID");

    const ok = await s.call("POST", "/v1/auth/pin", { branchId: s.branchId, pin: "1111" });
    expect(ok.json.membership.role).toBe("cashier");
    expect(ok.json.membership.home).toBe("pos");
    s.cashierCall = ctx.client(ok.json.token, s.tenantId);
  });

  it("gives the cashier only the cashier's world", async () => {
    const me = await s.cashierCall("GET", "/v1/me");
    expect(me.json.memberships[0].navigation.primary.map((n: any) => n.key)).toEqual(["pos", "orders", "kds"]);
    const report = await s.cashierCall("GET", "/v1/reports/summary?from=2026-01-01&to=2026-12-31");
    expect(report.status).toBe(403);
    expect(report.json.error.title).toBe("ต้องให้ผู้จัดการช่วย");
  });

  it("needs a manager PIN for a discount above the cashier's cap", async () => {
    const id = uuidv7();
    await s.cashierCall("POST", "/v1/orders", { id, branchId: s.branchId, items: [{ id: uuidv7(), menuItemId: s.latte, qty: 2 }] });
    const small = await s.cashierCall("POST", `/v1/orders/${id}/discount`, { type: "percent", value: 5, reason: "ลูกค้าประจำ" });
    expect(small.status).toBe(200);

    const big = await s.cashierCall("POST", `/v1/orders/${id}/discount`, { type: "percent", value: 20, reason: "ลูกค้าประจำ" });
    expect(big.status).toBe(403);
    expect(big.json.error.code).toBe("APPROVAL_REQUIRED");
    expect(big.json.error.action).toBe("request_approval");

    const approval = await s.cashierCall("POST", "/v1/approvals", { branchId: s.branchId, permission: "pos.discount", pin: "9999", targetType: "order", targetId: id });
    expect(approval.status).toBe(201);
    const ok = await s.cashierCall("POST", `/v1/orders/${id}/discount`, { type: "percent", value: 20, reason: "ลูกค้าประจำ", approvalId: approval.json.approvalId });
    expect(ok.json.discountTotal).toBe("26.00");

    // The bar already has these drinks: voiding now is a manager decision.
    const voidTry = await s.cashierCall("POST", `/v1/orders/${id}/void`, { reason: "ลูกค้ายกเลิก" });
    expect(voidTry.status).toBe(403);
    expect(voidTry.json.error.code).toBe("APPROVAL_REQUIRED");
    const voided = await s.call("POST", `/v1/orders/${id}/void`, { reason: "ลูกค้ายกเลิก" });
    expect(voided.json.status).toBe("voided");
  });
});

describe("tenant isolation", () => {
  it("never shows or changes another shop's data", async () => {
    const other = await ctx.newUser();
    const created = await ctx.client(other.token)("POST", "/v1/tenants", { name: "ร้านข้างบ้าน", ownerName: "บี" });
    const call = ctx.client(other.token, created.json.tenant_id);

    const peek = ctx.client(other.token, s.tenantId);
    const catalog = await peek("GET", `/v1/catalog?branchId=${s.branchId}`);
    expect(catalog.json.items ?? []).toHaveLength(0);
    const order = await call("GET", `/v1/orders/${s.order}`);
    expect(order.status).toBe(404);
    const pay = await call("POST", `/v1/orders/${s.order}/pay`, { payments: [{ methodId: s.cash, amount: 185 }] });
    expect(pay.status).toBe(403);
    const pin = await call("POST", "/v1/auth/pin", { branchId: s.branchId, pin: "1111" });
    expect(pin.status).toBe(404);
  });

  it("maps malformed ids to a friendly validation error, not a SQL message", async () => {
    const r = await s.call("GET", "/v1/orders/not-a-uuid");
    expect(r.status).toBe(422);
    expect(JSON.stringify(r.json)).not.toMatch(/invalid input syntax|uuid|postgres/i);
  });
});

describe("closing the day and reading the numbers", () => {
  it("won't close with an open shift, and says what to do", async () => {
    const date = (await ctx.sql<{ d: string }[]>`select app.business_date(${s.branchId})::text as d`)[0]!.d;
    s.date = date;
    const r = await s.call("POST", `/v1/days/${date}/close`, { branchId: s.branchId });
    expect(r.status).toBe(422);
    expect(r.json.error.code).toBe("OPEN_SHIFTS_EXIST");
    expect(r.json.error.actionLabel).toBe("ไปปิดกะ");
  });

  it("closes shift and day; the books balance", async () => {
    const close = await s.call("POST", `/v1/shifts/${s.shift}/close`, { countedCash: 1185, denominations: { "1000": 1, "100": 1, "50": 1, "20": 1, "10": 1, "5": 1 } });
    expect(close.json.variance).toBe("0.00");
    const day = await s.call("POST", `/v1/days/${s.date}/close`, { branchId: s.branchId, note: "วันแรก" });
    expect(day.status).toBe(200);
    expect(day.json.total).toBe("185.00");
    const [bal] = await ctx.sql<{ ok: boolean }[]>`select sum(debit) = sum(credit) as ok from app.journal_lines where tenant_id = ${s.tenantId}`;
    expect(bal!.ok).toBe(true);
  });

  it("answers the owner's questions in one report", async () => {
    const r = await s.call("GET", `/v1/reports/summary?from=${s.date}&to=${s.date}`);
    expect(r.status).toBe(200);
    expect(r.json.headline.orders).toBe(1);
    expect(r.json.headline.netSales).toBe("172.90");
    const profit = r.json.waterfall.at(-1);
    expect(profit.key).toBe("profit");
    expect(Number(profit.value)).toBeGreaterThan(0);
    expect(r.json.topItems[0].name).toBe("ลาเต้เย็น");
    expect(r.json.channels[0].name).toBe("ทานที่ร้าน");
  });

  it("tracks onboarding progress automatically", async () => {
    const r = await s.call("GET", "/v1/onboarding");
    const byKey = Object.fromEntries(r.json.steps.map((x: any) => [x.key, x.status]));
    expect(byKey).toMatchObject({ ingredient: "done", menu: "done", recipe: "done", staff: "done", first_sale: "done" });
    expect(r.json.next.key).toBe("branch");
  });

  it("spreads a monthly bill over the days it covers, so one day never looks like a loss", async () => {
    const [rent] = await ctx.sql<{ id: string }[]>`select id from app.accounts where tenant_id = ${s.tenantId} and system_key = 'rent'`;
    const base = { branchId: s.branchId, accountId: rent!.id, description: "ค่าเช่าร้าน", amount: 3000, paidFrom: "bank" };
    const bad = await s.call("POST", "/v1/expenses", { ...base, periodStart: addDays(s.date, 5), periodEnd: s.date });
    expect(bad.status).toBe(422);
    expect(JSON.stringify(bad.json)).toMatch(/วันสิ้นสุด/);
    const ok = await s.call("POST", "/v1/expenses", { ...base, periodStart: addDays(s.date, -10), periodEnd: addDays(s.date, 19) });
    expect(ok.status).toBe(201);
    const r = await s.call("GET", `/v1/reports/summary?from=${s.date}&to=${s.date}`);
    expect(Number(r.json.waterfall.find((w: any) => w.key === "expenses").value)).toBe(-100);
  });

  it("records the activity feed for owners", async () => {
    const r = await s.call("GET", "/v1/activity?limit=100");
    const types = r.json.map((e: any) => e.type);
    expect(types).toContain("order.paid");
    expect(types).toContain("order.discounted");
    expect(types).toContain("finance.day_closed");
  });
});
