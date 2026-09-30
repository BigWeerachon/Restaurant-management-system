import { describe, expect, it } from "vitest";
import {
  addDays,
  allocateToRange,
  daysBetween,
  allDayCounts,
  businessDate,
  channelProfitability,
  crc16,
  formatElapsed,
  formatThaiDate,
  menuEngineering,
  parsePromptPayId,
  percentChange,
  profitWaterfall,
  promptPayPayload,
  reconciliationStatus,
  shopClock,
  sortTickets,
  suggestMatches,
  trend,
  urgency,
} from "../src";

describe("profit waterfall — เหลือเงินจริงเท่าไร", () => {
  it("walks from net sales to what the owner keeps (SQL test numbers)", () => {
    const w = profitWaterfall({ netSales: 13551, cogs: 4920, waste: 1000, stockVariance: 700, commission: 0, paymentFees: 0, expenses: 0 });
    const last = w.at(-1)!;
    expect(last.key).toBe("profit");
    expect(last.value).toBe(6931);
    expect(w[0]!.running).toBe(13551);
    expect(w.find((s) => s.key === "cogs")!.pctOfSales).toBeCloseTo(4920 / 13551);
  });
});

describe("channel profitability", () => {
  it("shows that a busy delivery channel may keep less than dine-in", () => {
    const rows = channelProfitability([
      { channelId: "dine", name: "ทานที่ร้าน", orders: 50, netSales: 500000, cost: 150000, commission: 0, paymentFees: 2000 },
      { channelId: "grab", name: "GrabFood", orders: 80, netSales: 700000, cost: 210000, commission: 210000, paymentFees: 0 },
    ]);
    expect(rows[0]!.channelId).toBe("dine");
    expect(rows[0]!.contribution).toBe(348000);
    expect(rows[1]!.marginPct).toBeCloseTo(0.4);
    expect(rows[1]!.shareOfSales).toBeCloseTo(700000 / 1200000);
    expect(rows[1]!.avgTicket).toBe(8750);
  });
});

describe("menu engineering", () => {
  it("classifies stars, plowhorses, puzzles and dogs", () => {
    const r = menuEngineering([
      { menuItemId: "latte", name: "ลาเต้", qty: 100, sales: 650000, cost: 165000 },
      { menuItemId: "americano", name: "อเมริกาโน่", qty: 90, sales: 450000, cost: 250000 },
      { menuItemId: "cake", name: "เค้ก", qty: 10, sales: 150000, cost: 30000 },
      { menuItemId: "toast", name: "โทสต์", qty: 5, sales: 25000, cost: 20000 },
      { menuItemId: "none", name: "ไม่มีขาย", qty: 0, sales: 0, cost: 0 },
    ]);
    const cls = Object.fromEntries(r.map((i) => [i.menuItemId, i.class]));
    expect(cls).toEqual({ latte: "star", americano: "plowhorse", cake: "puzzle", toast: "dog" });
  });
});

describe("KPI helpers", () => {
  it("compares periods safely", () => {
    expect(percentChange(110, 100)).toBeCloseTo(0.1);
    expect(percentChange(5, 0)).toBeNull();
    expect(trend(101, 100)).toBe("flat");
    expect(trend(120, 100)).toBe("up");
    expect(trend(80, 100)).toBe("down");
  });
});

