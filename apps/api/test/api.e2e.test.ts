import { addDays, calculateOrderTotals, channelPrice, PERMISSIONS, toSatang } from "@sabai/domain";
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

  it("opening a shop is safe to retry: the same key gives the same shop, never a second one", async () => {
    const user = await ctx.newUser();
    const call = ctx.client(user.token);
    const body = { name: "ร้านลองซ้ำ", ownerName: "คุณซ้ำ" };
    const key = "signup-retry-key-0001";
    const first = await call("POST", "/v1/tenants", body, { "idempotency-key": key });
    expect(first.status).toBe(201);
    // The answer was lost on the way and the person pressed the button again.
    const again = await call("POST", "/v1/tenants", body, { "idempotency-key": key });
    expect(again.status).toBe(201);
    expect(again.headers.get("idempotent-replayed")).toBe("true");
    expect(again.json.tenant_id).toBe(first.json.tenant_id);
    expect((await call("GET", "/v1/me")).json.memberships).toHaveLength(1);
    // Different details under the same key is a mistake, not a retry.
    expect((await call("POST", "/v1/tenants", { ...body, name: "อีกร้าน" }, { "idempotency-key": key })).status).toBe(409);
    // Someone else using the same key text does not get this shop.
    const other = await ctx.newUser();
    const theirs = await ctx.client(other.token)("POST", "/v1/tenants", body, { "idempotency-key": key });
    expect(theirs.json.tenant_id).not.toBe(first.json.tenant_id);
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

    const patched = await s.call("PATCH", `/v1/menu-items/${mocha}`, { price: 75, active: false, emoji: "🧋" });
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

    // The picture chosen for the item comes back with the shop, and a new category takes it as its icon.
    const shop = await s.call("GET", "/v1/shop");
    expect(shop.json.menuItems.find((m: any) => m.id === mocha).emoji).toBe("🧋");
    expect(shop.json.menuItems.find((m: any) => m.id === s.latte).emoji).toBeNull();

    // An empty list clears the recipe (the shop then shows the item as having none).
    const cleared = await s.call("PATCH", `/v1/menu-items/${mocha}`, { recipe: [] });
    expect(cleared.status).toBe(200);
    const after = await s.call("GET", "/v1/shop");
    expect(after.json.menuItems.find((m: any) => m.id === mocha).recipe).toEqual([]);
  });

  it("gives a new category and a new ingredient the picture chosen for them", async () => {
    const dessert = await s.call("POST", "/v1/menu-items", { categoryName: "ของหวาน", emoji: "🍰", name: "เค้กช็อกโกแลต", price: 90, kitchenRoute: "kitchen" });
    expect(dessert.status).toBe(201);
    const shrimp = await s.call("POST", "/v1/ingredients", { name: "กุ้งแห้ง", baseUnit: "g", emoji: "🦐" });
    const shop = await s.call("GET", "/v1/shop");
    expect(shop.json.menuCategories.find((c: any) => c.name === "ของหวาน").icon).toBe("🍰");
    expect(shop.json.menuItems.find((m: any) => m.id === dessert.json.id).emoji).toBe("🍰");
    expect(shop.json.ingredients.find((i: any) => i.id === shrimp.json.id).emoji).toBe("🦐");
    const tooLong = await s.call("POST", "/v1/menu-items", { categoryName: "ของหวาน", emoji: "x".repeat(17), name: "อะไรสักอย่าง", price: 10 });
    expect(tooLong.status).toBe(422);
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
    // Where waste, counts and opening stock are recorded — the client can't guess a location id.
    expect(branch.stock_location_id).toBeTruthy();
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
    // Who recorded it is part of the answer (the movements list shows names, not "the system").
    expect(movements.json[0].created_by).toEqual(expect.any(String));
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

    // The full list carries what the purchasing screen needs: who it is from, its lines, and how much of each has arrived.
    const full = await s.call("GET", `/v1/purchase-orders?branchId=${s.branchId}&detail=full`);
    const listed = full.json.find((x: any) => x.id === po.json.id);
    expect(listed).toMatchObject({ supplier_id: supplier!.id, branch_id: s.branchId, status: "draft", total: "500.00" });
    expect(listed.lines).toEqual([expect.objectContaining({ ingredient_id: s.milk, pack_name: "ขวด 2 ลิตร", pack_qty: 2000, qty_packs: 5, unit_price: "100.00", received_packs: 0, id: expect.any(String) })]);
    expect(draftList.json[0].lines).toBeUndefined();

    // Approve, send, then receive against the order by naming its line: the order then knows what has arrived.
    const approved = await s.call("POST", `/v1/purchase-orders/${po.json.id}/status`, { status: "approved" });
    expect(approved.status).toBe(200);
    await s.call("POST", `/v1/purchase-orders/${po.json.id}/status`, { status: "sent" });
    const partly = await s.call("POST", "/v1/receipts", {
      branchId: s.branchId,
      poId: po.json.id,
      lines: [{ ingredientId: s.milk, packName: "ขวด 2 ลิตร", packQty: 2000, qtyPacks: 2, unitPrice: 100, poLineId: listed.lines[0].id }],
    });
    expect(partly.status).toBe(201);
    const afterPart = (await s.call("GET", `/v1/purchase-orders?branchId=${s.branchId}&detail=full`)).json.find((x: any) => x.id === po.json.id);
    expect(afterPart).toMatchObject({ status: "partially_received" });
    expect(afterPart.lines[0].received_packs).toBe(2);
    await s.call("POST", "/v1/receipts", { branchId: s.branchId, poId: po.json.id, lines: [{ ingredientId: s.milk, packName: "ขวด 2 ลิตร", packQty: 2000, qtyPacks: 3, unitPrice: 100, poLineId: listed.lines[0].id }] });
    const done = (await s.call("GET", `/v1/purchase-orders?branchId=${s.branchId}&detail=full`)).json.find((x: any) => x.id === po.json.id);
    expect(done).toMatchObject({ status: "received" });
    expect(done.lines[0].received_packs).toBe(5);

    const count = await s.call("POST", "/v1/stock-counts", { locationId: location!.id, scope: "partial", ingredientIds: [s.coffee] });
    expect(count.status).toBe(201);
    const counts = await s.call("GET", `/v1/stock-counts?branchId=${s.branchId}`);
    expect(counts.json.map((x: any) => x.id)).toContain(count.json.id);
    expect(counts.json.find((x: any) => x.id === count.json.id).status).toBe("in_progress");
  });

  it("adds an ingredient with its category, usual pack and opening stock in one step", async () => {
    const before = await s.call("GET", "/v1/shop");
    const supplier = before.json.suppliers[0];
    const r = await s.call("POST", "/v1/ingredients", {
      name: "น้ำตาลทราย",
      baseUnit: "g",
      displayUnit: "kg",
      categoryName: "ของแห้ง",
      pack: { name: "ถุง 1 กก.", qty: 1000, price: 25, supplierId: supplier.id },
      reorderPoint: 500,
      openingQty: 3000,
      branchId: s.branchId,
    });
    expect(r.status).toBe(201);

    const after = await s.call("GET", "/v1/shop");
    // The pack's price becomes the cost per gram until the first purchase: ฿25 / 1000 g.
    expect(after.json.ingredients.find((i: any) => i.id === r.json.id)).toMatchObject({ category: "ของแห้ง", standard_cost: 0.025 });
    expect(after.json.suppliers.find((x: any) => x.id === supplier.id).items).toEqual(
      expect.arrayContaining([{ ingredientId: r.json.id, packName: "ถุง 1 กก.", packQty: 1000, lastPrice: "25.00", isPreferred: true }]),
    );
    const stock = await s.call("GET", `/v1/stock?branchId=${s.branchId}`);
    expect(stock.json.find((x: any) => x.ingredient_id === r.json.id).qty_on_hand).toBe(3000);
    const moves = await s.call("GET", `/v1/stock-movements?branchId=${s.branchId}&ingredientId=${r.json.id}`);
    expect(moves.json).toHaveLength(1);
    expect(moves.json[0]).toMatchObject({ reason: "opening", qty: 3000, unit_cost: 0.025 });

    // The same category name is reused, not duplicated.
    const again = await s.call("POST", "/v1/ingredients", { name: "แป้งสาลี", baseUnit: "g", categoryName: "ของแห้ง" });
    expect(again.status).toBe(201);
    const cats = await ctx.sql<{ n: number }[]>`select count(*)::int as n from app.ingredient_categories where tenant_id = ${s.tenantId} and name = 'ของแห้ง'`;
    expect(cats[0]!.n).toBe(1);

    // Opening stock has to say which branch it is in.
    const bad = await s.call("POST", "/v1/ingredients", { name: "เกลือ", baseUnit: "g", openingQty: 10 });
    expect(bad.status).toBe(422);
    expect(bad.json.error.fields.branchId).toBeTruthy();
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

    // The till's offline queue sends a payment again with the key it first used (checklist 5.2): if the first try got through
    // and only the answer was lost, the repeat must be answered with the first result, not take the payment twice.
    const payKey = `pay-${s.order}`;
    const payBody = { payments: [{ methodId: s.cash, amount: 185, tendered: 500 }] };
    const paid = await s.call("POST", `/v1/orders/${s.order}/pay`, payBody, { "idempotency-key": payKey });
    expect(paid.json.status).toBe("paid");
    expect(paid.json.change).toBe("315.00");
    expect(paid.json.receiptNo).toMatch(/^HQ-\d{4}-00001$/);
    const paidAgain = await s.call("POST", `/v1/orders/${s.order}/pay`, payBody, { "idempotency-key": payKey });
    expect(paidAgain.headers.get("idempotent-replayed")).toBe("true");
    expect(paidAgain.json).toEqual(paid.json);

    const again = await s.call("POST", `/v1/orders/${s.order}/pay`, { payments: [{ methodId: s.cash, amount: 185 }] });
    expect(again.json.status).toBe("paid");

    const detail = await s.call("GET", `/v1/orders/${s.order}`);
    expect(detail.json.items).toHaveLength(2);
    expect(detail.json.payments).toHaveLength(1); // however many times it was sent
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

    const ok = await s.call("POST", "/v1/auth/pin", { branchId: s.branchId, pin: "1111" }, { "idempotency-key": "pin-signin-key-0001" });
    expect(ok.json.membership.role).toBe("cashier");
    expect(ok.json.membership.home).toBe("pos");
    s.cashierCall = ctx.client(ok.json.token, s.tenantId);
    // A sign-in mints a credential: its answer must never sit in the replay table, key or no key.
    const [stored] = await ctx.sql<{ n: string }[]>`select count(*) as n from app.api_idempotency where path in ('/v1/auth/pin', '/v1/approvals')`;
    expect(Number(stored!.n)).toBe(0);
  });

  it("only someone who belongs to a shop may try its PINs", async () => {
    const stranger = await ctx.newUser();
    const r = await ctx.client(stranger.token)("POST", "/v1/auth/pin", { branchId: s.branchId, pin: "1111" });
    // The branch is not even visible to them: "not found", which does not confirm it exists.
    expect(r.status).toBe(404);
  });

  it("registers a till: staff sign in on it with a PIN and no account, and revoking stops it at once", async () => {
    const { createHash, randomBytes } = await import("node:crypto");
    const secret = `sbd_${randomBytes(32).toString("base64url")}`;
    const tokenHash = createHash("sha256").update(secret).digest("hex");

    // Registering takes the right to manage settings: the cashier has not got it.
    const denied = await s.cashierCall("POST", "/v1/devices", { branchId: s.branchId, name: "เครื่องแอบ", kind: "pos", tokenHash: "a".repeat(64) });
    expect(denied.status).toBe(403);
    const bad = await s.call("POST", "/v1/devices", { branchId: s.branchId, name: "x", kind: "pos", tokenHash: "not-a-hash" });
    expect(bad.status).toBe(422);

    const reg = await s.call("POST", "/v1/devices", { branchId: s.branchId, name: "iPad หน้าร้าน", kind: "pos", tokenHash });
    expect(reg.status).toBe(201);
    expect(JSON.stringify(reg.json)).not.toContain(secret);
    const list = await s.call("GET", "/v1/devices");
    expect(list.json).toEqual([expect.objectContaining({ id: reg.json.id, name: "iPad หน้าร้าน", kind: "pos", is_active: true, registered_by_name: expect.any(String) })]);
    expect((await s.cashierCall("GET", "/v1/devices")).status).toBe(403);
    // Neither the secret nor its hash is anywhere a signed-in person can read.
    expect(JSON.stringify(list.json)).not.toContain(tokenHash);

    // The till, with nobody signed in.
    const till = ctx.client();
    const anonRoster = await till("GET", "/v1/device/roster");
    expect(anonRoster.status).toBe(401);
    expect(anonRoster.json.error.code).toBe("DEVICE_REVOKED");
    const roster = await till("GET", "/v1/device/roster", undefined, { "x-device-token": secret });
    expect(roster.status).toBe(200);
    expect(roster.headers.get("cache-control")).toBe("no-store");
    expect(roster.json.tenant.id).toBe(s.tenantId);
    expect(roster.json.branch.id).toBe(s.branchId);
    const names = roster.json.staff.map((x: any) => x.displayName);
    expect(names).toEqual(expect.arrayContaining(["น้องแคช", "พี่ผู้จัดการ"]));
    expect(JSON.stringify(roster.json)).not.toMatch(/pin_hash|\$2[aby]\$/);

    const wrong = await till("POST", "/v1/auth/device-pin", { pin: "0000" }, { "x-device-token": secret });
    expect(wrong.status).toBe(401);
    expect(wrong.json.error.code).toBe("PIN_INVALID");
    const noDevice = await till("POST", "/v1/auth/device-pin", { pin: "1111" }, { "x-device-token": `sbd_${randomBytes(32).toString("base64url")}` });
    expect(noDevice.status).toBe(401);
    expect(noDevice.json.error.code).toBe("DEVICE_REVOKED");

    const ok = await till("POST", "/v1/auth/device-pin", { pin: "1111" }, { "x-device-token": secret });
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({ tenantId: s.tenantId, branchId: s.branchId, membership: { role: "cashier", home: "pos" } });
    // The token it gives is an ordinary staff token: it works, as the cashier, and it names the till.
    const me = await ctx.client(ok.json.token, s.tenantId)("GET", "/v1/me");
    expect(me.json.memberships[0].displayName).toBe("น้องแคช");
    expect(JSON.parse(Buffer.from(ok.json.token.split(".")[1], "base64url").toString()).did).toBe(reg.json.id);
    // A sign-in answer never sits in the replay table.
    const [stored] = await ctx.sql<{ n: string }[]>`select count(*) as n from app.api_idempotency where path = '/v1/auth/device-pin'`;
    expect(Number(stored!.n)).toBe(0);

    // Revoke: the cashier cannot; the owner can; the till stops working at once, and doing it twice is harmless.
    expect((await s.cashierCall("DELETE", `/v1/devices/${reg.json.id}`)).status).toBe(403);
    expect((await s.call("DELETE", `/v1/devices/${reg.json.id}`)).status).toBe(200);
    expect((await s.call("DELETE", `/v1/devices/${reg.json.id}`)).status).toBe(200);
    expect((await till("GET", "/v1/device/roster", undefined, { "x-device-token": secret })).json.error.code).toBe("DEVICE_REVOKED");
    expect((await till("POST", "/v1/auth/device-pin", { pin: "1111" }, { "x-device-token": secret })).json.error.code).toBe("DEVICE_REVOKED");
    const after = await s.call("GET", "/v1/devices");
    expect(after.json[0]).toMatchObject({ is_active: false, revoked_at: expect.any(String) });
    const [events] = await ctx.sql<{ n: string }[]>`select count(*) as n from app.domain_events where event_type = 'device.revoked' and aggregate_id = ${reg.json.id}`;
    expect(Number(events!.n)).toBe(1);
  });

  it("gives the cashier only the cashier's world", async () => {
    const me = await s.cashierCall("GET", "/v1/me");
    expect(me.json.memberships[0].navigation.primary.map((n: any) => n.key)).toEqual(["pos", "orders", "kds"]);
    const report = await s.cashierCall("GET", "/v1/reports/summary?from=2026-01-01&to=2026-12-31");
    expect(report.status).toBe(403);
    expect(report.json.error.title).toBe("ต้องให้ผู้จัดการช่วย");
  });

  it("lets a role that may only manage recipes change a recipe, but not the price", async () => {
    const [role] = await ctx.sql<{ id: string }[]>`select id from app.roles where tenant_id = ${s.tenantId} and key = 'cashier'`;
    // (Managing recipes goes with seeing them: a row that cannot be read back cannot be written either.)
    await ctx.sql`insert into app.role_permissions (tenant_id, role_id, permission_key) select ${s.tenantId}, ${role!.id}, k from unnest(array['recipes.view', 'recipes.manage']) k`;
    try {
      const recipeOnly = await s.cashierCall("PATCH", `/v1/menu-items/${s.americano}`, { recipe: [{ ingredientId: s.coffee, qty: 20 }] });
      expect(recipeOnly.status).toBe(200);
      const price = await s.cashierCall("PATCH", `/v1/menu-items/${s.americano}`, { price: 1 });
      expect(price.status).toBe(403);
      const both = await s.cashierCall("PATCH", `/v1/menu-items/${s.americano}`, { price: 1, recipe: [] });
      expect(both.status).toBe(403);
    } finally {
      await ctx.sql`delete from app.role_permissions where role_id = ${role!.id} and permission_key in ('recipes.view', 'recipes.manage')`;
    }
    const withoutIt = await s.cashierCall("PATCH", `/v1/menu-items/${s.americano}`, { recipe: [] });
    expect(withoutIt.status).toBe(403);
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

  it("will not let someone lock themselves out, remove the last owner, or reuse a PIN", async () => {
    // The owner is signed in as themself here: suspending yourself is refused with a reason.
    const me = await s.call("GET", "/v1/members");
    const owner = me.json.find((m: any) => m.role_key === "owner");
    const self = await s.call("PATCH", `/v1/members/${owner.id}`, { status: "suspended" });
    expect(self.status).toBe(422);
    expect(self.json.error.code).toBe("CANNOT_DEACTIVATE_SELF");
    const demoted = await s.call("PATCH", `/v1/members/${owner.id}`, { roleKey: "manager" });
    expect(demoted.json.error.code).toBe("LAST_OWNER");

    // Two people cannot share a PIN: the shared-device screen could not tell them apart.
    const twin = await s.call("POST", "/v1/members", { displayName: "ซ้ำ", roleKey: "waiter", pin: "9999" });
    expect(twin.json.error.code).toBe("PIN_IN_USE");
    const after = await s.call("GET", "/v1/members");
    expect(after.json.map((m: any) => m.display_name)).not.toContain("ซ้ำ");
  });

  it("counts bringing a suspended person back against the plan's staff limit", async () => {
    const add = await s.call("POST", "/v1/members", { displayName: "ชั่วคราว", roleKey: "waiter", pin: "8765" });
    expect(add.status).toBe(201);
    await s.call("PATCH", `/v1/members/${add.json.id}`, { status: "suspended" });
    const [sub] = await ctx.sql<{ addons: unknown }[]>`select addons from app.subscriptions where tenant_id = ${s.tenantId}`;
    const [active] = await ctx.sql<{ n: string }[]>`select count(*) as n from app.memberships where tenant_id = ${s.tenantId} and status in ('active','invited')`;
    const n = active!.n;
    // Allow exactly the people who are active now, so one more is over the limit.
    await ctx.sql`update app.subscriptions set addons = ${ctx.sql.json({ limits: { staff: Number(n) } })} where tenant_id = ${s.tenantId}`;
    try {
      const back = await s.call("PATCH", `/v1/members/${add.json.id}`, { status: "active" });
      expect(back.status).toBe(402);
      expect(back.json.error.code).toBe("PLAN_LIMIT_REACHED");
    } finally {
      await ctx.sql`update app.subscriptions set addons = ${ctx.sql.json((sub?.addons ?? {}) as never)} where tenant_id = ${s.tenantId}`;
    }
    const ok = await s.call("PATCH", `/v1/members/${add.json.id}`, { status: "active" });
    expect(ok.status).toBe(200);
  });

  it("does not edit the owner's rights: they have all of them by definition", async () => {
    const [ownerRole] = await ctx.sql<{ id: string }[]>`select id from app.roles where tenant_id = ${s.tenantId} and key = 'owner'`;
    const r = await s.call("PUT", `/v1/roles/${ownerRole!.id}/permissions`, { permissions: ["pos.order"] });
    expect(r.status).toBe(403);
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

describe("live events", () => {
  /** Reads the branch's event stream until `until` returns true for the text so far (or time runs out). */
  async function listen(headers: Record<string, string>, branchId: string, act: () => Promise<unknown>, until: (text: string) => boolean) {
    const abort = new AbortController();
    const res = await ctx.app.request(`/v1/events?branchId=${branchId}`, { headers, signal: abort.signal });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    const read = (async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        if (until(text)) break;
      }
    })();
    // The stream says "ready" before anything is done, so nothing that follows can be missed.
    for (let i = 0; i < 100 && !text.includes("event: ready"); i++) await new Promise((r) => setTimeout(r, 10));
    await act();
    await Promise.race([read, new Promise((r) => setTimeout(r, 4000))]);
    abort.abort();
    return text;
  }

  it("tells every open screen of the branch what just happened, with ids only", async () => {
    const headers = { authorization: `Bearer ${s.owner.token}`, "x-tenant-id": s.tenantId };
    const id = uuidv7();
    const text = await listen(headers, s.branchId, () => s.call("POST", "/v1/orders", { id, branchId: s.branchId, items: [{ id: uuidv7(), menuItemId: s.latte, qty: 1 }] }), (t) => t.includes("order.opened") && t.includes("kitchen.ticket_fired"));
    expect(text).toContain("event: ready");
    const events = [...text.matchAll(/event: domain\ndata: (.*)\n/g)].map((m) => JSON.parse(m[1]!));
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(["order.opened"]));
    expect(events.find((e) => e.type === "order.opened")).toEqual({ id: expect.any(String), type: "order.opened", aggregateId: id });
    // Ids only: no names, no money.
    expect(JSON.stringify(events)).not.toMatch(/ลาเต้|total|price/);
    await s.call("POST", `/v1/orders/${id}/void`, { reason: "ทดสอบ" });
  });

  it("does not tell a screen about another shop, and needs a signed-in person", async () => {
    const other = await ctx.newUser();
    const created = await ctx.client(other.token)("POST", "/v1/tenants", { name: "ร้านข้างบ้านสอง", ownerName: "ซี" });
    const theirs = ctx.client(other.token, created.json.tenant_id);
    const ourHeaders = { authorization: `Bearer ${s.owner.token}`, "x-tenant-id": s.tenantId };
    const text = await listen(ourHeaders, s.branchId, () => theirs("POST", "/v1/branches", { code: "ZZ9", name: "สาขาของเขา" }), (t) => t.includes("branch.created"));
    expect(text).not.toContain("branch.created");

    const anon = await ctx.app.request(`/v1/events?branchId=${s.branchId}`);
    expect(anon.status).toBe(401);
    // Someone from another shop cannot open this branch's stream.
    const peek = await ctx.app.request(`/v1/events?branchId=${s.branchId}`, { headers: { authorization: `Bearer ${other.token}`, "x-tenant-id": created.json.tenant_id } });
    expect([403, 404]).toContain(peek.status);
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
    // Everything the report screen draws comes back in one answer: costs and fees per channel, cost and mix per item.
    expect(r.json.channels[0]).toEqual(expect.objectContaining({ cost: expect.any(String), commission: expect.any(String), paymentFees: expect.any(String), contribution: expect.any(String), marginPct: expect.any(Number), shareOfContribution: 100 }));
    expect(r.json.items[0]).toEqual(expect.objectContaining({ cost: expect.any(String), contributionPerItem: expect.any(String), mixPct: expect.any(Number), class: expect.any(String) }));
    expect(r.json.days[0]).toEqual(expect.objectContaining({ date: s.date, profit: expect.any(String) }));
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
    // Who did it and what it was about, so the screen can say "คุณปิยะ ..." and link a price rise to its ingredient.
    // Shifts and other actions that never passed an actor still say who did them.
    expect(r.json.find((e: any) => e.type === "shift.opened")).toEqual(expect.objectContaining({ actor: expect.any(String), actor_id: expect.any(String) }));
    expect(r.json.find((e: any) => e.type === "order.paid")).toEqual(expect.objectContaining({ actor: expect.any(String), actor_id: expect.any(String), entity_type: "order", entity_id: expect.any(String) }));
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

  it("keeps what a receipt says about the shop: legal name, a checked taxpayer number, a footer line — and the branch's tax number", async () => {
    const wrong = await s.call("PATCH", "/v1/tenant", { taxId: "1101700230705" });
    expect(wrong.status).toBe(422);
    expect(wrong.json.error.fields.taxId).toContain("ไม่ถูกต้อง");
    expect((await s.call("PATCH", "/v1/tenant", { taxId: "12345" })).status).toBe(422);

    const ok = await s.call("PATCH", "/v1/tenant", { legalName: "บริษัท สบายคาเฟ่ จำกัด", taxId: "1101700230708", receiptFooter: "ขอบคุณค่ะ ไวไฟ sabai1234" });
    expect(ok.status).toBe(200);
    const shop = await s.call("GET", "/v1/shop");
    expect(shop.json.tenant).toMatchObject({ legalName: "บริษัท สบายคาเฟ่ จำกัด", taxId: "1101700230708", receiptFooter: "ขอบคุณค่ะ ไวไฟ sabai1234" });
    expect(shop.json.branches[0].tax_branch_no).toBe("00000");

    // Changing one thing leaves the others; null (or empty) clears just that one.
    await s.call("PATCH", "/v1/tenant", { receiptFooter: null });
    const after = (await s.call("GET", "/v1/shop")).json.tenant;
    expect(after).toMatchObject({ legalName: "บริษัท สบายคาเฟ่ จำกัด", taxId: "1101700230708", receiptFooter: null });
    await s.call("PATCH", "/v1/tenant", { legalName: "" });
    expect((await s.call("GET", "/v1/shop")).json.tenant.legalName).toBeNull();

    // Only someone who manages settings can change what goes on the receipts.
    expect((await s.cashierCall("PATCH", "/v1/tenant", { receiptFooter: "แอบแก้" })).status).toBe(403);

    expect((await s.call("PATCH", `/v1/branches/${s.branchId}`, { taxBranchNo: "12" })).status).toBe(422);
    expect((await s.call("PATCH", `/v1/branches/${s.branchId}`, { taxBranchNo: "00003" })).status).toBe(200);
    expect((await s.call("GET", "/v1/shop")).json.branches.find((b: any) => b.id === s.branchId).tax_branch_no).toBe("00003");
    await s.call("PATCH", `/v1/branches/${s.branchId}`, { taxBranchNo: "00000" });
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

  it("charges a channel's menu markup, rounded up to ฿5 exactly as the domain does, and shows the GP in force", async () => {
    const [channel] = s.channels.filter((c: any) => c.kind === "takeaway");
    const set = await s.call("PATCH", `/v1/channels/${channel.id}`, { priceMarkup: 0.15 });
    expect(set.status).toBe(200);

    // The catalog for that channel and the price an order is actually charged both follow the domain's rule.
    const expected = (baht: number) => channelPrice(toSatang(String(baht)), 0.15);
    const catalog = await s.call("GET", `/v1/catalog?branchId=${s.branchId}&channelId=${channel.id}`);
    const latte = catalog.json.items.find((i: any) => i.name === "ลาเต้เย็น");
    expect(toSatang(latte.price)).toBe(expected(65));
    const dineIn = await s.call("GET", `/v1/catalog?branchId=${s.branchId}`);
    expect(dineIn.json.items.find((i: any) => i.name === "ลาเต้เย็น").price).toBe("65.00");

    const id = uuidv7();
    await s.call("POST", "/v1/orders", { id, branchId: s.branchId, channelId: channel.id, items: [{ id: uuidv7(), menuItemId: s.latte, qty: 1 }] });
    const order = await s.call("GET", `/v1/orders/${id}`);
    expect(toSatang(order.json.items[0].unit_price)).toBe(expected(65));
    await s.call("POST", `/v1/orders/${id}/void`, { reason: "ทดสอบ" });

    // An explicit price for the item on that channel wins over the markup.
    await ctx.sql`insert into app.menu_item_prices (tenant_id, menu_item_id, channel_id, price) values (${s.tenantId}, ${s.latte}, ${channel.id}, 99)`;
    const overridden = await s.call("GET", `/v1/catalog?branchId=${s.branchId}&channelId=${channel.id}`);
    expect(overridden.json.items.find((i: any) => i.name === "ลาเต้เย็น").price).toBe("99.00");
    await ctx.sql`delete from app.menu_item_prices where channel_id = ${channel.id} and menu_item_id = ${s.latte}`;

    // The shop carries the markup, and the GP that is in force today rather than the one the channel started with.
    const shop = await s.call("GET", "/v1/shop");
    expect(shop.json.channels.find((c: any) => c.id === channel.id)).toMatchObject({ price_markup: 0.15 });
    const today = new Date().toISOString().slice(0, 10);
    await s.call("POST", `/v1/channels/${channel.id}/commission-rate`, { rate: 0.21, validFrom: today });
    const after = await s.call("GET", "/v1/shop");
    expect(after.json.channels.find((c: any) => c.id === channel.id).commission_rate).toBe(0.21);
    const tooMuch = await s.call("PATCH", `/v1/channels/${channel.id}`, { priceMarkup: 1.5 });
    expect(tooMuch.status).toBe(422);
    await s.call("PATCH", `/v1/channels/${channel.id}`, { priceMarkup: 0 });
  });

  it("keeps a branch's opening hours as the shop wrote them", async () => {
    const r = await s.call("PATCH", `/v1/branches/${s.branchId}`, { openingHours: "07:00–21:00" });
    expect(r.status).toBe(200);
    const shop = await s.call("GET", "/v1/shop");
    expect(shop.json.branches.find((b: any) => b.id === s.branchId).opening_hours).toEqual({ text: "07:00–21:00" });
    // Editing something else leaves them alone.
    await s.call("PATCH", `/v1/branches/${s.branchId}`, { phone: "021234567" });
    expect((await s.call("GET", "/v1/shop")).json.branches.find((b: any) => b.id === s.branchId).opening_hours).toEqual({ text: "07:00–21:00" });
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

  it("will not move to a plan the shop has outgrown, and needs the billing right to change plans", async () => {
    const [people] = await ctx.sql<{ n: string }[]>`select count(*) as n from app.memberships where tenant_id = ${s.tenantId} and status in ('active','invited')`;
    // Free allows three people; this shop has more, so it stays where it is.
    expect(Number(people!.n)).toBeGreaterThan(3);
    const down = await s.call("POST", "/v1/settings/plan", { planCode: "free" });
    expect(down.status).toBe(402);
    expect(down.json.error.code).toBe("PLAN_LIMIT_REACHED");
    const [sub] = await ctx.sql<{ plan_code: string }[]>`select plan_code from app.subscriptions where tenant_id = ${s.tenantId}`;
    expect(sub!.plan_code).toBe("business");

    // A cashier holds neither settings nor billing rights.
    const denied = await s.cashierCall("POST", "/v1/settings/plan", { planCode: "pro" });
    expect(denied.status).toBe(403);
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

  it("lists what the finance screen shows: expenses with their category, bills with their supplier, bank lines and the money still expected", async () => {
    const expenses = await s.call("GET", `/v1/expenses?branchId=${s.branchId}`);
    expect(expenses.json.find((e: any) => e.description === "ค่าเช่าร้าน")).toMatchObject({ account_key: "rent", paid_from: "bank", amount: "3000.00", branch_id: s.branchId, period_start: expect.any(String), period_end: expect.any(String) });
    // Someone else's branch is not in this branch's list; an expense with no branch belongs to the whole shop.
    const shopWide = await s.call("GET", "/v1/expenses");
    expect(shopWide.json.find((e: any) => e.description === "ค่าไฟเดือนนี้")).toMatchObject({ account_key: "utilities", branch_id: null });
    expect(expenses.json.map((e: any) => e.description)).not.toContain("ค่าไฟเดือนนี้");

    // The credit receipt made earlier against a supplier's order left a bill to pay.
    const bills = await s.call("GET", "/v1/bills");
    expect(bills.json.length).toBeGreaterThan(0);
    expect(bills.json[0]).toEqual(expect.objectContaining({ supplier_id: expect.any(String), supplier: "ฟาร์มนมสด", status: "open" }));
    const partial = await s.call("POST", `/v1/bills/${bills.json[0].id}/pay`, { amount: 100 });
    expect(partial.status).toBe(200);
    const afterPay = await s.call("GET", "/v1/bills");
    expect(afterPay.json.find((b: any) => b.id === bills.json[0].id)).toMatchObject({ status: "partially_paid", amount_paid: "100.00" });

    // Money expected from the card company, and the bank line that arrives for it.
    const [bank] = await ctx.sql<{ id: string }[]>`select id from app.accounts where tenant_id = ${s.tenantId} and system_key = 'bank'`;
    const [clearing] = await ctx.sql<{ id: string }[]>`select id from app.accounts where tenant_id = ${s.tenantId} and system_key = 'card_clearing'`;
    const [exp] = await ctx.sql<{ id: string }[]>`
      insert into app.expected_receipts (tenant_id, branch_id, business_date, source_type, label, clearing_account_id, bank_account_id, expected_date, expected_amount)
      values (${s.tenantId}, ${s.branchId}, ${s.date}, 'card_batch', 'บัตร ทดสอบ', ${clearing!.id}, ${bank!.id}, ${s.date}, 480) returning id`;
    const imported = await s.call("POST", "/v1/bank-statements", { bankAccountId: bank!.id, lines: [{ txnDate: s.date, amount: 480, description: "KBank card settlement" }] });
    expect(imported.status).toBe(201);

    const before = await s.call("GET", "/v1/reconciliation");
    expect(before.json.expected.find((e: any) => e.id === exp!.id)).toMatchObject({ branch_id: s.branchId, status: "open", expected_amount: "480.00" });
    const line = before.json.unmatchedLines.find((l: any) => l.description === "KBank card settlement");
    expect(line).toMatchObject({ amount: "480.00" });
    expect(before.json.matchedLines.map((l: any) => l.id)).not.toContain(line.id);

    const matched = await s.call("POST", `/v1/statement-lines/${line.id}/match`, { expectedIds: [exp!.id] });
    expect(matched.status).toBe(200);
    const after = await s.call("GET", "/v1/reconciliation");
    expect(after.json.unmatchedLines.map((l: any) => l.id)).not.toContain(line.id);
    expect(after.json.matchedLines.map((l: any) => l.id)).toContain(line.id);
    expect(after.json.expected.map((e: any) => e.id)).not.toContain(exp!.id);
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
