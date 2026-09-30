import { CloseDayBody, ExpenseBody, ImportStatementBody, MatchBody, Money } from "@sabai/contracts";
import { reconciliationStatus, suggestMatches, toSatang, type ExpectedReceipt } from "@sabai/domain";
import type { Hono } from "hono";
import { z } from "zod";
import { ApiFailure } from "../errors";
import { route, type Deps, type Env } from "../http";
import { callJson, money } from "./support";

const DateParam = z.iso.date();

export function registerFinance(app: Hono<Env>, deps: Deps) {
  route(app, deps, { method: "POST", path: "/v1/days/{date}/close", tag: "Finance", summary: "ปิดยอดประจำวัน: สรุปยอด ลงบัญชี และสร้างรายการเงินที่ต้องเข้าธนาคาร", body: CloseDayBody, permission: "finance.close_day" }, async ({ params, body, tx }) =>
    tx(async (t) => {
      const date = DateParam.parse(params.date);
      const [r] = await t<{ r: Record<string, unknown> }[]>`select app.close_business_day(${body.branchId}, ${date}::date, ${body.note ?? null}) as r`;
      const s = r!.r;
      return {
        businessDate: date,
        orders: s.orders,
        grossSales: money(s.gross_sales),
        discounts: money(s.discounts),
        serviceCharge: money(s.service_charge),
        vat: money(s.vat),
        total: money(s.total),
        commission: money(s.commission),
        cost: money(s.cost),
      };
    }),
  );

  route(app, deps, { method: "POST", path: "/v1/days/{date}/reopen", tag: "Finance", summary: "เปิดวันที่ปิดยอดแล้วเพื่อแก้ไข (กลับรายการบัญชีให้อัตโนมัติ)", body: z.object({ branchId: z.uuid(), reason: z.string().trim().min(1, "บอกเหตุผลสั้นๆ").max(200) }), permission: "finance.manage" }, async ({ params, body, tx }) =>
    tx(async (t) => {
      await t`select app.reopen_business_day(${body.branchId}, ${DateParam.parse(params.date)}::date, ${body.reason})`;
      return { ok: true };
    }),
  );

  route(app, deps, { method: "POST", path: "/v1/expenses", tag: "Finance", summary: "บันทึกค่าใช้จ่าย (จ่ายแล้วหรือค้างจ่าย)", tenant: true, body: ExpenseBody, permission: "finance.manage", status: 201 }, async ({ tenantId, body, tx }) =>
    tx(async (t) => {
      let accountId = body.accountId;
      if (!accountId && body.category) {
        const systemKey = body.category === "other" ? "other_expense" : body.category;
        const [account] = await t<{ id: string }[]>`select id from app.accounts where tenant_id = ${tenantId} and system_key = ${systemKey}`;
        if (!account) throw new ApiFailure("NOT_FOUND", 404, { entity: "account" });
        accountId = account.id;
      }
      const id = await callJson<string>(t, "app.record_expense", {
        branch_id: body.branchId,
        expense_date: body.expenseDate,
        account_id: accountId,
        description: body.description,
        amount: body.amount,
        vat_amount: body.vatAmount,
        wht_amount: body.whtAmount,
        paid_from: body.paidFrom,
        supplier_id: body.supplierId,
        attachment_url: body.attachmentUrl,
        period_start: body.periodStart,
        period_end: body.periodEnd,
      });
      return { id };
    }),
  );

  route(app, deps, { method: "GET", path: "/v1/expenses", tag: "Finance", summary: "ค่าใช้จ่ายที่บันทึกไว้ (เรียงตามวันที่)", tenant: true, query: z.object({ branchId: z.uuid().optional(), from: DateParam.optional(), to: DateParam.optional() }), permission: "finance.view" }, async ({ tenantId, query, tx }) =>
    tx(async (t) => {
      const rows = await t`
        select e.id, e.branch_id, e.expense_date::text, e.period_start::text, e.period_end::text, e.description, e.amount, e.vat_amount,
               e.wht_amount, e.paid_from, a.name as account, a.system_key as account_key, s.name as supplier
          from app.expenses e join app.accounts a on a.id = e.account_id left join app.suppliers s on s.id = e.supplier_id
         where e.tenant_id = ${tenantId}
           and (${query.branchId ?? null}::uuid is null or e.branch_id = ${query.branchId ?? null})
           and (${query.from ?? null}::date is null or e.expense_date >= ${query.from ?? null})
           and (${query.to ?? null}::date is null or e.expense_date <= ${query.to ?? null})
         order by e.expense_date desc, e.created_at desc limit 500`;
      return rows.map((r) => ({ ...r, amount: money(r.amount), vat_amount: money(r.vat_amount), wht_amount: money(r.wht_amount) }));
    }),
  );

  route(app, deps, { method: "GET", path: "/v1/days", tag: "Finance", summary: "ประวัติการปิดยอดประจำวัน", tenant: true, query: z.object({ branchId: z.uuid() }), permission: "finance.view" }, async ({ query, tx }) =>
    tx(
      (t) => t`
        select business_date::text, status, summary, closed_at, reopened_at, note
          from app.day_closes where branch_id = ${query.branchId} order by business_date desc limit 60`,
    ),
  );

  route(app, deps, { method: "GET", path: "/v1/bills", tag: "Finance", summary: "บิลค้างจ่าย เรียงตามวันครบกำหนด", tenant: true, permission: "finance.view" }, async ({ tenantId, tx }) =>
    tx(async (t) => {
      const rows = await t`
        select b.id, b.internal_no, b.bill_no, b.bill_date::text, b.due_date::text, b.total, b.amount_paid, b.status, b.supplier_id, b.branch_id, b.source_id, s.name as supplier,
               (b.due_date < current_date) as overdue
          from app.bills b left join app.suppliers s on s.id = b.supplier_id
         where b.tenant_id = ${tenantId} and b.status in ('open','partially_paid')
         order by b.due_date`;
      return rows.map((b) => ({ ...b, total: money(b.total), amount_paid: money(b.amount_paid) }));
    }),
  );

  route(app, deps, { method: "POST", path: "/v1/bills/{id}/pay", tag: "Finance", summary: "จ่ายบิล (บางส่วนได้)", body: z.object({ amount: Money, from: z.enum(["bank", "cash_on_hand"]).default("bank"), reference: z.string().max(60).optional(), date: z.iso.date().optional() }), permission: "finance.manage" }, async ({ params, body, tx }) =>
    tx(async (t) => {
      await t`select app.pay_bill(${params.id}, ${body.amount}, ${body.from}, ${body.reference ?? null}, ${body.date ?? null}::date)`;
      return { ok: true };
    }),
  );

  route(app, deps, { method: "POST", path: "/v1/bank-statements", tag: "Finance", summary: "นำเข้ารายการเดินบัญชี (ซ้ำได้ ระบบกันรายการซ้ำให้)", body: ImportStatementBody, permission: "finance.reconcile", status: 201 }, async ({ body, tx }) =>
    tx(async (t) => {
      const [r] = await t<{ r: { import_id: string; inserted: number; duplicates: number } }[]>`
        select app.import_statement_lines(${body.bankAccountId},
          ${t.json(body.lines.map((l) => ({ txn_date: l.txnDate, amount: l.amount, description: l.description ?? null, reference: l.reference ?? null })))}::jsonb,
          ${body.fileName ?? null}) as r`;
      return { importId: r!.r.import_id, inserted: r!.r.inserted, duplicates: r!.r.duplicates };
    }),
  );

  route(app, deps, { method: "GET", path: "/v1/reconciliation", tag: "Finance", summary: "รายการเงินที่ควรเข้า vs เงินที่เข้าจริง พร้อมคู่ที่ระบบแนะนำ", tenant: true, permission: "finance.reconcile" }, async ({ tenantId, tx }) =>
    tx(async (t) => {
      const lines = await t<{ id: string; txn_date: string; amount: string; description: string | null }[]>`
        select id, txn_date::text, amount, description from app.statement_lines
         where tenant_id = ${tenantId} and status = 'unmatched' order by txn_date desc limit 500`;
      const matched = await t<{ id: string; txn_date: string; amount: string; description: string | null }[]>`
        select id, txn_date::text, amount, description from app.statement_lines
         where tenant_id = ${tenantId} and status = 'matched' order by txn_date desc, created_at desc limit 200`;
      const expected = await t<{ id: string; branch_id: string; status: "open" | "partial"; label: string; expected_date: string; expected_amount: string; source_type: ExpectedReceipt["sourceType"]; payer: string }[]>`
        select id, branch_id, status, label, expected_date::text, expected_amount, source_type,
               -- card batches & payouts: the method/channel; single transfers: their clearing account
               case when source_type = 'payment' then clearing_account_id else coalesce(source_id, clearing_account_id) end::text as payer
          from app.expected_receipts
         where tenant_id = ${tenantId} and status in ('open','partial') order by expected_date limit 1000`;
      const exp: ExpectedReceipt[] = expected.map((e) => ({ id: e.id, label: e.label, expectedDate: e.expected_date, amount: toSatang(e.expected_amount), sourceType: e.source_type, payer: e.payer }));
      const suggestions = suggestMatches(
        lines.map((l) => ({ id: l.id, date: l.txn_date, amount: toSatang(l.amount), description: l.description ?? undefined })),
        exp,
      );
      const status = reconciliationStatus(exp, new Set(), new Date().toISOString().slice(0, 10));
      return {
        unmatchedLines: lines.map((l) => ({ ...l, amount: money(l.amount) })),
        matchedLines: matched.map((l) => ({ ...l, amount: money(l.amount) })),
        expected: expected.map((e) => ({ ...e, expected_amount: money(e.expected_amount) })),
        suggestions: suggestions.map((s) => ({ ...s, variance: money(s.variance / 100) })),
        overdue: status.overdue.map((e) => ({ id: e.id, label: e.label, expectedDate: e.expectedDate, amount: money(e.amount / 100) })),
      };
    }),
  );

  route(app, deps, { method: "POST", path: "/v1/statement-lines/{id}/match", tag: "Finance", summary: "ยืนยันการจับคู่ (บันทึกส่วนต่างให้อัตโนมัติ)", body: MatchBody, permission: "finance.reconcile" }, async ({ params, body, tx }) =>
    tx(async (t) => {
      const [r] = await t<{ r: { variance: number; journal_entry_id: string } }[]>`
        select app.match_statement_line(${params.id}, ${body.expectedIds}::uuid[], ${body.varianceAccount ?? null}, ${body.note ?? null}) as r`;
      return { variance: money(r!.r.variance), journalEntryId: r!.r.journal_entry_id };
    }),
  );

  route(app, deps, { method: "POST", path: "/v1/statement-lines/{id}/ignore", tag: "Finance", summary: "ข้ามรายการที่ไม่เกี่ยวกับการขาย (เช่น โอนเงินส่วนตัว)", body: z.object({ note: z.string().trim().min(1, "บอกเหตุผลสั้นๆ").max(200) }), permission: "finance.reconcile" }, async ({ params, body, tx }) =>
    tx(async (t) => {
      await t`select app.ignore_statement_line(${params.id}, ${body.note})`;
      return { ok: true };
    }),
  );
}
