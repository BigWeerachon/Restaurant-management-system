import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSabai } from "../demo/store";
import { clearApiSession, setApiSession } from "./http-client";
import { httpDataSource as ds } from "./http-data-source";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("HttpDataSource reports", () => {
  beforeEach(() => {
    clearApiSession();
    setApiSession({ token: "staff-token", tenantId: "t-1" });
    useSabai.getState().reset("demo");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks for a period, for one branch or all of them, and returns it in the screen's terms", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL) => {
        urls.push(String(url));
        return json(200, { totals: { orders: 1, netSales: "45.00", avgTicket: "45.00" }, days: [{ date: "2026-09-29", orders: 1, netSales: "45.00" }], hours: new Array(24).fill(0), branches: [], channels: [], items: [] });
      }),
    );
    const one = await ds.reportSummary({ from: "2026-09-29", to: "2026-09-29", branchId: "br-1" });
    const all = await ds.reportSummary({ from: "2026-09-27", to: "2026-09-29" });
    expect(urls[0]).toContain("/v1/reports/summary?from=2026-09-29&to=2026-09-29&branchId=br-1");
    expect(urls[1]).not.toContain("branchId");
    expect(one.totals.netSales).toBe(4500);
    expect(all.days.map((d) => d.date)).toEqual(["2026-09-27", "2026-09-28", "2026-09-29"]);
  });

  it("asks for today's numbers of one branch", async () => {
    let asked = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL) => {
        asked = String(url);
        return json(200, { today: "2026-09-29", sales: "45.00", orders: 1, avgTicket: "45.00", keep: "30.00", keepPct: 0.7, lastWeekSales: "0.00", lastWeekOrders: 0, spark: ["0.00", "45.00"], open: 0 });
      }),
    );
    const t = await ds.today("br-1");
    expect(asked).toContain("/v1/reports/today?branchId=br-1");
    expect(t).toMatchObject({ sales: 4500, keep: 3000, spark: [0, 4500] });
  });

  it("does not make up a total for all branches at once", async () => {
    await expect(ds.today(null)).rejects.toMatchObject({ code: "INTERNAL", params: { feature: "today(all branches)" } });
  });

  it("passes a refusal on instead of showing an empty report", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(403, { error: { code: "PERMISSION_DENIED" } })));
    await expect(ds.reportSummary({ from: "2026-09-29", to: "2026-09-29" })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });
});
