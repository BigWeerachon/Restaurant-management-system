import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSabai } from "../demo/store";
import { clearApiSession, setApiSession } from "./http-client";
import { httpDataSource as ds } from "./http-data-source";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function fakeApi(routes: Record<string, { status?: number; body: unknown }>) {
  const calls: { key: string; url: string; body: any }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL, init: any) => {
      const u = new URL(String(url));
      const key = `${init?.method ?? "GET"} ${u.pathname}`;
      calls.push({ key, url: u.pathname + u.search, body: init?.body ? JSON.parse(init.body) : undefined });
      const r = routes[key];
      return r ? json(r.status ?? 200, r.body) : json(404, { error: { code: "NOT_FOUND" } });
    }),
  );
  return calls;
}

describe("HttpDataSource stock", () => {
  let branchId: string;
  let ingredientId: string;
  beforeEach(() => {
    clearApiSession();
    setApiSession({ token: "staff-token", tenantId: "t-1" });
    useSabai.getState().reset("demo");
    useSabai.getState().signIn("m-owner");
    branchId = useSabai.getState().session.branchId!;
    useSabai.getState().patch((d) => {
      d.branches.find((b) => b.id === branchId)!.stockLocationId = "loc-1";
      const ing = d.ingredients.find((i) => i.trackStock)!;
      ing.lastCost = 0.03;
      ingredientId = ing.id;
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads quantities and movements of this branch, replacing only its own and putting the latest movement last", async () => {
    const other = useSabai.getState().db.branches.find((b) => b.id !== branchId)!.id;
    useSabai.getState().patch((d) => {
      d.balances[`${other}:${ingredientId}`] = { qty: 7, avgCost: 1 };
      d.balances[`${branchId}:stale`] = { qty: 1, avgCost: 1 };
      d.movements = [{ id: "keep", branchId: other, ingredientId, qty: 1, unitCost: 0, reason: "purchase", at: "x", businessDate: "2026-09-29" }];
    });
    const calls = fakeApi({
      "GET /v1/stock": { body: [{ ingredient_id: ingredientId, qty_on_hand: 1500, unit_cost: 0.04 }] },
      "GET /v1/stock-movements": {
        body: [
          { id: "mv-new", ingredient_id: ingredientId, qty: -100, unit_cost: 0.04, reason: "sale", reason_code: null, business_date: "2026-09-29", occurred_at: "2026-09-29T05:00:00.000Z", note: null },
          { id: "mv-old", ingredient_id: ingredientId, qty: 2000, unit_cost: 0.04, reason: "purchase", reason_code: null, business_date: "2026-09-29", occurred_at: "2026-09-29T01:00:00.000Z", note: null },
        ],
      },
    });
    await ds.load(["stock"]);
    const { balances, movements } = useSabai.getState().db;
    expect(balances[`${branchId}:${ingredientId}`]).toEqual({ qty: 1500, avgCost: 0.04 });
    expect(balances[`${branchId}:stale`]).toBeUndefined();
    expect(balances[`${other}:${ingredientId}`]).toEqual({ qty: 7, avgCost: 1 });
    expect(movements.map((m) => m.id)).toEqual(["keep", "mv-old", "mv-new"]);
    expect(calls.find((c) => c.key === "GET /v1/stock-movements")!.url).toContain(`branchId=${branchId}`);
  });

  it("loads the count in progress with its lines", async () => {
    fakeApi({
      "GET /v1/stock-counts": { body: [{ id: "c-2", status: "approved", started_at: "a", submitted_at: null, approved_at: "b" }, { id: "c-1", status: "in_progress", started_at: "a", submitted_at: null, approved_at: null }] },
      "GET /v1/stock-counts/c-1": { body: { id: "c-1", countNo: "CNT-1", status: "in_progress", blind: true, lines: [{ ingredientId, counted: null }] } },
    });
    await ds.load(["counts"]);
    expect(useSabai.getState().db.counts.map((c) => [c.id, c.status, c.lines.length])).toEqual([["c-1", "in_progress", 1]]);
  });

  it("receives goods with prices in baht, then reloads stock and the shop; warns about a price more than 5% up", async () => {
    const calls = fakeApi({
      "POST /v1/receipts": { body: { id: "gr-1", grNo: "GR-0001", total: "310.00" } },
      "GET /v1/stock": { body: [] },
      "GET /v1/stock-movements": { body: [] },
      "GET /v1/shop": { status: 500, body: { error: { code: "INTERNAL" } } },
    });
    const r = await ds.receiveGoods({
      paymentMode: "cash_paid",
      lines: [{ ingredientId, packName: "ถุง 1 กก.", packQty: 1000, qtyPacks: 2, unitPrice: 15500 }, { ingredientId, packName: "ถุง 1 กก.", packQty: 1000, qtyPacks: 0, unitPrice: 15500 }],
    });
    const post = calls.find((c) => c.key === "POST /v1/receipts")!;
    expect(post.body).toMatchObject({ branchId, paymentMode: "cash_paid", lines: [{ ingredientId, packName: "ถุง 1 กก.", packQty: 1000, qtyPacks: 2, unitPrice: "155.00" }] });
    expect(post.body.lines).toHaveLength(1);
    // A failed reload of the shop must not make the receipt look as if it had not been saved.
    expect(r).toMatchObject({ id: "gr-1", grNo: "GR-0001", total: 31000 });
    expect(r.priceAlerts[0]).toMatchObject({ ingredientId, oldCost: 0.03 });
    expect(r.priceAlerts[0]!.pct).toBeGreaterThan(5);
    expect(calls.map((c) => c.key)).toEqual(expect.arrayContaining(["GET /v1/stock", "GET /v1/shop"]));
  });

  it("records waste in the branch's stock location and gives back the value the database booked", async () => {
    const calls = fakeApi({
      "POST /v1/waste": { body: { id: "mv-9" } },
      "GET /v1/stock": { body: [] },
      "GET /v1/stock-movements": { body: [{ id: "mv-9", ingredient_id: ingredientId, qty: -200, unit_cost: 0.05, reason: "waste", reason_code: "spoiled", business_date: "2026-09-29", occurred_at: "2026-09-29T05:00:00.000Z", note: null }] },
    });
    const cost = await ds.recordWaste(ingredientId, 200, "spoiled", "หมดอายุ");
    expect(calls[0]!.body).toEqual({ locationId: "loc-1", ingredientId, qty: 200, reason: "spoiled", note: "หมดอายุ" });
    expect(cost).toBeCloseTo(10);
  });

  it("falls back to the cost it knows when the reload does not bring the movement back", async () => {
    fakeApi({ "POST /v1/waste": { body: { id: "mv-9" } }, "GET /v1/stock": { status: 500, body: {} }, "GET /v1/stock-movements": { status: 500, body: {} } });
    // With an average cost on hand that is what counts; without one, the last price paid.
    useSabai.getState().patch((d) => {
      d.balances[`${branchId}:${ingredientId}`] = { qty: 1000, avgCost: 0.05 };
    });
    expect(await ds.recordWaste(ingredientId, 100, "spoiled")).toBeCloseTo(5);
    useSabai.getState().patch((d) => {
      delete d.balances[`${branchId}:${ingredientId}`];
    });
    expect(await ds.recordWaste(ingredientId, 100, "spoiled")).toBeCloseTo(3);
  });

  it("needs a stock location to record waste or start a count", async () => {
    useSabai.getState().patch((d) => {
      d.branches.find((b) => b.id === branchId)!.stockLocationId = undefined;
    });
    fakeApi({});
    await expect(ds.recordWaste(ingredientId, 1, "spoiled")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(ds.startCount()).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("runs a count: start, record a line (null for skipped), submit, approve with the value of the difference", async () => {
    const calls = fakeApi({
      "POST /v1/stock-counts": { body: { id: "c-1" } },
      "PUT /v1/stock-counts/c-1/lines": { body: {} },
      "POST /v1/stock-counts/c-1/submit": { body: {} },
      "POST /v1/stock-counts/c-1/approve": { body: { adjustedLines: 1 } },
      "GET /v1/stock-counts": { body: [] },
      "GET /v1/stock": { body: [] },
      "GET /v1/stock-movements": { body: [] },
    });
    expect(await ds.startCount()).toBe("c-1");
    await ds.recordCount("c-1", ingredientId, 850);
    await ds.recordCount("c-1", ingredientId, null);
    await ds.submitCount("c-1");
    useSabai.getState().patch((d) => {
      d.counts = [{ id: "c-1", branchId, countNo: "CNT-1", status: "submitted", blind: true, startedAt: "a", lines: [{ ingredientId, counted: 800, expected: 1000, unitCost: 0.05 }] }];
    });
    expect(await ds.approveCount("c-1")).toEqual({ adjusted: 1, value: -10 });
    expect(calls.filter((c) => c.key !== "GET /v1/stock-counts" && c.key.startsWith("POST /v1/stock-counts") && !c.key.endsWith("/c-1/submit") && !c.key.endsWith("/approve"))[0]!.body).toEqual({ locationId: "loc-1", scope: "full", blind: true });
    expect(calls.filter((c) => c.key === "PUT /v1/stock-counts/c-1/lines").map((c) => c.body)).toEqual([{ ingredientId, counted: 850 }, { ingredientId, counted: null }]);
  });

  it("adds an ingredient with its category, usual pack and opening stock, and gives back the one the shop now holds", async () => {
    const fresh = { ...useSabai.getState().db.ingredients[0]!, id: "ing-new", name: "อกไก่" };
    const calls = fakeApi({
      "POST /v1/ingredients": { body: { id: "ing-new" } },
      "GET /v1/shop": { status: 500, body: { error: { code: "INTERNAL" } } },
      "GET /v1/stock": { body: [] },
      "GET /v1/stock-movements": { body: [] },
    });
    // The reloaded shop is what brings the new ingredient in; here the reload fails, so the command must say so.
    await expect(ds.addIngredient({ name: " อกไก่ ", emoji: "🍗", baseUnit: "g", category: "เนื้อสัตว์", pack: { name: "ถุง 1 กก.", qty: 1000, price: 12500 }, openingQty: 2000, reorderPoint: 1000, parLevel: 3000 })).rejects.toMatchObject({ code: "INTERNAL" });
    expect(calls[0]!.body).toMatchObject({ name: "อกไก่", baseUnit: "g", categoryName: "เนื้อสัตว์", pack: { name: "ถุง 1 กก.", qty: 1000, price: "125.00" }, openingQty: 2000, branchId, reorderPoint: 1000, parLevel: 3000 });
    void fresh;
  });

  it("does not send a branch when there is no opening stock", async () => {
    const calls = fakeApi({ "POST /v1/ingredients": { body: { id: "ing-new" } }, "GET /v1/shop": { status: 500, body: {} }, "GET /v1/stock": { body: [] }, "GET /v1/stock-movements": { body: [] } });
    await ds.addIngredient({ name: "เกลือ", emoji: "🧂", baseUnit: "g", category: "" }).catch(() => undefined);
    expect(calls[0]!.body.branchId).toBeUndefined();
    expect(calls[0]!.body.categoryName).toBeUndefined();
  });
});
