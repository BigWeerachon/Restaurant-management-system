/**
 * Where a shop stands with its SaaS bill, and what that changes. The rule that never bends: **selling is never
 * stopped by billing** — `sell` is `true` in every stage, and the type says so. What an overdue bill takes away is
 * growth (a new branch, staff member or till), and only after a grace period.
 *
 * The database decides in `app.billing_stage()`; this is the same rule for the screens (and the demo). Both are run on
 * the same vectors in `test/billing.test.ts` and in the SQL end-to-end test.
 */
export type SubscriptionStatus = "trialing" | "active" | "past_due" | "restricted" | "canceled";

export type BillingStageKind = "trial" | "ok" | "past_due" | "restricted" | "canceled";

/** Days after the first missed payment during which nothing at all is taken away. */
export const DEFAULT_GRACE_DAYS = 14;

const DAY = 86_400_000;

export interface SubscriptionFacts {
  status: SubscriptionStatus;
  /** ISO time the free trial ends. */
  trialEndsAt?: string | null;
  /** ISO time the first payment was missed. */
  pastDueSince?: string | null;
  graceDays?: number;
}

export interface BillingStage {
  kind: BillingStageKind;
  /** Trial: days left. Past due: days of grace left. Otherwise null. */
  daysLeft: number | null;
  /** Always true. Billing never stops a sale, a kitchen ticket, a payment or a refund. */
  sell: true;
  /** May a new branch, staff member or till be added? Only an overdue bill past its grace period says no. */
  grow: boolean;
}

export function billingStage(f: SubscriptionFacts, now: Date = new Date()): BillingStage {
  const at = now.getTime();
  const stage = (kind: BillingStageKind, daysLeft: number | null = null): BillingStage => ({ kind, daysLeft, sell: true, grow: kind !== "restricted" });

  switch (f.status) {
    case "canceled":
      return stage("canceled");
    case "restricted":
      return stage("restricted");
    case "past_due": {
      const since = f.pastDueSince ? Date.parse(f.pastDueSince) : NaN;
      if (Number.isNaN(since)) return stage("past_due", f.graceDays ?? DEFAULT_GRACE_DAYS);
      const endsAt = since + (f.graceDays ?? DEFAULT_GRACE_DAYS) * DAY;
      return at >= endsAt ? stage("restricted") : stage("past_due", Math.ceil((endsAt - at) / DAY));
    }
    case "trialing": {
      const ends = f.trialEndsAt ? Date.parse(f.trialEndsAt) : NaN;
      if (Number.isNaN(ends)) return stage("trial");
      // A trial that has run out is over: the shop carries on with the free plan, owing nothing.
      return ends <= at ? stage("canceled") : stage("trial", Math.ceil((ends - at) / DAY));
    }
    default:
      return stage("ok");
  }
}
