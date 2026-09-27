/**
 * Money is handled as integer satang (1 THB = 100 satang) everywhere in the
 * domain, so arithmetic is exact. Conversions happen only at the edges
 * (database numeric strings, user input, display).
 */
export type Satang = number;

/** Round half away from zero — identical to Postgres `round(numeric)`. */
export function roundHalfAwayFromZero(value: number): number {
  const rounded = Math.round(Math.abs(value) + Number.EPSILON * Math.abs(value));
  return value < 0 ? -rounded : rounded;
}

/**
 * Exact integer division with half-away-from-zero rounding: round(numerator / denominator).
 * Avoids floating point for VAT maths such as total × 7 / 107.
 */
export function divRound(numerator: number, denominator: number): number {
  if (denominator === 0) throw new RangeError("Division by zero");
  const sign = Math.sign(numerator) * Math.sign(denominator);
  const n = Math.abs(numerator);
  const d = Math.abs(denominator);
  const q = Math.floor((2 * n + d) / (2 * d));
  return sign * q;
}

/** Parses "123.45", "123.4", 123.45 or "1,234.50" into satang exactly (no float drift). */
export function toSatang(value: string | number): Satang {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new RangeError(`Invalid amount: ${value}`);
    return roundHalfAwayFromZero(value * 100);
  }
  const cleaned = value.replace(/[,\s฿]/g, "");
  const match = /^(-)?(\d*)(?:\.(\d*))?$/.exec(cleaned);
  if (!match || (match[2] === "" && (match[3] ?? "") === "")) {
    throw new RangeError(`Invalid amount: ${value}`);
  }
  const negative = match[1] === "-";
  const whole = Number(match[2] || "0");
  const fraction = (match[3] ?? "").padEnd(3, "0");
  // Third decimal decides rounding (half away from zero).
  let satang = whole * 100 + Number(fraction.slice(0, 2));
  if (Number(fraction[2]) >= 5) satang += 1;
  return negative ? -satang : satang;
}

export function fromSatang(satang: Satang): number {
  return satang / 100;
}

/** "145.00" — the canonical wire/database representation. */
export function satangToDecimalString(satang: Satang): string {
  const negative = satang < 0;
  const abs = Math.abs(satang);
  const whole = Math.floor(abs / 100);
  const fraction = String(abs % 100).padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

const formatters = new Map<string, Intl.NumberFormat>();

function formatter(locale: string, withDecimals: boolean): Intl.NumberFormat {
  const key = `${locale}|${withDecimals}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, {
      minimumFractionDigits: withDecimals ? 2 : 0,
      maximumFractionDigits: 2,
    });
    formatters.set(key, f);
  }
  return f;
}

export interface FormatMoneyOptions {
  locale?: string;
  /** Show "฿" prefix (default true). */
  symbol?: boolean;
  /** Hide ".00" on whole amounts — calmer on POS buttons (default false). */
  compact?: boolean;
}

/** ฿1,234.50 — Thai-friendly money display. */
export function formatMoney(satang: Satang, options: FormatMoneyOptions = {}): string {
  const { locale = "th-TH", symbol = true, compact = false } = options;
  const whole = satang % 100 === 0;
  const text = formatter(locale, !(compact && whole)).format(Math.abs(satang) / 100);
  return `${satang < 0 ? "-" : ""}${symbol ? "฿" : ""}${text}`;
}

/**
 * Splits `total` across `weights` so the parts always sum exactly to the total
 * (largest remainder method). Used for pro-rata discount allocation.
 */
export function allocate(total: Satang, weights: number[]): Satang[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (weights.length === 0) return [];
  if (sum === 0) return weights.map((_, i) => (i === 0 ? total : 0));
  const raw = weights.map((w) => (total * w) / sum);
  const floored = raw.map((r) => Math.floor(r));
  let remainder = total - floored.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  const result = [...floored];
  for (let k = 0; remainder > 0 && k < order.length; k++, remainder--) {
    const idx = order[k]!.i;
    result[idx] = result[idx]! + 1;
  }
  return result;
}

/** Rate as basis points (0.07 → 700) so percentage maths stays integer. */
export function rateToBasisPoints(rate: number): number {
  return roundHalfAwayFromZero(rate * 10_000);
}

/** amount × rate, rounded to satang, computed with integers. */
export function applyRate(amount: Satang, rate: number): Satang {
  return divRound(amount * rateToBasisPoints(rate), 10_000);
}
