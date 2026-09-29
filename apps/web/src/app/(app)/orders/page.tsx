"use client";

import { Banknote, Bike, CreditCard, Printer, QrCode, RotateCcw, ShoppingBag, Utensils } from "lucide-react";
import { motion } from "motion/react";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { LoadBanner } from "@/components/app/load-banner";
import { PageHeader } from "@/components/app/page-header";
import { Button, LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { Dialog, Switch } from "@/components/ui/overlay";
import { Badge, Card, Input, SearchInput, Segmented } from "@/components/ui/primitives";
import { useDsAction, useLoad } from "@/hooks/use-data-source";
import { printReceipt } from "@/lib/print";
import { useAccess, useBusinessDate } from "@/hooks/use-sabai";
import { actorName } from "@/lib/demo/engine";
import { formatBaht } from "@/lib/demo/selectors";
import { useSabai } from "@/lib/demo/store";
import type { Order } from "@/lib/demo/types";

const STATUS: Record<Order["status"], { label: string; tone: "success" | "info" | "danger" | "neutral" }> = {
  open: { label: "ยังไม่ชำระ", tone: "info" },
  paid: { label: "ชำระแล้ว", tone: "success" },
  voided: { label: "ยกเลิก", tone: "neutral" },
  refunded: { label: "คืนเงินแล้ว", tone: "danger" },
};
const CHANNEL_ICON = { dine_in: Utensils, takeaway: ShoppingBag, delivery_platform: Bike, own_delivery: Bike };
const METHOD_ICON = { cash: Banknote, promptpay: QrCode, card: CreditCard, platform: Bike, ewallet: CreditCard };

function OrdersInner() {
  const db = useSabai((s) => s.db);
  const { branch, can } = useAccess();
  const date = useBusinessDate();
  const params = useSearchParams();
  const { exec, pending } = useDsAction();
  const load = useLoad(["orders"]);
  const [status, setStatus] = useState<"all" | Order["status"]>((params.get("status") as Order["status"]) ?? "all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Order | null>(null);
  const [refund, setRefund] = useState(false);
  const [reason, setReason] = useState("");
  const [restock, setRestock] = useState(false);

  const orders = db.orders
    .filter((o) => o.branchId === branch.id && o.businessDate === date && (status === "all" || o.status === status) && (!q || o.orderNo.includes(q) || o.receiptNo?.includes(q) || o.items.some((i) => i.name.includes(q))))
    .sort((a, b) => b.openedAt.localeCompare(a.openedAt));
  const current = open ? db.orders.find((o) => o.id === open.id) ?? open : null;

  const doRefund = async () => {
    if (!current) return;
    const r = await exec((ds, approval) => ds.refundOrder(current.id, reason, restock, approval), {
      approval: { permission: "pos.refund", title: `คืนเงินบิล ${current.receiptNo} ${formatBaht(current.totals.total)}`, detail: `เหตุผล: ${reason}` },
      success: "คืนเงินแล้ว",
      successDetail: restock ? "คืนวัตถุดิบเข้าสต็อกให้แล้ว" : "บันทึกเป็นรายการคืนเงินของวันนี้",
    });
    if (r.ok) {
      setRefund(false);
      setReason("");
    }
  };

  return (
    <>
      <PageHeader title="บิลวันนี้" description={`${branch.name} · ทุกบิลของวันทำการนี้ แตะเพื่อดูรายละเอียด พิมพ์ซ้ำ หรือคืนเงิน`} actions={can("pos.order") && <LinkButton href="/pos">ไปหน้าขาย</LinkButton>} />
      <LoadBanner state={load} className="mb-4" />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Segmented
          label="สถานะบิล"
          value={status}
          onChange={setStatus}
          options={[
            { value: "all", label: "ทั้งหมด" },
            { value: "open", label: "ยังไม่ชำระ" },
            { value: "paid", label: "ชำระแล้ว" },
            { value: "refunded", label: "คืนเงิน" },
          ]}
        />
        <SearchInput value={q} onChange={setQ} placeholder="ค้นหาเลขบิลหรือเมนู" className="sm:ml-auto sm:w-72" />
      </div>
      <Card className="overflow-hidden">
        {orders.length === 0 ? (
          <EmptyState compact emoji="🧾" title={status === "all" ? "ยังไม่มีบิลวันนี้" : "ไม่มีบิลในสถานะนี้"} description="บิลใหม่จะขึ้นที่นี่ทันทีที่ขายจากหน้าขาย" />
        ) : (
          <ul className="divide-y divide-line">
            {orders.slice(0, 150).map((o, i) => {
              const ch = db.channels.find((c) => c.id === o.channelId);
              const CI = ch ? CHANNEL_ICON[ch.kind] : Utensils;
              const st = STATUS[o.status];
              return (
                <motion.li key={o.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(i * 0.01, 0.2) }}>
                  <button onClick={() => setOpen(o)} className="flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-surface-2">
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-surface-2 text-ink-2">
                      <CI className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-ink">
                        #{o.orderNo} <span className="font-normal text-ink-3">· {ch?.name}{o.tableId ? ` · โต๊ะ ${branch.tables.find((t) => t.id === o.tableId)?.name}` : ""}</span>
                      </span>
                      <span className="block truncate text-sm text-ink-3">{o.items.filter((i) => i.status !== "voided").map((i) => `${i.qty > 1 ? `${i.qty}× ` : ""}${i.name}`).join(", ")}</span>
                    </span>
                    <span className="hidden w-16 text-sm text-ink-3 sm:block">{new Date(o.openedAt).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}</span>
                    <Badge tone={st.tone} dot>
                      {st.label}
                    </Badge>
                    <span className="w-24 text-right font-semibold tabular text-ink">{formatBaht(o.totals.total)}</span>
                  </button>
                </motion.li>
              );
            })}
          </ul>
        )}
      </Card>

      <Dialog open={!!current && !refund} onOpenChange={(v) => !v && setOpen(null)} title={current ? `บิล #${current.orderNo}` : ""} description={current?.receiptNo ? `ใบเสร็จ ${current.receiptNo}` : "ยังไม่ออกใบเสร็จ"} size="md" footer={current && (
        <>
          <Button variant="secondary" icon={<Printer className="h-4 w-4" />} onClick={() => printReceipt(current.id, { copy: true })}>
            พิมพ์ซ้ำ
          </Button>
          {current.status === "paid" && (can("pos.refund") || can("pos.pay")) && (
            <Button variant="danger" icon={<RotateCcw className="h-4 w-4" />} onClick={() => setRefund(true)}>
              คืนเงิน
            </Button>
          )}
        </>
      )}>
        {current && (
          <div className="space-y-4 pb-2">
            <ul className="divide-y divide-line rounded-2xl border border-line">
              {current.items.map((i) => (
                <li key={i.id} className="flex items-start gap-3 p-3">
                  <span aria-hidden="true">{i.emoji}</span>
                  <span className="min-w-0 flex-1">
                    <span className={i.status === "voided" ? "text-ink-3 line-through" : "text-ink"}>
                      {i.qty > 1 && `${i.qty}× `}
                      {i.name}
                    </span>
                    {i.modifiers.length > 0 && <span className="block text-sm text-ink-3">{i.modifiers.map((m) => m.name).join(" · ")}</span>}
                    {i.voidReason && <span className="block text-sm text-danger">ยกเลิก: {i.voidReason}</span>}
                  </span>
                  <span className="tabular text-ink-2">{formatBaht(i.qty * (i.unitPrice + i.modifiers.reduce((s, m) => s + m.priceDelta, 0)))}</span>
                </li>
              ))}
            </ul>
            <dl className="space-y-1 text-sm">
              {current.totals.discountTotal > 0 && (
                <div className="flex justify-between text-success">
                  <dt>ส่วนลด ({current.discount?.reason})</dt>
                  <dd>-{formatBaht(current.totals.discountTotal)}</dd>
                </div>
              )}
              <div className="flex justify-between text-ink-3">
                <dt>VAT</dt>
                <dd>{formatBaht(current.totals.vatAmount)}</dd>
              </div>
              <div className="flex justify-between text-lg font-semibold text-ink">
                <dt>ยอดสุทธิ</dt>
                <dd>{formatBaht(current.totals.total)}</dd>
              </div>
            </dl>
            {current.payments.length > 0 && (
              <div className="rounded-2xl bg-surface-2 p-3 text-sm">
                {current.payments.map((p) => {
                  const m = db.paymentMethods.find((x) => x.id === p.methodId);
                  const MI = m ? METHOD_ICON[m.kind] : Banknote;
                  return (
                    <p key={p.id} className="flex items-center gap-2 py-0.5 text-ink-2">
                      <MI className="h-4 w-4" aria-hidden="true" />
                      {p.kind === "refund" ? "คืนเงิน " : ""}
                      {m?.name} {formatBaht(p.amount)}
                      {p.change > 0 && ` · ทอน ${formatBaht(p.change)}`}
                      {p.reference && ` · อ้างอิง ${p.reference}`}
                    </p>
                  );
                })}
              </div>
            )}
            <p className="text-xs text-ink-3">
              เปิดบิลโดย {actorName(db, current.openedBy)} เวลา {new Date(current.openedAt).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })} น.
            </p>
          </div>
        )}
      </Dialog>

      <Dialog open={refund} onOpenChange={setRefund} title="คืนเงินทั้งบิล?" description={current ? `${current.receiptNo} · ${formatBaht(current.totals.total)}` : ""} size="sm" footer={
        <>
          <Button variant="ghost" onClick={() => setRefund(false)}>
            ยกเลิก
          </Button>
          <Button variant="danger" loading={pending} disabled={!reason.trim()} onClick={doRefund}>
            ยืนยันคืนเงิน
          </Button>
        </>
      }>
        <div className="space-y-4 pb-2">
          <div className="flex flex-wrap gap-2">
            {["อาหารไม่ได้มาตรฐาน", "ลูกค้าได้รับของผิด", "รอนานเกินไป", "คิดเงินผิด"].map((r) => (
              <button key={r} onClick={() => setReason(r)} aria-pressed={reason === r} className={reason === r ? "h-11 rounded-2xl border border-brand bg-brand-soft px-4 text-brand-soft-ink" : "h-11 rounded-2xl border border-line px-4 text-ink-2 hover:border-line-strong"}>
                {r}
              </button>
            ))}
          </div>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เหตุผล" aria-label="เหตุผล" />
          <Switch checked={restock} onCheckedChange={setRestock} label="คืนวัตถุดิบเข้าสต็อก" description="เปิดเฉพาะถ้ายังไม่ได้ทำอาหาร (เช่น คิดเงินผิด)" />
          <p className="text-sm text-ink-3">การคืนเงินต้องให้ผู้จัดการอนุมัติด้วย PIN — บันทึกไว้ให้เจ้าของร้านตรวจย้อนหลังได้</p>
        </div>
      </Dialog>
    </>
  );
}

export default function OrdersPage() {
  return (
    <Suspense>
      <OrdersInner />
    </Suspense>
  );
}