describe("reconciliation suggestions", () => {
  const expected = [
    { id: "card-27", label: "บัตร 27/09", expectedDate: "2026-09-29", amount: 98000, sourceType: "card_batch" as const },
    { id: "grab-21", label: "Grab 21/09", expectedDate: "2026-09-28", amount: 120000, sourceType: "platform_payout" as const },
    { id: "grab-22", label: "Grab 22/09", expectedDate: "2026-09-29", amount: 80000, sourceType: "platform_payout" as const },
    { id: "lm-27", label: "LINE MAN 27/09", expectedDate: "2026-10-04", amount: 50000, sourceType: "platform_payout" as const },
  ];

  it("finds exact, combined and near matches with plain-language hints", () => {
    const s = suggestMatches(
      [
        { id: "b1", date: "2026-09-29", amount: 98000 },
        { id: "b2", date: "2026-09-29", amount: 200000 },
        { id: "b3", date: "2026-10-04", amount: 48500 },
      ],
      expected,
    );
    const byLine = Object.fromEntries(s.map((m) => [m.lineId, m]));
    expect(byLine.b1!.reason).toBe("exact");
    expect(byLine.b2!.expectedIds).toEqual(["grab-21", "grab-22"]);
    expect(byLine.b3!.reason).toBe("near");
    expect(byLine.b3!.variance).toBe(-1500);
    expect(byLine.b3!.varianceAccount).toBe("commission_expense");
  });

  it("only combines receipts from the same payer (Grab never pays LINE MAN's money)", () => {
    const interleaved = [
      { id: "g1", label: "Grab 21", expectedDate: "2026-09-28", amount: 300000, sourceType: "platform_payout" as const, payer: "grab" },
      { id: "l1", label: "LINE MAN 21", expectedDate: "2026-09-28", amount: 120000, sourceType: "platform_payout" as const, payer: "lineman" },
      { id: "g2", label: "Grab 22", expectedDate: "2026-09-29", amount: 250000, sourceType: "platform_payout" as const, payer: "grab" },
      { id: "l2", label: "LINE MAN 22", expectedDate: "2026-09-29", amount: 90000, sourceType: "platform_payout" as const, payer: "lineman" },
    ];
    const [m] = suggestMatches([{ id: "b", date: "2026-09-29", amount: 550000 }], interleaved);
    expect(m?.reason).toBe("combined");
    expect(m?.expectedIds).toEqual(["g1", "g2"]);
    // 300000 + 120000 would also sum to a plausible amount, but crosses payers.
    expect(suggestMatches([{ id: "x", date: "2026-09-29", amount: 420000 }], interleaved).find((s) => s.reason === "combined")).toBeUndefined();
  });

  it("lists money that has not arrived yet", () => {
    const st = reconciliationStatus(expected, new Set(["card-27"]), "2026-10-02");
    expect(st.missing).toHaveLength(3);
    expect(st.overdue.map((e) => e.id)).toEqual(["grab-21", "grab-22"]);
  });
});

describe("kitchen timing", () => {
  it("escalates ok → warn → late", () => {
    expect(urgency(60)).toBe("ok");
    expect(urgency(301)).toBe("warn");
    expect(urgency(700)).toBe("late");
    expect(urgency(200, { warnAfterSec: 120, lateAfterSec: 240 })).toBe("warn");
    expect(formatElapsed(83)).toBe("1:23");
    expect(formatElapsed(3725)).toBe("1:02:05");
  });

  it("orders tickets oldest first, priority on top, and counts all-day items", () => {
    const t = sortTickets([
      { id: "b", firedAt: "2026-09-27T10:05:00Z" },
      { id: "a", firedAt: "2026-09-27T10:00:00Z" },
      { id: "vip", firedAt: "2026-09-27T10:10:00Z", priority: 1 },
    ]);
    expect(t.map((x) => x.id)).toEqual(["vip", "a", "b"]);
    expect(allDayCounts([{ name: "ลาเต้", qty: 2 }, { name: "ลาเต้", qty: 1 }, { name: "ชา", qty: 1, done: true }])).toEqual([{ name: "ลาเต้", qty: 3 }]);
  });
});

