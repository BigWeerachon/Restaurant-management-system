import { applyRate, divRound, rateToBasisPoints, type Satang } from "./money";

/**
 * Order pricing. This mirrors `app.recalc_order()` in the database exactly;
 * the POS uses it for instant (optimistic) totals and the API integration
 * tests assert both produce identical numbers.
 */
export interface PricingLine {
  qty: number;
  unitPrice: Satang;
  modifiersTotal: Satang;
  voided?: boolean;
}

export type DiscountType = "percent" | "amount";

export interface PricingInput {
  lines: PricingLine[];
  /** percent: 0–100 (e.g. 12.5). amount: satang. */
  discount?: { type: DiscountType; value: number } | null;
  serviceChargeRate: number;
  /** 0 when the business is not VAT registered. */
  vatRate: number;
  pricesIncludeVat: boolean;
  commissionRate?: number;
  commissionVat?: boolean;
  rounding?: Satang;
}

export interface OrderTotals {
  itemsTotal: Satang;
  discountTotal: Satang;
  serviceCharge: Satang;
  vatAmount: Satang;
  rounding: Satang;
  total: Satang;
  commission: Satang;
  commissionVat: Satang;
  /** Revenue excluding VAT and rounding — what the owner actually earned from sales. */
  netSales: Satang;
}

/** round(qty × (unit + modifiers)) — qty may be fractional (0.5 kg), up to 3 decimals. */
export function lineTotal(line: PricingLine): Satang {
  const qtyMilli = Math.round(line.qty * 1000);
  return divRound(qtyMilli * (line.unitPrice + line.modifiersTotal), 1000);
}

export function calculateOrderTotals(input: PricingInput): OrderTotals {
  const itemsTotal = input.lines
    .filter((l) => !l.voided)
    .reduce((sum, l) => sum + lineTotal(l), 0);

  let discountTotal = 0;
  if (input.discount) {
    const { type, value } = input.discount;
    if (type === "percent") {
      const pct = Math.min(Math.max(value, 0), 100);
      discountTotal = divRound(itemsTotal * Math.round(pct * 100), 10_000);
    } else {
      discountTotal = Math.min(Math.round(Math.max(value, 0)), itemsTotal);
    }
  }

  const net = itemsTotal - discountTotal;
  const serviceCharge = applyRate(net, input.serviceChargeRate);
  const vatBp = rateToBasisPoints(input.vatRate);

  let vatAmount: Satang;
  let base: Satang;
  if (vatBp === 0) {
    vatAmount = 0;
    base = net + serviceCharge;
  } else if (input.pricesIncludeVat) {
    base = net + serviceCharge;
    vatAmount = divRound(base * vatBp, 10_000 + vatBp);
  } else {
    vatAmount = divRound((net + serviceCharge) * vatBp, 10_000);
    base = net + serviceCharge + vatAmount;
  }

  const rounding = input.rounding ?? 0;
  const commission = applyRate(net, input.commissionRate ?? 0);
  const commissionVat = input.commissionVat === false ? 0 : applyRate(commission, 0.07);
  const total = base + rounding;

  return {
    itemsTotal,
    discountTotal,
    serviceCharge,
    vatAmount,
    rounding,
    total,
    commission,
    commissionVat,
    netSales: total - vatAmount - rounding,
  };
}

export type CashRounding = "none" | "0.25" | "1.00";

/** Rounds a cash bill (25 satang or whole baht) and returns the adjustment. */
export function cashRound(total: Satang, mode: CashRounding): { total: Satang; rounding: Satang } {
  if (mode === "none") return { total, rounding: 0 };
  const step = mode === "0.25" ? 25 : 100;
  const rounded = divRound(total, step) * step;
  return { total: rounded, rounding: rounded - total };
}

/**
 * Quick-tender buttons for the cash screen: exact amount first, then the
 * banknotes a customer is most likely to hand over. Fewer taps, fewer errors.
 */
export function suggestTenders(total: Satang, max = 4): Satang[] {
  const notes = [2000, 5000, 10000, 50000, 100000]; // ฿20 … ฿1000
  const out = new Set<Satang>([total]);
  const up = (step: number) => Math.ceil(total / step) * step;
  for (const step of [1000, 5000, 10000]) {
    const v = up(step);
    if (v > total) out.add(v);
  }
  for (const n of notes) if (n > total) out.add(n);
  return [...out].sort((a, b) => a - b).slice(0, max);
}

export function changeDue(total: Satang, tendered: Satang): Satang {
  return Math.max(tendered - total, 0);
}

/**
 * The price of a menu item on a channel that adds a markup (a delivery platform's menu): the base price plus
 * the markup, rounded up to the next ฿5. Integer arithmetic on purpose — a float such as 5000 × 1.1 lands a
 * hair above 5500 and would round up a whole step. Must match `app.resolve_menu_price` in the database.
 */
export function channelPrice(base: Satang, markup: number): Satang {
  if (!(markup > 0)) return base;
  // Markup in ten-thousandths (0.15 → 1500), so base × (10000 + markup) stays an exact integer.
  const scaled = base * (10_000 + Math.round(markup * 10_000));
  return Math.ceil(scaled / 5_000_000) * 500;
}
