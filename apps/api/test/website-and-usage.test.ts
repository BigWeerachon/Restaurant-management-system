import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext } from "./helpers";

type Ctx = Awaited<ReturnType<typeof createTestContext>>;
let ctx: Ctx;
let call: ReturnType<Ctx["client"]>;
let anon: ReturnType<Ctx["client"]>;
let tenantId: string;
let branch: string;
let latte: string;

beforeAll(async () => {
  ctx = await createTestContext();
  const owner = await ctx.newUser();
  const shop = await ctx.client(owner.token)("POST", "/v1/tenants", { name: "คาเฟ่มีเว็บ", businessType: "cafe", ownerName: "คุณเว็บ" });
  tenantId = shop.json.tenant_id;
  branch = shop.json.branch_id;
  call = ctx.client(owner.token, tenantId);
  anon = ctx.client();
  latte = (await call("POST", "/v1/menu-items", { categoryName: "กาแฟ", name: "ลาเต้เย็น", price: "65.00" })).json.id;
});
afterAll(async () => {
  await ctx.close();
});

describe("the shop's website", () => {
  let key: string;

  it("gets a key per branch, shown once", async () => {
    const r = await call("POST", `/v1/branches/${branch}/website-key`);
    expect(r.status).toBe(201);
    key = r.json.key;
    expect(key).toMatch(/^sbw_[0-9a-f]{48}$/);
  });

  it("reads the menu from the POS with the key, and nothing without it", async () => {
    expect((await anon("GET", "/v1/public/menu")).status).toBe(404);
    expect((await anon("GET", "/v1/public/menu", undefined, { "x-website-key": `sbw_${"0".repeat(48)}` })).status).toBe(404);
    const m = await anon("GET", "/v1/public/menu", undefined, { "x-website-key": key, origin: "https://cafe.example" });
    expect(m.status).toBe(200);
    expect(m.headers.get("access-control-allow-origin")).toBe("https://cafe.example");
    expect(m.json.ordering).toBe(true);
    expect(m.json.categories[0].items[0]).toMatchObject({ id: latte, name: "ลาเต้เย็น", price: "65.00", available: true });
  });

  it("sends an order to the kitchen on the website channel, no GP; a repeat is the same order", async () => {
    const body = { customerName: "ก้อย", phone: "081-234-5678", pickupAt: "12:30", externalRef: "web-order-0001", items: [{ menuItemId: latte, qty: 2 }] };
    const r = await anon("POST", "/v1/public/orders", body, { "x-website-key": key });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ total: "130.00", status: "open", repeat: false });
    const again = await anon("POST", "/v1/public/orders", body, { "x-website-key": key });
    expect(again.json).toMatchObject({ orderId: r.json.orderId, repeat: true });
    const [o] = await ctx.sql<{ key: string; commission_rate: string }[]>`
      select c.key, o.commission_rate::text from app.orders o join app.sales_channels c on c.id = o.channel_id where o.id = ${r.json.orderId}`;
    expect(o).toMatchObject({ key: "website", commission_rate: "0.0000" });
    expect((await anon("POST", "/v1/public/orders", { ...body, items: [] }, { "x-website-key": key })).status).toBe(422);
  });

  it("stops at once when the key is switched off", async () => {
    expect((await call("DELETE", `/v1/branches/${branch}/website-key`)).status).toBe(200);
    expect((await anon("GET", "/v1/public/menu", undefined, { "x-website-key": key })).status).toBe(404);
  });
});

describe("pay per order", () => {
  it("shows the meter for this month on the billing page", async () => {
    await call("POST", "/v1/settings/plan", { planCode: "per_order" });
    const b = await call("GET", "/v1/billing");
    expect(b.status).toBe(200);
    expect(b.json.planCode).toBe("per_order");
    expect(b.json.usage).toMatchObject({ orders: 0, fee: "0.00", total: "0.00" });
    expect(b.json.usage.branches[0]).toMatchObject({ branchId: branch, orders: 0, capped: false });
  });
});
