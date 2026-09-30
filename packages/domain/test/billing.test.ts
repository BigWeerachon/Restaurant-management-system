import { describe, expect, it } from "vitest";
import { billingStage, DEFAULT_GRACE_DAYS, type SubscriptionFacts, type SubscriptionStatus } from "../src/billing";

const now = new Date("2026-10-15T05:00:00.000Z");
const ago = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
const ahead = (days: number) => new Date(now.getTime() + days * 86_400_000).toISOString();

/**
 * The vectors the database is checked against as well (packages/db/tests/001_end_to_end.sql, section 12):
 * the same facts must give the same stage in `app.billing_stage()`.
 */
export const VECTORS: { name: string; facts: SubscriptionFacts; kind: string; daysLeft: number | null; grow: boolean }[] = [
  { name: "paying", facts: { status: "active" }, kind: "ok", daysLeft: null, grow: true },
  { name: "trial with 9 days left", facts: { status: "trialing", trialEndsAt: ahead(9) }, kind: "trial", daysLeft: 9, grow: true },
  { name: "trial that ended a second ago", facts: { status: "trialing", trialEndsAt: new Date(now.getTime() - 1000).toISOString() }, kind: "canceled", daysLeft: null, grow: true },
  { name: "just missed a payment", facts: { status: "past_due", pastDueSince: now.toISOString() }, kind: "past_due", daysLeft: 14, grow: true },
  { name: "missed 5 days ago", facts: { status: "past_due", pastDueSince: ago(5) }, kind: "past_due", daysLeft: 9, grow: true },
  { name: "one day of grace left", facts: { status: "past_due", pastDueSince: ago(13) }, kind: "past_due", daysLeft: 1, grow: true },
  { name: "grace ran out exactly now", facts: { status: "past_due", pastDueSince: ago(14) }, kind: "restricted", daysLeft: null, grow: false },
  { name: "long overdue but the job has not run yet", facts: { status: "past_due", pastDueSince: ago(40) }, kind: "restricted", daysLeft: null, grow: false },
  { name: "a shorter grace period", facts: { status: "past_due", pastDueSince: ago(4), graceDays: 3 }, kind: "restricted", daysLeft: null, grow: false },
  { name: "already marked restricted", facts: { status: "restricted", pastDueSince: ago(20) }, kind: "restricted", daysLeft: null, grow: false },
  { name: "canceled", facts: { status: "canceled" }, kind: "canceled", daysLeft: null, grow: true },
];

describe("where a shop stands with its bill", () => {
  it.each(VECTORS)("$name → $kind", ({ facts, kind, daysLeft, grow }) => {
    const s = billingStage(facts, now);
    expect([s.kind, s.daysLeft, s.grow]).toEqual([kind, daysLeft, grow]);
  });

  it("never stops selling, whatever state the subscription is in", () => {
    const statuses: SubscriptionStatus[] = ["trialing", "active", "past_due", "restricted", "canceled"];
    for (const status of statuses) {
      for (const pastDueSince of [null, now.toISOString(), ago(3), ago(400)]) {
        for (const trialEndsAt of [null, ago(30), ahead(30)]) {
          expect(billingStage({ status, pastDueSince, trialEndsAt }, now).sell, `${status} ${pastDueSince} ${trialEndsAt}`).toBe(true);
        }
      }
    }
  });

  it("only takes growth away, and only once the grace period is over", () => {
    expect(DEFAULT_GRACE_DAYS).toBe(14);
    for (const day of [0, 1, 7, 13]) expect(billingStage({ status: "past_due", pastDueSince: ago(day) }, now).grow).toBe(true);
    for (const day of [14, 15, 90]) expect(billingStage({ status: "past_due", pastDueSince: ago(day) }, now).grow).toBe(false);
  });
});
