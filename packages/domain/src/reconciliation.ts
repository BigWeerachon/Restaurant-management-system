/**
 * Reconciliation suggestions: which expected receipts (card batches, PromptPay
 * transfers, platform payouts) explain a bank statement line.
 *
 * The accountant confirms with one tap; the database command
 * (app.match_statement_line) books the match and any variance.
 */
import type { Satang } from "./money";

export interface StatementLine {
  id: string;
  date: string; // YYYY-MM-DD
  amount: Satang;
  description?: string;
}

export interface ExpectedReceipt {
  id: string;
  label: string;
  expectedDate: string; // YYYY-MM-DD
  amount: Satang;
  sourceType: "card_batch" | "payment" | "platform_payout" | "cash_deposit" | "other";
}

export interface MatchSuggestion {
  lineId: string;
  expectedIds: string[];
  variance: Satang;
  /** 0–1: exact single match on the expected date scores highest. */
  confidence: number;
  reason: "exact" | "combined" | "near";
  /** Plain-language explanation of the difference, if any. */
  varianceHint?: string;
  /** Suggested account for the difference. */
  varianceAccount?: string;
}

export interface MatchOptions {
  /** Days a payout may arrive before/after the expected date. */
  dayWindow?: number;
  /** Relative tolerance for "near" matches (platform fees often differ slightly). */
  tolerance?: number;
  /** Max receipts combined into one bank line (platform weekly payouts). */
  maxCombine?: number;
}

const dayDiff = (a: string, b: string) =>
  Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);

export function suggestMatches(
  lines: StatementLine[],
  expected: ExpectedReceipt[],
  opts: MatchOptions = {},
): MatchSuggestion[] {
  const { dayWindow = 3, tolerance = 0.05, maxCombine = 7 } = opts;
  const used = new Set<string>();
  const out: MatchSuggestion[] = [];

  // Largest lines first: they are the most distinctive.
  const incoming = lines.filter((l) => l.amount > 0).sort((a, b) => b.amount - a.amount);

  for (const line of incoming) {
    const candidates = expected
      .filter((e) => !used.has(e.id) && Math.abs(dayDiff(line.date, e.expectedDate)) <= dayWindow)
      .sort((a, b) => Math.abs(dayDiff(line.date, a.expectedDate)) - Math.abs(dayDiff(line.date, b.expectedDate)));

    // 1) Exact single match.
    const exact = candidates.find((e) => e.amount === line.amount);
    if (exact) {
      used.add(exact.id);
      out.push({
        lineId: line.id,
        expectedIds: [exact.id],
        variance: 0,
        confidence: dayDiff(line.date, exact.expectedDate) === 0 ? 1 : 0.9,
        reason: "exact",
      });
      continue;
    }

    // 2) Several receipts of the same source paid out together (weekly payouts).
    const combo = findCombination(line.amount, candidates, maxCombine);
    if (combo) {
      combo.forEach((e) => used.add(e.id));
      out.push({ lineId: line.id, expectedIds: combo.map((e) => e.id), variance: 0, confidence: 0.85, reason: "combined" });
      continue;
    }

    // 3) Near match: a platform deducted a bit more (ads, promo co-funding) or a fee changed.
    const near = candidates
      .map((e) => ({ e, diff: line.amount - e.amount }))
      .filter(({ e, diff }) => Math.abs(diff) <= Math.abs(e.amount) * tolerance)
      .sort((a, b) => Math.abs(a.diff) - Math.abs(b.diff))[0];
    if (near) {
      used.add(near.e.id);
      out.push({
        lineId: line.id,
        expectedIds: [near.e.id],
        variance: near.diff,
        confidence: 0.6,
        reason: "near",
        ...explainVariance(near.e.sourceType, near.diff),
      });
    }
  }
  return out;
}

function explainVariance(source: ExpectedReceipt["sourceType"], diff: Satang) {
  if (source === "platform_payout") {
    return diff < 0
      ? { varianceHint: "แพลตฟอร์มหักมากกว่าที่ตั้งค่า GP ไว้ (อาจเป็นค่าโฆษณาหรือโปรโมชันร่วม)", varianceAccount: "commission_expense" }
      : { varianceHint: "แพลตฟอร์มโอนมามากกว่าที่คาด (อาจเป็นเงินชดเชยหรือคืนค่า GP)", varianceAccount: "other_income" };
  }
  if (source === "card_batch") {
    return { varianceHint: "ค่าธรรมเนียมบัตรต่างจากอัตราที่ตั้งไว้", varianceAccount: "payment_fee_expense" };
  }
  return diff < 0
    ? { varianceHint: "เงินเข้าน้อยกว่าที่คาด", varianceAccount: "other_expense" }
    : { varianceHint: "เงินเข้ามากกว่าที่คาด", varianceAccount: "other_income" };
}

/** Small subset-sum over candidates of the same source type (bounded, deterministic). */
function findCombination(target: Satang, candidates: ExpectedReceipt[], maxCombine: number): ExpectedReceipt[] | null {
  const bySource = new Map<string, ExpectedReceipt[]>();
  for (const c of candidates) bySource.set(c.sourceType, [...(bySource.get(c.sourceType) ?? []), c]);
  for (const group of bySource.values()) {
    const items = group.slice(0, 16).sort((a, b) => a.expectedDate.localeCompare(b.expectedDate));
    // Prefer consecutive runs (a platform pays days in sequence) — O(n²).
    for (let i = 0; i < items.length; i++) {
      let sum = 0;
      for (let j = i; j < items.length && j - i < maxCombine; j++) {
        sum += items[j]!.amount;
        if (sum === target && j > i) return items.slice(i, j + 1);
        if (sum > target) break;
      }
    }
  }
  return null;
}

export interface ReconciliationStatus {
  expectedTotal: Satang;
  receivedTotal: Satang;
  missing: ExpectedReceipt[];
  /** Expected receipts overdue by more than `graceDays` — "เงินที่ยังไม่เข้า". */
  overdue: ExpectedReceipt[];
}

export function reconciliationStatus(expected: ExpectedReceipt[], matchedIds: Set<string>, today: string, graceDays = 2): ReconciliationStatus {
  const missing = expected.filter((e) => !matchedIds.has(e.id));
  return {
    expectedTotal: expected.reduce((s, e) => s + e.amount, 0),
    receivedTotal: expected.filter((e) => matchedIds.has(e.id)).reduce((s, e) => s + e.amount, 0),
    missing,
    overdue: missing.filter((e) => dayDiff(today, e.expectedDate) > graceDays),
  };
}
