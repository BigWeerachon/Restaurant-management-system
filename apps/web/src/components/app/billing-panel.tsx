"use client";

import { formatMoney, formatThaiDate, planOf } from "@sabai/domain";
import { CheckCircle2, Clock3, Copy, Crown, Landmark, OctagonAlert, ShieldCheck, TriangleAlert, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { LoadBanner } from "@/components/app/load-banner";
import { PromptPayQr } from "@/components/app/promptpay-qr";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/overlay";
import { Badge, Card, type Tone } from "@/components/ui/primitives";
import { useBilling, useDsAction } from "@/hooks/use-data-source";
import { useAccess } from "@/hooks/use-sabai";
import type { BillingInvoice, BillingState } from "@/lib/demo/types";

/** A date-and-time from the server, shown as the shop's own calendar day. */
const dayOf = (iso: string) => formatThaiDate(new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Asia/Bangkok" }), false);

const cycleText = (c: BillingInvoice["billingCycle"]) => (c === "yearly" ? "รายปี" : c === "monthly" ? "รายเดือน" : "");

/** What an invoice is for, in the words the shop would use. */
export function invoiceTitle(i: BillingInvoice): string {
  const plan = i.planCode ? `แพ็กเกจ${planOf(i.planCode).name} ${cycleText(i.billingCycle)}` : "ค่าบริการ";
  return i.kind === "renewal" ? `ต่ออายุ${plan}` : `เริ่ม${plan}`;
}

const INVOICE_STATUS: Record<BillingInvoice["status"], { tone: Tone; label: string; icon: ReactNode }> = {
  open: { tone: "warning", label: "รอชำระ", icon: <Clock3 className="h-3 w-3" aria-hidden="true" /> },
  paid: { tone: "success", label: "ชำระแล้ว", icon: <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> },
  void: { tone: "neutral", label: "ยกเลิก", icon: <XCircle className="h-3 w-3" aria-hidden="true" /> },
  draft: { tone: "neutral", label: "ร่าง", icon: <Clock3 className="h-3 w-3" aria-hidden="true" /> },
  uncollectible: { tone: "danger", label: "เก็บเงินไม่ได้", icon: <OctagonAlert className="h-3 w-3" aria-hidden="true" /> },
};

/** Where the shop stands, in a word with an icon — colour is never the only signal. */
function stageBadge(b: BillingState): { tone: Tone; label: string; icon: ReactNode } {
  const { stage } = b;
  if (stage.kind === "restricted") return { tone: "danger", label: "ค้างชำระเกินช่วงผ่อนผัน", icon: <OctagonAlert className="h-3 w-3" aria-hidden="true" /> };
  if (stage.kind === "past_due") return { tone: "warning", label: `ค้างชำระ · ผ่อนผันอีก ${stage.daysLeft ?? 0} วัน`, icon: <TriangleAlert className="h-3 w-3" aria-hidden="true" /> };
  if (stage.kind === "trial") return { tone: "info", label: `ทดลองใช้ฟรีเหลือ ${stage.daysLeft ?? 0} วัน`, icon: <Clock3 className="h-3 w-3" aria-hidden="true" /> };
  if (b.status === "canceled") return { tone: "neutral", label: "ใช้แพ็กเกจฟรี", icon: <Crown className="h-3 w-3" aria-hidden="true" /> };
  return { tone: "success", label: "ใช้งานปกติ", icon: <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> };
}

/** How to pay one invoice: a PromptPay QR with the amount locked, the bank account, and the reference that finds the payment. */
export function InvoicePayDialog({ invoice, onClose }: { invoice: BillingInvoice | null; onClose: () => void }) {
  const pay = invoice?.payment ?? null;
  return (
    <Dialog open={!!invoice} onOpenChange={(v) => !v && onClose()} title={invoice ? `ชำระใบแจ้งหนี้ ${invoice.invoiceNo}` : "ชำระใบแจ้งหนี้"} description={invoice ? invoiceTitle(invoice) : undefined} size="md" footer={<Button onClick={onClose}>ปิด</Button>}>
      {invoice && (
        <div className="space-y-4 pb-2">
          <p className="text-center text-3xl font-bold tabular text-ink">{formatMoney(invoice.total)}</p>
          <p className="text-center text-xs text-ink-3">
            รวม VAT {formatMoney(invoice.vatAmount)} · ก่อน VAT {formatMoney(invoice.subtotal)}
            {invoice.dueAt ? ` · กำหนดชำระ ${dayOf(invoice.dueAt)}` : ""}
          </p>
          {pay?.promptpayId && <PromptPayQr id={pay.promptpayId} amount={pay.amount / 100} />}
          {pay && (pay.accountNo || pay.bankName) && (
            <div className="rounded-2xl bg-surface-2 p-4 text-sm">
              <p className="mb-1 flex items-center gap-1.5 font-medium text-ink">
                <Landmark className="h-4 w-4 text-ink-3" aria-hidden="true" /> หรือโอนเข้าบัญชี
              </p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-ink-2">
                {pay.bankName && (
                  <>
                    <dt className="text-ink-3">ธนาคาร</dt>
                    <dd>{pay.bankName}</dd>
                  </>
                )}
                {pay.accountNo && (
                  <>
                    <dt className="text-ink-3">เลขที่บัญชี</dt>
                    <dd className="tabular">{pay.accountNo}</dd>
                  </>
                )}
                {pay.accountName && (
                  <>
                    <dt className="text-ink-3">ชื่อบัญชี</dt>
                    <dd>{pay.accountName}</dd>
                  </>
                )}
              </dl>
            </div>
          )}
          {pay && (
            <div className="flex justify-center">
              <Button
                size="sm"
                variant="secondary"
                icon={<Copy className="h-4 w-4" aria-hidden="true" />}
                onClick={() => {
                  // The clipboard is not there on every device; the number is on screen either way.
                  navigator.clipboard?.writeText(pay.reference).then(
                    () => toast.success("คัดลอกเลขที่ใบแจ้งหนี้แล้ว"),
                    () => toast.message("คัดลอกไม่ได้ พิมพ์เลขที่ใบแจ้งหนี้ตามที่เห็นบนหน้าจอ"),
                  );
                }}
              >
                คัดลอกเลขที่ใบแจ้งหนี้
              </Button>
            </div>
          )}
          {pay && (
            <p className="rounded-2xl bg-warning-soft p-3 text-sm text-warning">
              ใส่เลขที่ใบแจ้งหนี้ <span className="font-semibold tabular">{pay.reference}</span> ในบันทึกการโอน เพื่อให้เราจับคู่การชำระได้ · ทีมงานจะตรวจสอบและยืนยัน แล้วแพ็กเกจเริ่มใช้ให้เอง (หน้านี้อัปเดตเอง ไม่ต้องกดอะไร)
            </p>
          )}
        </div>
      )}
    </Dialog>
  );
}

/** The bill for using Sabai: where the shop stands, the invoice waiting to be paid, and the ones before it. */
export function BillingPanel({ onPay }: { onPay: (invoice: BillingInvoice) => void }) {
  const { billing, load } = useBilling();
  const { can } = useAccess();
  const { exec, pending } = useDsAction();
  if (!can("billing.manage")) return null;
  if (!billing) return <LoadBanner state={load} className="mb-4" />;

  const badge = stageBadge(billing);
  const open = billing.openInvoice;
  const plan = planOf(billing.planCode);

  return (
    <>
      <LoadBanner state={load} className="mb-4" />
      <Card className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center">
        <Crown className="h-8 w-8 shrink-0 text-accent" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 font-semibold text-ink">
            แพ็กเกจปัจจุบัน: {plan.name}
            <Badge tone={badge.tone} icon={badge.icon}>
              {badge.label}
            </Badge>
          </p>
          <p className="mt-1 text-sm text-ink-3">
            {billing.stage.kind === "trial" && billing.trialEndsAt && `ทดลองใช้ฟรีถึง ${dayOf(billing.trialEndsAt)} · หลังจากนั้นใช้แพ็กเกจฟรีต่อได้ ไม่เสียค่าใช้จ่ายถ้าไม่เลือกแพ็กเกจ`}
            {billing.stage.kind === "ok" && billing.currentPeriodEnd && (billing.cancelAtPeriodEnd ? `จะสิ้นสุดวันที่ ${dayOf(billing.currentPeriodEnd)} แล้วใช้แพ็กเกจฟรีต่อ` : `รอบบิล${cycleText(billing.billingCycle)} · ต่ออายุวันที่ ${dayOf(billing.currentPeriodEnd)}`)}
            {billing.stage.kind === "past_due" && "ทุกอย่างยังใช้ได้ครบ ถ้าเลยช่วงผ่อนผันจะเพิ่มสาขา พนักงาน หรือเครื่องใหม่ไม่ได้"}
            {billing.stage.kind === "restricted" && "เพิ่มสาขา พนักงาน หรือเครื่องใหม่ไม่ได้จนกว่าจะชำระ ชำระแล้วทุกอย่างกลับมาทันที"}
            {billing.stage.kind === "canceled" && "ข้อมูลทั้งหมดอยู่ครบ เลือกแพ็กเกจเมื่อพร้อม"}
          </p>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-3">
            <ShieldCheck className="h-4 w-4 shrink-0 text-success" aria-hidden="true" /> ไม่ว่าเกิดอะไรขึ้นกับการชำระค่าบริการ ระบบจะไม่หยุดการขายหน้าร้านของคุณ
          </p>
        </div>
      </Card>

      {open && (
        <Card className="mt-4 flex flex-col gap-3 p-5 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2 font-semibold text-ink">
              ใบแจ้งหนี้ <span className="tabular">{open.invoiceNo}</span>
              <Badge tone="warning" icon={<Clock3 className="h-3 w-3" aria-hidden="true" />}>
                รอชำระ
              </Badge>
            </p>
            <p className="mt-0.5 text-sm text-ink-2">
              {invoiceTitle(open)} · <span className="font-semibold tabular">{formatMoney(open.total)}</span> (รวม VAT)
            </p>
            {open.dueAt && <p className="text-xs text-ink-3">กำหนดชำระ {dayOf(open.dueAt)}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            {open.payment && (
              <Button onClick={() => onPay(open)}>วิธีชำระเงิน</Button>
            )}
            {open.kind === "plan_change" && (
              <Button variant="ghost" loading={pending} onClick={() => exec((ds) => ds.voidInvoice(open.id), { success: "ยกเลิกใบแจ้งหนี้แล้ว", successDetail: "แพ็กเกจของร้านยังเหมือนเดิม" })}>
                ไม่เปลี่ยนแพ็กเกจแล้ว
              </Button>
            )}
          </div>
        </Card>
      )}

      {billing.invoices.length > 0 && (
        <Card className="mt-4 p-5">
          <h2 className="mb-2 font-semibold text-ink">ประวัติใบแจ้งหนี้</h2>
          <ul className="divide-y divide-line">
            {billing.invoices.map((i) => {
              const st = INVOICE_STATUS[i.status];
              return (
                <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm">
                  <span className="tabular font-medium text-ink">{i.invoiceNo}</span>
                  <span className="min-w-0 flex-1 text-ink-2">{invoiceTitle(i)}</span>
                  <span className="tabular text-ink">{formatMoney(i.total)}</span>
                  <Badge tone={st.tone} icon={st.icon}>
                    {st.label}
                    {i.status === "paid" && i.paidAt ? ` ${dayOf(i.paidAt)}` : ""}
                  </Badge>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </>
  );
}
