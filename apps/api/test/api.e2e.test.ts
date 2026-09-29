import { addDays, calculateOrderTotals, PERMISSIONS, toSatang } from "@sabai/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
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

  it("documents every endpoint added in V1.1 with a working request schema", async () => {
    const doc = (await ctx.client()("GET", "/v1/openapi.json")).json;
    const v11Routes: [string, string][] = [
      ["get", "/v1/shop"],
      ["post", "/v1/dev/login"],
      ["get", "/v1/stock-movements"],
      ["get", "/v1/receipts"],
      ["get", "/v1/stock-counts"],
      ["get", "/v1/purchase-orders"],
      ["post", "/v1/purchase-orders/from-suggestions"],
      ["get", "/v1/expenses"],
      ["get", "/v1/days"],
      ["get", "/v1/shifts"],
      ["patch", "/v1/menu-items/{id}"],
      ["post", "/v1/kds/ticket-items/{id}/toggle"],
      ["patch", "/v1/members/{id}"],
      ["post", "/v1/members/{id}/pin"],
      ["put", "/v1/roles/{id}/permissions"],
      ["patch", "/v1/tenant"],
      ["post", "/v1/branches"],
      ["patch", "/v1/branches/{id}"],
      ["patch", "/v1/channels/{id}"],
      ["post", "/v1/channels/{id}/commission-rate"],
      ["patch", "/v1/payment-methods/{id}"],
      ["post", "/v1/settings/payments/confirm-cash-only"],
      ["post", "/v1/settings/plan"],
      ["get", "/v1/reports/today"],
    ];
    for (const [method, path] of v11Routes) {
      const op = doc.paths[path]?.[method];
      expect(op, `${method.toUpperCase()} ${path} should be documented`).toBeTruthy();
      expect(op.summary, `${method.toUpperCase()} ${path} should have a summary`).toBeTruthy();
      if (op.requestBody) {
        const schema = op.requestBody.content["application/json"].schema;
        expect(schema, `${method.toUpperCase()} ${path} request schema should not be empty`).not.toEqual({});
      }
    }
    expect(Object.keys(doc.paths).length).toBeGreaterThanOrEqual(35 + v11Routes.length);
  });

  it("mints a usable token from the dev-only login, but only outside production", async () => {
    const email = `${uuidv7()}@example.com`;
    const call = ctx.client();
    const login = await call("POST", "/v1/dev/login", { email });
    expect(login.status).toBe(200);
    expect(login.json.userId).toBeTruthy();

    const me = await ctx.client(login.json.token as string)("GET", "/v1/me");
    expect(me.status).toBe(200);

    // Same email twice reuses the same auth.users row instead of duplicating it.
    const again = await call("POST", "/v1/dev/login", { email });
    expect(again.json.userId).toBe(login.json.userId);

    const prodApp = createApp({ ...ctx.deps, config: { ...ctx.deps.config, env: "production" } });
    const prodRes = await prodApp.request("/v1/dev/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    expect(prodRes.status).toBe(404);
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

  it("edits a menu item's price and swaps its recipe without touching other items", async () => {
    const created = await s.call("POST", "/v1/menu-items", {
      categoryName: "กาแฟ",
      name: "มอคค่าเย็น",
      price: 70,
      kitchenRoute: "bar",
      recipe: [{ ingredientId: s.coffee, qty: 18 }],
    });
    const mocha = created.json.id;

    const patched = await s.call("PATCH", `/v1/menu-items/${mocha}`, { price: 75, active: false });
    expect(patched.status).toBe(200);
    expect(patched.json.price).toBe("75.00");
    expect(patched.json.active).toBe(false);

    // Latte's own price and recipe are untouched.
    const latteStillFine = await s.call("GET", `/v1/menu-items/${s.latte}/costing`);
    expect(latteStillFine.json.cost).toBe("16.20");

    const resweaped = await s.call("PATCH", `/v1/menu-items/${mocha}`, { recipe: [{ ingredientId: s.coffee, qty: 18 }, { ingredientId: s.milk, qty: 180 }] });
    expect(resweaped.status).toBe(200);
    const costing = await s.call("GET", `/v1/menu-items/${mocha}/costing`);
    expect(costing.json.cost).toBe("16.20"); // same recipe as the latte now
    expect(costing.json.lines).toHaveLength(2);

    const empty = await s.call("PATCH", `/v1/menu-items/${mocha}`, {});
    expect(empty.status).toBe(422);
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

  it("boots the whole shop — settings, branches, catalog, roles, team, plan — in one request", async () => {
    const r = await s.call("GET", "/v1/shop");
    expect(r.status).toBe(200);
    expect(r.json.tenant.name).toBe("สบายคาเฟ่");
    expect(r.json.tenant.vatRegistered).toBe(true);
    expect(r.json.plan.code).toBe("pro");
    expect(r.json.branches.map((b: any) => b.id)).toContain(s.branchId);
    const branch = r.json.branches.find((b: any) => b.id === s.branchId);
    expect(branch.stations.length).toBeGreaterThan(0);
    expect(r.json.ingredients.map((i: any) => i.name)).toEqual(expect.arrayContaining(["เมล็ดกาแฟ", "นมสด"]));
    const latte = r.json.menuItems.find((i: any) => i.id === s.latte);
    expect(latte.price).toBe("65.00");
    expect(latte.recipe).toEqual(expect.arrayContaining([expect.objectContaining({ ingredientId: s.coffee, qty: 18 })]));
    expect(r.json.roles.find((role: any) => role.key === "owner").permissions).toEqual(["*"]);
    expect(r.json.members.map((m: any) => m.role_key)).toContain("owner");
    // No cap set means the SQL default (100%), so the client never has to guess.
    expect(r.json.members.find((m: any) => m.role_key === "owner").max_discount_rate).toBe(1);
  });

  it("keeps per-unit ingredient costs at full precision and names each table's area", async () => {
    const [area] = await ctx.sql<{ id: string }[]>`
      insert into app.dining_areas (tenant_id, branch_id, name) values (${s.tenantId}, ${s.branchId}, 'ระเบียง') returning id`;
    await ctx.sql`insert into app.dining_tables (tenant_id, branch_id, area_id, name, seats) values (${s.tenantId}, ${s.branchId}, ${area!.id}, 'B1', 4)`;
    await ctx.sql`insert into app.dining_tables (tenant_id, branch_id, name, seats) values (${s.tenantId}, ${s.branchId}, 'ริมทาง', 2)`;

    const r = await s.call("GET", "/v1/shop");
    // 0.045 ฿/ml is below one satang; rounding it to 2 decimals would make the shop's stock valuation wrong.
    expect(r.json.ingredients.find((i: any) => i.id === s.milk).standard_cost).toBe(0.045);
    expect(r.json.ingredients.find((i: any) => i.id === s.coffee).standard_cost).toBe(0.45);
    const tables = r.json.branches.find((b: any) => b.id === s.branchId).tables;
    expect(tables.find((t: any) => t.name === "B1")).toMatchObject({ area_id: area!.id, area_name: "ระเบียง", seats: 4 });
    expect(tables.find((t: any) => t.name === "ริมทาง")).toMatchObject({ area_id: null, area_name: null });
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

    const receipts = await s.call("GET", `/v1/receipts?branchId=${s.branchId}`);
    expect(receipts.json[0].id).toBe(r.json.id);
    expect(receipts.json[0].total).toBe("1300.00");

    const movements = await s.call("GET", `/v1/stock-movements?branchId=${s.branchId}&ingredientId=${s.coffee}`);
    expect(movements.json).toHaveLength(1);
    expect(movements.json[0]).toMatchObject({ reason: "purchase", qty: 2000 });
  });

  it("orders from a supplier and lists purchase orders by status", async () => {
    const [supplier] = await ctx.sql<{ id: string }[]>`
      insert into app.suppliers (tenant_id, name) values (${s.tenantId}, 'ฟาร์มนมสด') returning id`;
    const [location] = await ctx.sql<{ id: string }[]>`select id from app.stock_locations where branch_id = ${s.branchId} and is_default`;

    const po = await s.call("POST", "/v1/purchase-orders", {
      branchId: s.branchId,
      supplierId: supplier!.id,
      lines: [{ ingredientId: s.milk, packName: "ขวด 2 ลิตร", packQty: 2000, qtyPacks: 5, unitPrice: 100 }],
    });
    expect(po.status).toBe(201);
    expect(po.json.status).toBe("draft");

    const draftList = await s.call("GET", `/v1/purchase-orders?branchId=${s.branchId}&status=draft`);
    expect(draftList.json.map((x: any) => x.id)).toContain(po.json.id);
    expect(draftList.json[0].supplier).toBe("ฟาร์มนมสด");

    // The shop bootstrap tells the client how each ingredient is usually bought; receiving and purchasing pre-fill from it.
    await ctx.sql`
      insert into app.supplier_items (tenant_id, supplier_id, ingredient_id, pack_name, pack_qty, last_price, is_preferred)
      values (${s.tenantId}, ${supplier!.id}, ${s.milk}, 'ขวด 2 ลิตร', 2000, 100, true)`;
    const shop = await s.call("GET", "/v1/shop");
    expect(shop.json.suppliers.find((x: any) => x.id === supplier!.id).items).toEqual([
      { ingredientId: s.milk, packName: "ขวด 2 ลิตร", packQty: 2000, lastPrice: "100.00", isPreferred: true },
    ]);

    const count = await s.call("POST", "/v1/stock-counts", { locationId: location!.id, scope: "partial", ingredientIds: [s.coffee] });
    expect(count.status).toBe(201);
    const counts = await s.call("GET", `/v1/stock-counts?branchId=${s.branchId}`);
    expect(counts.json.map((x: any) => x.id)).toContain(count.json.id);
    expect(counts.json.find((x: any) => x.id === count.json.id).status).toBe("in_progress");
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
    // Each ticket item says which order line it is (its own id is what "toggle" takes).
    expect(ticket.items.every((i: any) => i.id && i.order_item_id && i.id !== i.order_item_id)).toBe(true);
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
    // business_date is a plain calendar date, never a full ISO datetime.
    expect(detail.json.businessDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const list = await s.call("GET", `/v1/orders?branchId=${s.branchId}`);
    expect(list.json.find((o: any) => o.id === s.order).business_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const shift = await s.call("GET", `/v1/shifts/current?branchId=${s.branchId}`);
    expect(shift.json.shift.business_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(shift.json.shift.opened_by).toBeTruthy();
    expect(shift.json.shift.cash_movements).toEqual([]);

    // detail=full returns whole orders in one round trip, in the same shape as the single-order detail.
    const full = await s.call("GET", `/v1/orders?branchId=${s.branchId}&detail=full`);
    const one = full.json.find((o: any) => o.id === s.order);
    expect(one).toMatchObject({ status: "paid", branchId: s.branchId, discount: null, commissionRate: 0, total: "185.00", shiftId: s.shift });
    expect(one.items).toHaveLength(2);
    expect(one.payments[0]).toMatchObject({ method_id: s.cash, kind: "payment", fee_amount: "0.00" });
    expect(one.openedBy).toBeTruthy();
    expect(one.paidAt).toBeTruthy();
  });

  it("keeps kitchen in the loop and lets cooks undo a mistaken bump", async () => {
    expect((await s.call("POST", `/v1/kds/tickets/${s.ticket}/status`, { status: "ready" })).status).toBe(200);
    expect((await s.call("POST", `/v1/kds/tickets/${s.ticket}/status`, { status: "in_progress" })).status).toBe(200);
    const tickets = await s.call("GET", `/v1/kds/tickets?branchId=${s.branchId}`);
    const ticket = tickets.json.tickets.find((t: any) => t.id === s.ticket);
    expect(ticket.status).toBe("in_progress");
    expect(ticket.items.every((i: any) => i.status === "pending")).toBe(true);
  });

  it("toggles one item on a ticket done without bumping the other items", async () => {
    const before = (await s.call("GET", `/v1/kds/tickets?branchId=${s.branchId}`)).json.tickets.find((t: any) => t.id === s.ticket);
    const [first, second] = before.items;

    const toggle = await s.call("POST", `/v1/kds/ticket-items/${first.id}/toggle`);
    expect(toggle.status).toBe(200);

    const after = (await s.call("GET", `/v1/kds/tickets?branchId=${s.branchId}`)).json.tickets.find((t: any) => t.id === s.ticket);
    expect(after.items.find((i: any) => i.id === first.id).status).toBe("done");
    expect(after.items.find((i: any) => i.id === second.id).status).toBe("pending");

    // Toggling again undoes it.
    await s.call("POST", `/v1/kds/ticket-items/${first.id}/toggle`);
    const reverted = (await s.call("GET", `/v1/kds/tickets?branchId=${s.branchId}`)).json.tickets.find((t: any) => t.id === s.ticket);
    expect(reverted.items.find((i: any) => i.id === first.id).status).toBe("pending");
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
      expect(detail.json.discount).toEqual({ type: "percent", value: 12.5, reason: "โปรเปิดร้าน" });
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
    s.cashierId = add.json.id;
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

  it("edits a member's discount limit and branch scope, suspends and reactivates them, and resets their PIN", async () => {
    const patch = await s.call("PATCH", `/v1/members/${s.cashierId}`, { maxDiscountRate: 0.2, branchIds: [s.branchId] });
    expect(patch.status).toBe(200);
    const members = await s.call("GET", "/v1/members");
    expect(members.json.find((m: any) => m.id === s.cashierId).all_branches).toBe(false);

    await s.call("PATCH", `/v1/members/${s.cashierId}`, { status: "suspended" });
    const blocked = await s.call("POST", "/v1/auth/pin", { branchId: s.branchId, pin: "1111" });
    expect(blocked.status).toBe(401);

    await s.call("PATCH", `/v1/members/${s.cashierId}`, { status: "active" });
    const reset = await s.call("POST", `/v1/members/${s.cashierId}/pin`, { pin: "2468" });
    expect(reset.status).toBe(200);

    const oldPin = await s.call("POST", "/v1/auth/pin", { branchId: s.branchId, pin: "1111" });
    expect(oldPin.status).toBe(401);
    const newPin = await s.call("POST", "/v1/auth/pin", { branchId: s.branchId, pin: "2468" });
    expect(newPin.json.membership.role).toBe("cashier");

    const empty = await s.call("PATCH", `/v1/members/${s.cashierId}`, {});
    expect(empty.status).toBe(422);
  });

  it("changes what a role is allowed to do", async () => {
    const [waiterRole] = await ctx.sql<{ id: string }[]>`select id from app.roles where tenant_id = ${s.tenantId} and key = 'waiter'`;
    const set = await s.call("PUT", `/v1/roles/${waiterRole!.id}/permissions`, { permissions: ["pos.order", "pos.discount"] });
    expect(set.status).toBe(200);
    expect(set.json.permissions).toEqual(["pos.order", "pos.discount"]);
    const rows = await ctx.sql<{ permission_key: string }[]>`select permission_key from app.role_permissions where role_id = ${waiterRole!.id} order by permission_key`;
    expect(rows.map((r) => r.permission_key)).toEqual(["pos.discount", "pos.order"]);
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

  it("shows today vs the same time last week, with a 14-day spark line", async () => {
    const r = await s.call("GET", `/v1/reports/today?branchId=${s.branchId}`);
    expect(r.status).toBe(200);
    expect(r.json.today).toBe(s.date);
    expect(r.json.orders).toBe(1);
    expect(r.json.sales).toBe("185.00");
    expect(r.json.open).toBe(0);
    // No sales a week ago in this brand-new shop.
    expect(r.json.lastWeekSales).toBe("0.00");
    expect(r.json.lastWeekOrders).toBe(0);
    expect(r.json.spark).toHaveLength(15);
    expect(r.json.spark.at(-1)).toBe("185.00");

    const cashierTry = await s.cashierCall("GET", `/v1/reports/today?branchId=${s.branchId}`);
    expect(cashierTry.status).toBe(403);
  });

  it("closes shift and day; the books balance", async () => {
    const close = await s.call("POST", `/v1/shifts/${s.shift}/close`, { countedCash: 1185, denominations: { "1000": 1, "100": 1, "50": 1, "20": 1, "10": 1, "5": 1 } });
    expect(close.json.variance).toBe("0.00");
    const day = await s.call("POST", `/v1/days/${s.date}/close`, { branchId: s.branchId, note: "วันแรก" });
    expect(day.status).toBe(200);
    expect(day.json.total).toBe("185.00");
    const [bal] = await ctx.sql<{ ok: boolean }[]>`select sum(debit) = sum(credit) as ok from app.journal_lines where tenant_id = ${s.tenantId}`;
    expect(bal!.ok).toBe(true);

    const shifts = await s.call("GET", `/v1/shifts?branchId=${s.branchId}&status=closed`);
    expect(shifts.json[0]).toMatchObject({ id: s.shift, cash_variance: "0.00" });

    const days = await s.call("GET", `/v1/days?branchId=${s.branchId}`);
    expect(days.json[0]).toMatchObject({ business_date: s.date, status: "closed" });
  });

  it("answers the owner's questions in one report", async () => {
    const r = await s.call("GET", `/v1/reports/summary?from=${s.date}&to=${s.date}`);
    expect(r.status).toBe(200);
    expect(r.json.totals.orders).toBe(1);
    expect(r.json.totals.netSales).toBe("172.90");
    const profit = r.json.waterfall.at(-1);
    expect(profit.key).toBe("profit");
    expect(Number(profit.value)).toBeGreaterThan(0);
    expect(r.json.items[0].name).toBe("ลาเต้เย็น");
    expect(r.json.channels[0].name).toBe("ทานที่ร้าน");
    // One order at 172.90 net sales, opened this hour — appears once in the 24-hour trend.
    expect(r.json.hours.reduce((a: number, b: number) => a + b, 0)).toBe(1);
    expect(r.json.hours).toHaveLength(24);
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

describe("settings", () => {
  it("edits the shop's own tax and rounding settings", async () => {
    const r = await s.call("PATCH", "/v1/tenant", { cashRounding: "1.00", vatRate: 0.07 });
    expect(r.status).toBe(200);
    const [tenant] = await ctx.sql<{ cash_rounding: string }[]>`select cash_rounding from app.tenants where id = ${s.tenantId}`;
    expect(tenant!.cash_rounding).toBe("1.00");

    const empty = await s.call("PATCH", "/v1/tenant", {});
    expect(empty.status).toBe(422);
  });

  it("adds a second branch and edits an existing one", async () => {
    const created = await s.call("POST", "/v1/branches", { code: "TL2", name: "สาขาทองหล่อ 2" });
    expect(created.status).toBe(201);

    const edited = await s.call("PATCH", `/v1/branches/${s.branchId}`, { phone: "021234567", serviceChargeRate: 0.1 });
    expect(edited.status).toBe(200);
    const [branch] = await ctx.sql<{ phone: string; service_charge_rate: string }[]>`select phone, service_charge_rate from app.branches where id = ${s.branchId}`;
    expect(branch!.phone).toBe("021234567");
    expect(Number(branch!.service_charge_rate)).toBe(0.1);
  });

  it("edits a sales channel and sets a new GP that only applies from a future date", async () => {
    const [channel] = s.channels.filter((c: any) => c.kind === "delivery_platform" || c.kind === "takeaway");
    const edited = await s.call("PATCH", `/v1/channels/${channel.id}`, { appliesServiceCharge: true });
    expect(edited.status).toBe(200);

    const rate = await s.call("POST", `/v1/channels/${channel.id}/commission-rate`, { rate: 0.28, validFrom: "2026-12-01", note: "เจรจาสัญญาใหม่" });
    expect(rate.status).toBe(200);
    const rows = await ctx.sql<{ rate: string; valid_from: string; valid_to: string | null }[]>`
      select rate, valid_from::text, valid_to::text from app.channel_commission_rates where channel_id = ${channel.id} order by valid_from`;
    expect(rows.at(-1)).toMatchObject({ rate: "0.2800", valid_from: "2026-12-01", valid_to: null });
  });

  it("lets a shop confirm cash-only instead of setting up PromptPay", async () => {
    const before = await s.call("GET", "/v1/onboarding");
    expect(before.json.steps.find((x: any) => x.key === "payments").status).not.toBe("done");

    const r = await s.call("POST", "/v1/settings/payments/confirm-cash-only");
    expect(r.status).toBe(200);
    const after = await s.call("GET", "/v1/onboarding");
    expect(after.json.steps.find((x: any) => x.key === "payments").status).toBe("done");
  });

  it("edits a payment method's PromptPay number and fee", async () => {
    const [pm] = await ctx.sql<{ id: string }[]>`select id from app.payment_methods where tenant_id = ${s.tenantId} and kind = 'promptpay'`;
    const r = await s.call("PATCH", `/v1/payment-methods/${pm!.id}`, { active: true, promptpayId: "0891234567", feeRate: 0 });
    expect(r.status).toBe(200);
    const [row] = await ctx.sql<{ is_active: boolean; config: { promptpay_id?: string } }[]>`select is_active, config from app.payment_methods where id = ${pm!.id}`;
    expect(row!.is_active).toBe(true);
    expect(row!.config.promptpay_id).toBe("0891234567");
  });

  it("changes the shop's plan", async () => {
    const r = await s.call("POST", "/v1/settings/plan", { planCode: "business" });
    expect(r.status).toBe(200);
    expect(r.json.planCode).toBe("business");
    const [sub] = await ctx.sql<{ plan_code: string }[]>`select plan_code from app.subscriptions where tenant_id = ${s.tenantId}`;
    expect(sub!.plan_code).toBe("business");

    const bad = await s.call("POST", "/v1/settings/plan", { planCode: "not_a_real_plan" });
    expect(bad.status).toBe(422);
  });
});

describe("purchasing and expense shortcuts", () => {
  it("records an expense by category, mapped to the right ledger account", async () => {
    const r = await s.call("POST", "/v1/expenses", { category: "utilities", description: "ค่าไฟเดือนนี้", amount: 1500, paidFrom: "bank" });
    expect(r.status).toBe(201);
    const [row] = await ctx.sql<{ account_id: string; system_key: string }[]>`
      select e.account_id, a.system_key from app.expenses e join app.accounts a on a.id = e.account_id where e.id = ${r.json.id}`;
    expect(row!.system_key).toBe("utilities");

    const missingBoth = await s.call("POST", "/v1/expenses", { description: "ไม่ระบุ", amount: 100, paidFrom: "bank" });
    expect(missingBoth.status).toBe(422);
  });

  it("turns a reorder suggestion into a draft purchase order", async () => {
    const [supplier] = await ctx.sql<{ id: string }[]>`insert into app.suppliers (tenant_id, name) values (${s.tenantId}, 'โรงคั่วใบชา') returning id`;
    const tea = await s.call("POST", "/v1/ingredients", { name: "ใบชาไทย", baseUnit: "g", reorderPoint: 100, parLevel: 1000 });
    expect(tea.status).toBe(201);
    await ctx.sql`
      insert into app.supplier_items (tenant_id, supplier_id, ingredient_id, pack_name, pack_qty, last_price, is_preferred)
      values (${s.tenantId}, ${supplier!.id}, ${tea.json.id}, 'ถุง 1 กก.', 1000, 250, true)`;

    const suggestions = await s.call("GET", `/v1/reorder-suggestions?branchId=${s.branchId}`);
    const line = suggestions.json.find((x: any) => x.ingredient_id === tea.json.id);
    expect(line).toBeTruthy();
    expect(line.suggested_packs).toBe(1);

    const po = await s.call("POST", "/v1/purchase-orders/from-suggestions", { branchId: s.branchId, supplierId: supplier!.id });
    expect(po.status).toBe(201);
    expect(po.json.status).toBe("draft");
    expect(po.json.lineCount).toBe(1);
    const lines = await ctx.sql<{ ingredient_id: string; qty_packs: string; unit_price: string }[]>`
      select ingredient_id, qty_packs, unit_price from app.purchase_order_lines where po_id = ${po.json.id}`;
    expect(lines).toEqual([expect.objectContaining({ ingredient_id: tea.json.id, unit_price: "250.0000" })]);

    // Once it's actually on order (not just a draft), it stops being suggested again.
    await s.call("POST", `/v1/purchase-orders/${po.json.id}/status`, { status: "submitted" });
    const noneLeft = await s.call("POST", "/v1/purchase-orders/from-suggestions", { branchId: s.branchId, supplierId: supplier!.id });
    expect(noneLeft.status).toBe(422);
  });
});