describe("PromptPay QR", () => {
  it("uses the EMVCo CRC-16/CCITT-FALSE check value", () => {
    expect(crc16("123456789")).toBe("29B1");
  });

  it("parses what owners type", () => {
    expect(parsePromptPayId("081-234-5678")).toEqual({ kind: "phone", value: "0812345678" });
    expect(parsePromptPayId("+66 81 234 5678")).toEqual({ kind: "phone", value: "0812345678" });
    expect(parsePromptPayId("0105561234567")).toEqual({ kind: "tax_id", value: "0105561234567" });
    expect(parsePromptPayId("12")).toBeNull();
  });

  it("builds a dynamic QR for the exact bill amount with a valid checksum", () => {
    const payload = promptPayPayload({ kind: "phone", value: "0812345678" }, 145);
    expect(payload.startsWith("000201010212")).toBe(true);
    expect(payload).toContain("0016A000000677010111");
    expect(payload).toContain("01130066812345678");
    expect(payload).toContain("5406145.00");
    expect(payload.slice(-4)).toBe(crc16(payload.slice(0, -4)));
    expect(promptPayPayload({ kind: "phone", value: "0812345678" }).startsWith("000201010211")).toBe(true);
  });
});

describe("business date", () => {
  it("counts after-midnight sales for the previous day", () => {
    // 01:30 Bangkok on 28 Sep → business day 27 Sep
    expect(businessDate(new Date("2026-09-27T18:30:00Z"))).toBe("2026-09-27");
    // 06:00 Bangkok on 28 Sep → 28 Sep
    expect(businessDate(new Date("2026-09-27T23:00:00Z"))).toBe("2026-09-28");
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
  });

  it("keeps its date formatters per time zone and per cut-off, so asking again gives the right answer for each", () => {
    const at = new Date("2026-09-27T18:30:00Z");
    // Asked in turn, in the same process: the formatter made for one zone must never answer for another.
    const asks = () => [
      businessDate(at),
      businessDate(at, { timeZone: "Asia/Tokyo", cutoff: "00:00" }),
      businessDate(at, { timeZone: "America/New_York", cutoff: "00:00" }),
      businessDate(at, { timeZone: "Asia/Bangkok", cutoff: "00:00" }),
    ];
    // 01:30 Bangkok (before the 05:00 cut-off) is still the 27th; 03:30 Tokyo is the 28th; 14:30 in New York is the 27th.
    expect(asks()).toEqual(["2026-09-27", "2026-09-28", "2026-09-27", "2026-09-28"]);
    expect(asks()).toEqual(["2026-09-27", "2026-09-28", "2026-09-27", "2026-09-28"]);
    expect(shopClock(at)).toEqual({ hour: 1, minute: 30 });
    expect(shopClock(at, "Asia/Tokyo")).toEqual({ hour: 3, minute: 30 });
    expect(shopClock(at)).toEqual({ hour: 1, minute: 30 });
    expect(formatThaiDate("2026-09-27", false)).not.toBe(formatThaiDate("2026-09-27", true));
    expect(formatThaiDate("2026-09-27")).toBe(formatThaiDate("2026-09-27"));
  });
});

describe("allocateToRange (accrual view of monthly bills)", () => {
  const sept = { start: "2026-09-01", end: "2026-09-30" };
  it("spreads a monthly bill evenly per day", () => {
    expect(allocateToRange(3_000_000, sept, { from: "2026-09-21", to: "2026-09-27" })).toBe(700_000);
  });
  it("keeps the whole amount when the range covers the period", () => {
    expect(allocateToRange(4_500_000, sept, { from: "2026-08-15", to: "2026-10-15" })).toBe(4_500_000);
  });
  it("is zero outside the period", () => {
    expect(allocateToRange(4_500_000, sept, { from: "2026-10-01", to: "2026-10-07" })).toBe(0);
  });
  it("treats a one-day expense as belonging to that day", () => {
    const day = { start: "2026-09-10", end: "2026-09-10" };
    expect(allocateToRange(12_345, day, { from: "2026-09-10", to: "2026-09-10" })).toBe(12_345);
    expect(allocateToRange(12_345, day, { from: "2026-09-11", to: "2026-09-30" })).toBe(0);
  });
  it("counts days across month ends correctly", () => {
    expect(daysBetween("2026-02-27", "2026-03-02")).toBe(3);
  });
});
