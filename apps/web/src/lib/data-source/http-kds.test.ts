import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSabai } from "../demo/store";
import { orderApi, ticketApi } from "./fixtures";
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

describe("HttpDataSource kitchen commands", () => {
  let branchId: string;
  beforeEach(() => {
    clearApiSession();
    setApiSession({ token: "staff-token", tenantId: "t-1" });
    useSabai.getState().reset("demo");
    useSabai.getState().signIn("m-owner");
    branchId = useSabai.getState().session.branchId!;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads this branch's tickets, replacing only its own", async () => {
    const other = useSabai.getState().db.branches.find((b) => b.id !== branchId)!.id;
    useSabai.getState().patch((d) => {
      d.tickets = [{ ...mapped("keep-me"), branchId: other }, { ...mapped("drop-me"), branchId }];
    });
    fakeApi({ "GET /v1/kds/tickets": { body: { tickets: [ticketApi({ id: "kt-9" })], stations: [], serverTime: "x" } } });
    await ds.load(["tickets"]);
    expect(useSabai.getState().db.tickets.map((t) => [t.id, t.branchId])).toEqual([
      ["keep-me", other],
      ["kt-9", branchId],
    ]);
  });

  it("starts, finishes and recalls a ticket, reloading tickets and the order lines it moves", async () => {
    const calls = fakeApi({ "POST /v1/kds/tickets/kt-1/status": { body: { id: "kt-1", status: "ready" } }, "GET /v1/kds/tickets": { body: { tickets: [] } }, "GET /v1/orders": { body: [] } });
    await ds.setTicketStatus("kt-1", "ready");
    await ds.setTicketStatus("kt-1", "in_progress");
    expect(calls.filter((c) => c.key.startsWith("POST")).map((c) => c.body)).toEqual([{ status: "ready" }, { status: "in_progress" }]);
    expect(calls.map((c) => c.key)).toEqual(expect.arrayContaining(["GET /v1/kds/tickets", "GET /v1/orders"]));
  });

  it("has no way to cancel a ticket from the kitchen screen", async () => {
    await expect(ds.setTicketStatus("kt-1", "cancelled")).rejects.toMatchObject({ code: "INTERNAL", params: { feature: "setTicketStatus(cancelled)" } });
  });

  it("toggles one ticket line by the line's own id, found from the order line the screen knows", async () => {
    useSabai.getState().patch((d) => {
      d.tickets = [mapped("kt-1")];
    });
    const calls = fakeApi({ "POST /v1/kds/ticket-items/kti-2/toggle": { body: { id: "kti-2" } }, "GET /v1/kds/tickets": { body: { tickets: [] } } });
    await ds.toggleTicketItem("kt-1", "oi-2");
    expect(calls[0]!.key).toBe("POST /v1/kds/ticket-items/kti-2/toggle");
    await expect(ds.toggleTicketItem("kt-1", "no-such-line")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("loads what a screen asks for without failing over the part this person may not read", async () => {
    fakeApi({
      "GET /v1/kds/tickets": { status: 403, body: { error: { code: "PERMISSION_DENIED" } } },
      "GET /v1/orders": { body: [orderApi({ id: "o-88", branchId })] },
    });
    await expect(ds.load(["orders", "tickets"])).resolves.toBeUndefined();
    expect(useSabai.getState().db.orders.some((o) => o.id === "o-88")).toBe(true);
  });

  it("still fails a load for any other reason", async () => {
    fakeApi({ "GET /v1/kds/tickets": { status: 500, body: { error: { code: "INTERNAL" } } }, "GET /v1/orders": { body: [] } });
    await expect(ds.load(["orders", "tickets"])).rejects.toMatchObject({ code: "INTERNAL" });
  });

  it("still refreshes the other slices when one of them cannot be read by this person", async () => {
    const calls = fakeApi({
      "POST /v1/kds/tickets/kt-1/status": { body: {} },
      "GET /v1/kds/tickets": { status: 403, body: { error: { code: "PERMISSION_DENIED" } } },
      "GET /v1/orders": { body: [orderApi({ id: "o-77", branchId })] },
    });
    await ds.setTicketStatus("kt-1", "ready");
    expect(calls.map((c) => c.key)).toContain("GET /v1/orders");
    expect(useSabai.getState().db.orders.some((o) => o.id === "o-77")).toBe(true);
  });
});

function mapped(id: string) {
  return {
    id,
    branchId: "",
    orderId: "o-1",
    stationId: "st",
    ticketNo: "B-1",
    status: "new" as const,
    firedAt: "2026-09-29T03:00:00.000Z",
    items: ticketApi().items.map((i) => ({ id: i.id, orderItemId: i.order_item_id, name: i.name, qty: 1, modifiers: "", status: i.status })),
    channelName: "ทานที่ร้าน",
    channelKind: "dine_in" as const,
  };
}
