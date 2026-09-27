import { describe, expect, it } from "vitest";
import {
  allocate,
  applyRate,
  calculateOrderTotals,
  cashRound,
  changeDue,
  divRound,
  formatMoney,
  roundHalfAwayFromZero,
  satangToDecimalString,
  suggestTenders,
  toSatang,
} from "../src";

describe("money", () => {
  it("parses decimal strings exactly", () => {
    expect(toSatang("145.00")).toBe(14500);
    expect(toSatang("1,234.5")).toBe(123450);
    expect(toSatang("0.005")).toBe(1); // half away from zero
    expect(toSatang("-9.49")).toBe(-949);
    expect(toSatang(".5")).toBe(50);
    expect(toSatang(1.005)).toBe(101);
  });

  it("rejects garbage instead of silently producing NaN", () => {
    expect(() => toSatang("abc")).toThrow();
    expect(() => toSatang("")).toThrow();
    expect(() => toSatang(Number.NaN)).toThrow();
  });

  it("rounds like Postgres round(numeric)", () => {
    expect(roundHalfAwayFromZero(2.5)).toBe(3);
    expect(roundHalfAwayFromZero(-2.5)).toBe(-3);
    expect(divRound(5, 2)).toBe(3);
    expect(divRound(-5, 2)).toBe(-3);
    expect(divRound(14500 * 700, 10700)).toBe(949);
  });

  it("formats Thai baht for people", () => {
    expect(formatMoney(123450)).toBe("฿1,234.50");
    expect(formatMoney(6500, { compact: true })).toBe("฿65");
    expect(formatMoney(-949)).toBe("-฿9.49");
    expect(satangToDecimalString(14500)).toBe("145.00");
    expect(satangToDecimalString(-5)).toBe("-0.05");
  });

  it("allocates without losing a satang", () => {
    const parts = allocate(1000, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1000);
    expect(parts).toEqual([334, 333, 333]);
    expect(allocate(500, [0, 0])).toEqual([500, 0]);
  });

  it("applies rates with integer maths", () => {
    expect(applyRate(14500, 0.1)).toBe(1450);
    expect(applyRate(999, 0.07)).toBe(70);
  });
});

describe("order pricing (parity with app.recalc_order)", () => {
  const latte = { qty: 1, unitPrice: 6500, modifiersTotal: 0 };
  const oatLatte = { qty: 1, unitPrice: 6500, modifiersTotal: 1500 };

  it("VAT-inclusive café bill — same numbers as the SQL end-to-end test", () => {
    const t = calculateOrderTotals({
      lines: [latte, oatLatte],
      serviceChargeRate: 0,
      vatRate: 0.07,
      pricesIncludeVat: true,
    });
    expect(t.itemsTotal).toBe(14500);
    expect(t.vatAmount).toBe(949);
    expect(t.total).toBe(14500);
    expect(t.netSales).toBe(13551);
  });

  it("VAT-exclusive with 10% service charge (\"++\" pricing)", () => {
    const t = calculateOrderTotals({
      lines: [{ qty: 2, unitPrice: 25000, modifiersTotal: 0 }],
      serviceChargeRate: 0.1,
      vatRate: 0.07,
      pricesIncludeVat: false,
    });
    // 500 + SC 50 = 550, VAT 38.50 → 588.50
    expect(t.serviceCharge).toBe(5000);
    expect(t.vatAmount).toBe(3850);
    expect(t.total).toBe(58850);
  });

  it("discounts: percent of items, amount capped at items total", () => {
    const pct = calculateOrderTotals({
      lines: [{ qty: 2, unitPrice: 6500, modifiersTotal: 0 }],
      discount: { type: "percent", value: 20 },
      serviceChargeRate: 0,
      vatRate: 0,
      pricesIncludeVat: true,
    });
    expect(pct.discountTotal).toBe(2600);
    expect(pct.total).toBe(10400);

    const amt = calculateOrderTotals({
      lines: [latte],
      discount: { type: "amount", value: 99999 },
      serviceChargeRate: 0,
      vatRate: 0,
      pricesIncludeVat: true,
    });
    expect(amt.discountTotal).toBe(6500);
    expect(amt.total).toBe(0);
  });

  it("ignores voided lines and handles fractional quantities", () => {
    const t = calculateOrderTotals({
      lines: [
        { qty: 0.5, unitPrice: 38000, modifiersTotal: 0 },
        { ...latte, voided: true },
      ],
      serviceChargeRate: 0,
      vatRate: 0,
      pricesIncludeVat: true,
    });
    expect(t.itemsTotal).toBe(19000);
  });

  it("computes delivery GP and the VAT charged on it", () => {
    const t = calculateOrderTotals({
      lines: [{ qty: 1, unitPrice: 20000, modifiersTotal: 0 }],
      serviceChargeRate: 0,
      vatRate: 0.07,
      pricesIncludeVat: true,
      commissionRate: 0.3,
    });
    expect(t.commission).toBe(6000);
    expect(t.commissionVat).toBe(420);
  });
});

describe("cash handling", () => {
  it("rounds cash bills when the shop wants it", () => {
    expect(cashRound(14512, "1.00")).toEqual({ total: 14500, rounding: -12 });
    expect(cashRound(14550, "1.00")).toEqual({ total: 14600, rounding: 50 });
    expect(cashRound(14512, "0.25")).toEqual({ total: 14500, rounding: -12 });
    expect(cashRound(14512, "none")).toEqual({ total: 14512, rounding: 0 });
  });

  it("suggests the banknotes customers actually hand over", () => {
    expect(suggestTenders(14500)).toEqual([14500, 15000, 20000, 50000]);
    expect(suggestTenders(10000)[0]).toBe(10000);
    expect(changeDue(14500, 20000)).toBe(5500);
    expect(changeDue(14500, 10000)).toBe(0);
  });
});
