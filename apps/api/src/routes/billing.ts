import { BillingWebhookBody, ChangePlanBody } from "@sabai/contracts";
import { billingStage, type BillingStage, type SubscriptionStatus } from "@sabai/domain";
import { timingSafeEqual } from "node:crypto";
import type { Hono } from "hono";
import { createBillingProvider, type BillingProvider, type PaymentInstructions } from "../billing/provider";
import { runBillingJob } from "../billing/job";
import { verifyWebhook } from "../billing/webhook";
import type { Tx } from "../db";
import { ApiFailure } from "../errors";
import { route, type Deps, type Env } from "../http";
import { money } from "./support";

interface InvoiceRow {
  id: string;
  invoice_no: string;
  status: string;
  kind: string;
  plan_code: string | null;
  billing_cycle: string | null;
  subtotal: string;
  vat_amount: string;
  total: string;
  period_start: string;
  period_end: string;
  due_at: Date | null;
  paid_at: Date | null;
  created_at: Date;
}

export interface InvoiceView {
  id: string;
  invoiceNo: string;
  status: string;
  kind: string;
  planCode: string | null;
  billingCycle: string | null;
  subtotal: string;
  vatAmount: string;
  total: string;
  periodStart: string;
  periodEnd: string;
  dueAt: string | null;
  paidAt: string | null;
  createdAt: string;
  /** Only on the invoice waiting to be paid, and only while a way of paying is switched on. */
  payment: PaymentInstructions | null;
}

const INVOICE_COLUMNS = `id, invoice_no, status, kind, plan_code, billing_cycle, subtotal, vat_amount, total,
       period_start::text as period_start, period_end::text as period_end, due_at, paid_at, created_at`;

function invoiceView(r: InvoiceRow, provider: BillingProvider | null): InvoiceView {
  const total = money(r.total);
  return {
    id: r.id,
    invoiceNo: r.invoice_no,
    status: r.status,
    kind: r.kind,
    planCode: r.plan_code,
    billingCycle: r.billing_cycle,
    subtotal: money(r.subtotal),
    vatAmount: money(r.vat_amount),
    total,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    dueAt: r.due_at ? r.due_at.toISOString() : null,
    paidAt: r.paid_at ? r.paid_at.toISOString() : null,
    createdAt: r.created_at.toISOString(),
    payment: r.status === "open" && provider ? provider.paymentInstructions({ invoiceNo: r.invoice_no, total }) : null,
  };
}

async function invoicesOf(tx: Tx, tenantId: string, provider: BillingProvider | null, limit = 12): Promise<InvoiceView[]> {
  const rows = await tx.unsafe<InvoiceRow[]>(
    `select ${INVOICE_COLUMNS} from app.subscription_invoices where tenant_id = $1 order by created_at desc, invoice_no desc limit ${limit}`,
    [tenantId],
  );
  return rows.map((r) => invoiceView(r, provider));
}

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * The shop's own bill for using Sabai (checklist 8.1). The rule that never bends: this never stops a sale. An overdue bill
 * shows a banner, then after the grace period it stops adding branches, staff and tills — nothing else.
 */
