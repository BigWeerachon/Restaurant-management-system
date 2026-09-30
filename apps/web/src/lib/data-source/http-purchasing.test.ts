import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSabai } from "../demo/store";
import { clearApiSession, setApiSession } from "./http-client";
import { httpDataSource as ds } from "./http-data-source";
import type { PurchaseOrderApi } from "./live-mappers";

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

describe("HttpDataSource purchasing", () => {
  let branchId: string;
  let ingredientId: string;
  let supplierId: string;
  const order = (over: Partial<PurchaseOrderApi> = {}): PurchaseOrderApi => ({
    id: "po-1",
    po_no: "PO2609-0001",
    status: "draft",
    expected_date: "2026-10-01",
    total: "300.00",
    created_at: "2026-09-29T03:00:00.000Z",
    branch_id: branchId,
    supplier_id: supplierId,
    lines: [{ id: "pol-1", ingredient_id: ingredientId, pack_name: "ถุง 1 กก.", pack_qty: 1000, qty_packs: 3, unit_price: "100.00", received_packs: 0 }],
    ...over,
  });

  beforeEach(() => {
    clearApiSession();
    setApiSession({ token: "staff-token", tenantId: "t-1" });
    useSabai.getState().reset("demo");
    useSabai.getState().signIn("m-owner");
    branchId = useSabai.getState().session.branchId!;
    const { db } = useSabai.getState();
    const ing = db.ingredients.find((i) => i.pack)!;
    ingredientId = ing.id;
    supplierId = ing.pack!.supplierId!;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads this branch's orders with their lines, replacing only its own", async () => {
    const other = useSabai.getState().db.branches.find((b) => b.id !== branchId)!.id;
    useSabai.getState().patch((d) => {
      const base = { poNo: "PO-x", supplierId, status: "sent" as const, createdAt: "x", total: 0, lines: [] };
      d.purchaseOrders = [{ ...base, id: "keep-me", branchId: other }, { ...base, id: "drop-me", branchId }];
    });
    const calls = fakeApi({ "GET /v1/purchase-orders": { body: [order({ id: "po-2" }), order({ id: "po-1", status: "submitted" })] } });
    await ds.load(["purchasing"]);
    expect(useSabai.getState().db.purchaseOrders.map((p) => [p.id, p.status])).toEqual([
      ["po-2", "draft"],
      ["po-1", "draft"],
      ["keep-me", "sent"],
    ]);
    expect(calls[0]!.url).toContain("detail=full");
    expect(calls[0]!.url).toContain(`branchId=${branchId}`);
  });

  it("orders at each ingredient's usual pack and, for someone who may approve, approves it in the same go", async () => {
    let created: any;
    const calls = fakeApi({
      "POST /v1/purchase-orders": { body: { id: "x", poNo: "PO2609-0001", status: "draft", total: "300.00" } },
      "POST /v1/purchase-orders/x/status": { body: {} },
      "GET /v1/purchase-orders": { body: [] },
    });
    // The server keeps the id the client chose, so the reloaded list has it.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL, init: any) => {
        const u = new URL(String(url));
        const key = `${init?.method ?? "GET"} ${u.pathname}`;
        calls.push({ key, url: u.pathname, body: init?.body ? JSON.parse(init.body) : undefined });
        if (key === "POST /v1/purchase-orders") {
          created = JSON.parse(init.body);
          return json(201, { id: created.id, poNo: "PO2609-0001", status: "draft", total: "300.00" });
        }
        if (key === "GET /v1/purchase-orders") return json(200, [order({ id: created.id, status: "approved" })]);
        return json(200, {});
      }),
    );
    const ing = useSabai.getState().db.ingredients.find((i) => i.id === ingredientId)!;
    const po = await ds.createPurchaseOrder(supplierId, [{ ingredientId, qtyPacks: 3 }, { ingredientId: "ignored", qtyPacks: 0 }]);
    expect(created.branchId).toBe(branchId);
    expect(created.supplierId).toBe(supplierId);
    expect(created.expectedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(created.lines).toEqual([{ ingredientId, packName: ing.pack!.name, packQty: ing.pack!.qty, qtyPacks: 3, unitPrice: (ing.pack!.price / 100).toFixed(2) }]);
    expect(po).toMatchObject({ id: created.id, status: "approved" });
    expect(calls.map((c) => c.key)).toContain(`POST /v1/purchase-orders/${created.id}/status`);
  });

  it("leaves the new order waiting for approval when the person may not approve", async () => {
    useSabai.getState().signIn("m-waiter");
    let id = "";
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL, init: any) => {
        const key = `${init?.method ?? "GET"} ${new URL(String(url)).pathname}`;
        calls.push(key);
        if (key === "POST /v1/purchase-orders") {
          id = JSON.parse(init.body).id;
          return json(201, { id });
        }
        if (key === "GET /v1/purchase-orders") return json(200, [order({ id })]);
        return json(200, {});
      }),
    );
    const po = await ds.createPurchaseOrder(supplierId, [{ ingredientId, qtyPacks: 1 }]);
    expect(po.status).toBe("draft");
    expect(calls.some((c) => c.endsWith("/status"))).toBe(false);
  });

  it("keeps the order when approving it fails, instead of reporting the whole thing as failed", async () => {
    let id = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL, init: any) => {
        const key = `${init?.method ?? "GET"} ${new URL(String(url)).pathname}`;
        if (key === "POST /v1/purchase-orders") {
          id = JSON.parse(init.body).id;
          return json(201, { id });
        }
        if (key.endsWith("/status")) return json(403, { error: { code: "PERMISSION_DENIED" } });
        return json(200, [order({ id })]);
      }),
    );
    await expect(ds.createPurchaseOrder(supplierId, [{ ingredientId, qtyPacks: 1 }])).resolves.toMatchObject({ status: "draft" });
  });

  it("makes an order from the suggestions the database works out for one supplier", async () => {
    const calls = fakeApi({
      "POST /v1/purchase-orders/from-suggestions": { body: { id: "po-7", poNo: "PO2609-0007", status: "draft", total: "300.00", lineCount: 2 } },
      "GET /v1/purchase-orders": { body: [order({ id: "po-7" })] },
    });
    const po = await ds.createPOFromSuggestions(branchId, supplierId, [ingredientId]);
    expect(calls[0]!.body).toEqual({ branchId, supplierId, ingredientIds: [ingredientId] });
    expect(po.id).toBe("po-7");
  });

  it("moves an order along and reloads the list", async () => {
    const calls = fakeApi({ "POST /v1/purchase-orders/po-1/status": { body: {} }, "GET /v1/purchase-orders": { body: [order({ status: "sent" })] } });
    await ds.setPurchaseOrderStatus("po-1", "sent");
    expect(calls[0]).toMatchObject({ key: "POST /v1/purchase-orders/po-1/status", body: { status: "sent" } });
    expect(useSabai.getState().db.purchaseOrders.find((p) => p.id === "po-1")!.status).toBe("sent");
  });

  it("names the order's line for each row when receiving against it, so the order can tell what has arrived", async () => {
    useSabai.getState().patch((d) => {
      d.purchaseOrders = [{ id: "po-1", poNo: "PO-1", branchId, supplierId, status: "sent", createdAt: "x", total: 30000, lines: [{ id: "pol-1", ingredientId, packName: "ถุง 1 กก.", packQty: 1000, qtyPacks: 3, unitPrice: 10000, receivedPacks: 0 }] }];
    });
    const calls = fakeApi({ "POST /v1/receipts": { body: { id: "gr-1", grNo: "GR-1", total: "300.00" } }, "GET /v1/stock": { body: [] }, "GET /v1/stock-movements": { body: [] }, "GET /v1/purchase-orders": { body: [] }, "GET /v1/shop": { status: 500, body: {} } });
    await ds.receiveGoods({ poId: "po-1", paymentMode: "credit", supplierId, lines: [{ ingredientId, packName: "ถุง 1 กก.", packQty: 1000, qtyPacks: 3, unitPrice: 10000 }] });
    expect(calls.find((c) => c.key === "POST /v1/receipts")!.body).toMatchObject({ poId: "po-1", lines: [{ ingredientId, poLineId: "pol-1" }] });
    // And the order list is reloaded, since receiving changes it.
    expect(calls.map((c) => c.key)).toContain("GET /v1/purchase-orders");
  });
});