export function registerBilling(app: Hono<Env>, deps: Deps) {
  const provider = createBillingProvider(deps.config.billing);

  route(app, deps, { method: "GET", path: "/v1/billing", tag: "Billing", summary: "ค่าบริการของร้าน: แพ็กเกจ สถานะ ใบแจ้งหนี้ และวิธีชำระ", tenant: true, permission: "billing.manage" }, async ({ tenantId, tx }) =>
    tx(async (t) => {
      await t`select app.assert_permission(${tenantId}, 'billing.manage')`;
      const [s] = await t<
        { plan_code: string; status: SubscriptionStatus; billing_cycle: string; trial_ends_at: Date | null; current_period_end: Date | null; cancel_at_period_end: boolean; past_due_since: Date | null; grace_days: number }[]
      >`select plan_code, status, billing_cycle, trial_ends_at, current_period_end, cancel_at_period_end, past_due_since, grace_days
          from app.subscriptions where tenant_id = ${tenantId}`;
      if (!s) throw new ApiFailure("NOT_FOUND", 404, { entity: "subscription" });
      const stage: BillingStage = billingStage({ status: s.status, trialEndsAt: s.trial_ends_at?.toISOString() ?? null, pastDueSince: s.past_due_since?.toISOString() ?? null, graceDays: s.grace_days });
      const invoices = await invoicesOf(t, tenantId, provider);
      return {
        mode: provider ? "invoice" : "off",
        planCode: s.plan_code,
        status: s.status,
        billingCycle: s.billing_cycle,
        stage: { kind: stage.kind, daysLeft: stage.daysLeft, grow: stage.grow },
        trialEndsAt: s.trial_ends_at?.toISOString() ?? null,
        currentPeriodEnd: s.current_period_end?.toISOString() ?? null,
        cancelAtPeriodEnd: s.cancel_at_period_end,
        pastDueSince: s.past_due_since?.toISOString() ?? null,
        graceDays: s.grace_days,
        openInvoice: invoices.find((i) => i.status === "open") ?? null,
        invoices,
      };
    }),
  );

  route(app, deps, { method: "POST", path: "/v1/settings/plan", tag: "Billing", summary: "เปลี่ยนแพ็กเกจ (ลดแพ็กเกจมีผลทันที เลื่อนแพ็กเกจเป็นใบแจ้งหนี้ให้ชำระก่อน)", tenant: true, body: ChangePlanBody, permission: "billing.manage" }, async ({ tenantId, body, tx }) =>
    tx(async (t) => {
      // Online billing is not switched on: choosing a plan applies it, as it always has.
      if (!provider) {
        await t`select app.change_plan(${tenantId}, ${body.planCode})`;
        return { applied: true, planCode: body.planCode, invoice: null };
      }
      const [row] = await t<{ r: { applied: boolean; invoice_id?: string } }[]>`select app.request_plan_change(${tenantId}, ${body.planCode}, ${body.billingCycle}) as r`;
      if (row!.r.applied) return { applied: true, planCode: body.planCode, invoice: null };
      const [inv] = await t.unsafe<InvoiceRow[]>(`select ${INVOICE_COLUMNS} from app.subscription_invoices where id = $1`, [row!.r.invoice_id!]);
      return { applied: false, planCode: body.planCode, invoice: invoiceView(inv!, provider) };
    }),
  );

  route(app, deps, { method: "POST", path: "/v1/billing/invoices/{id}/void", tag: "Billing", summary: "ยกเลิกใบแจ้งหนี้การเปลี่ยนแพ็กเกจที่ยังไม่ได้ชำระ", tenant: true, permission: "billing.manage" }, async ({ params, tx }) =>
    tx(async (t) => {
      await t`select app.void_subscription_invoice(${params.id})`;
      return { ok: true };
    }),
  );

  // What a provider tells us. Signed, so nobody but the provider (or whoever confirms a transfer) can say "paid".
  route(app, deps, { method: "POST", path: "/v1/billing/webhook/{id}", tag: "Billing", summary: "รับเหตุการณ์จากผู้ให้บริการชำระเงิน (ลงลายมือชื่อด้วย X-Sabai-Signature)", auth: false, idempotent: false }, async ({ c, params }) => {
    if (!provider || params.id !== provider.name) throw new ApiFailure("NOT_FOUND", 404);
    const raw = await c.req.text();
    verifyWebhook(deps.config.billing.webhookSecret, raw, c.req.header("x-sabai-signature"));
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new ApiFailure("VALIDATION", 400, {}, { _: "รูปแบบข้อมูลไม่ถูกต้อง" });
    }
    const parsed = BillingWebhookBody.safeParse(json);
    if (!parsed.success) throw new ApiFailure("VALIDATION", 422, {}, { _: "เหตุการณ์ไม่ครบถ้วน" });
    const ev = parsed.data;
    const data = {
      invoice_no: ev.data.invoiceNo,
      amount: ev.data.amount,
      provider_invoice_id: ev.data.providerInvoiceId,
      provider_customer_id: ev.data.customerId,
      provider_subscription_id: ev.data.subscriptionId,
    };
    const [row] = await deps.sql<{ outcome: string }[]>`select app.apply_billing_event(${provider.name}, ${ev.id}, ${ev.type}, ${deps.sql.json(data as never)}) as outcome`;
    const outcome = row!.outcome;
    // Answered 200 whatever came of it: the provider must not keep resending an event we understood. The ones a person has to look at are logged loudly.
    if (["needs_review", "amount_mismatch", "unknown_invoice"].includes(outcome)) {
      deps.log.warn("billing_event_needs_attention", { provider: provider.name, eventId: ev.id, type: ev.type, outcome, invoiceNo: ev.data.invoiceNo });
    }
    return { received: true, outcome };
  });

  // For an outside scheduler (cron). Inside this process the job also runs on a timer; see server.ts.
  route(app, deps, { method: "POST", path: "/v1/billing/run", tag: "Billing", summary: "รันงานประจำวันของระบบเรียกเก็บเงิน (ใบแจ้งหนี้ต่ออายุ ค้างชำระ หมดช่วงผ่อนผัน) — ต้องมี X-Job-Secret", auth: false, idempotent: false }, async ({ c }) => {
    const secret = deps.config.billing.jobSecret;
    if (!secret) throw new ApiFailure("NOT_FOUND", 404);
    if (!same(c.req.header("x-job-secret") ?? "", secret)) throw new ApiFailure("AUTH_REQUIRED", 401);
    return runBillingJob(deps.sql, deps.log);
  });
}
