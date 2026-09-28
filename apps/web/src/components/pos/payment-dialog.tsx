"use client";

import { changeDue, parsePromptPayId, promptPayPayload, suggestTenders, type Satang } from "@sabai/domain";
import { Banknote, Bike, CreditCard, Printer, QrCode, Receipt } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import QRCode from "qrcode";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { AnimatedNumber, Keypad, SuccessCheck } from "@/components/ui/feedback";
import { Dialog } from "@/components/ui/overlay";
import { Callout } from "@/components/ui/primitives";
import { useAction } from "@/hooks/use-sabai";
import { cn } from "@/lib/cn";
import { payOrder } from "@/lib/demo/engine";
import { formatBaht } from "@/lib/demo/selectors";
import { useSabai } from "@/lib/demo/store";
import type { Order, PaymentMethod } from "@/lib/demo/types";

const ICON: Record<string, typeof Banknote> = { cash: Banknote, promptpay: QrCode, card: CreditCard, platform: Bike, ewallet: CreditCard };

function PromptPayQr({ id, amount }: { id: string; amount: number }) {
  const [svg, setSvg] = useState<string>("");
  useEffect(() => {
    const target = parsePromptPayId(id);
    if (!target) return;
    QRCode.toString(promptPayPayload(target, amount), { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#1c1b19", light: "#ffffff" } }).then(setSvg);
  }, [id, amount]);
  return (
    <div className="mx-auto w-56 rounded-3xl bg-white p-3 shadow-md ring-1 ring-line">
      <div className="mb-2 flex items-center justify-center gap-1.5 rounded-xl bg-[#113566] py-1.5 text-xs font-semibold text-white">THAI QR PAYMENT · PromptPay</div>
      {svg ? <div className="aspect-square" dangerouslySetInnerHTML={{ __html: svg }} aria-label={`QR พร้อมเพย์ ยอด ${amount.toFixed(2)} บาท`} role="img" /> : <div className="skeleton aspect-square rounded-xl" />}
    </div>
  );
}

export function PaymentDialog({ order, open, onClose, onPaid }: { order: Order | null; open: boolean; onClose: () => void; onPaid: (o: Order) => void }) {
  const db = useSabai((s) => s.db);
  const { exec, pending } = useAction();
  const channel = db.channels.find((c) => c.id === order?.channelId);
  const methods = useMemo(
    () =>
      db.paymentMethods.filter((m) => m.active && (channel?.kind === "delivery_platform" ? m.kind === "platform" : m.kind !== "platform")),
    [db.paymentMethods, channel],
  );
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [tendered, setTendered] = useState<string>("");
  const [reference, setReference] = useState("");
  const [done, setDone] = useState<Order | null>(null);
  const total = order?.totals.total ?? 0;

  useEffect(() => {
    if (open) {
      setMethod(methods[0] ?? null);
      setTendered("");
      setReference("");
      setDone(null);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const tenderedSatang: Satang = tendered ? Math.round(Number(tendered) * 100) : total;
  const change = changeDue(total, tenderedSatang);
  const short = method?.kind === "cash" && tenderedSatang < total;

  const pay = async () => {
    if (!order || !method) return;
    const res = await exec(
      (d, c) =>
        payOrder(d, c, order.id, [
          {
            methodId: method.id,
            amount: total,
            tendered: method.kind === "cash" ? tenderedSatang : undefined,
            reference: reference || undefined,
          },
        ]),
      { latencyMs: 350 },
    );
    if (res.ok) {
      setDone(res.value);
      onPaid(res.value);
    }
  };

  const tenders = suggestTenders(total);
  const lastPayment = done?.payments.at(-1);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={done ? "รับเงินเรียบร้อย" : "รับชำระเงิน"} description={done ? undefined : `บิล #${order?.orderNo ?? ""} · ${channel?.name ?? ""}`} size="lg" hideClose={!!done}>
      <AnimatePresence mode="wait">
        {done ? (
          <motion.div key="done" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center gap-3 py-4 text-center">
            <SuccessCheck />
            {lastPayment && lastPayment.change > 0 ? (
              <>
                <p className="text-sm font-medium text-ink-3">ทอนเงินลูกค้า</p>
                <p className="text-5xl font-bold tracking-tight text-ink">
                  <AnimatedNumber value={lastPayment.change} format={(v) => formatBaht(v)} />
                </p>
                <p className="text-sm text-ink-3">
                  รับมา {formatBaht(lastPayment.tendered ?? 0)} · ยอด {formatBaht(done.totals.total)}
                </p>
              </>
            ) : (
              <p className="text-3xl font-bold text-ink">{formatBaht(done.totals.total)}</p>
            )}
            <p className="flex items-center gap-1.5 text-sm text-ink-3">
              <Receipt className="h-4 w-4" aria-hidden="true" /> ใบเสร็จ {done.receiptNo} · ตัดสต็อกให้อัตโนมัติแล้ว
            </p>
            <div className="mt-3 flex w-full flex-col gap-2 sm:flex-row">
              <Button variant="secondary" size="lg" className="flex-1" icon={<Printer className="h-5 w-5" />} onClick={() => window.print()}>
                พิมพ์ใบเสร็จ
              </Button>
              <Button size="lg" className="flex-1" autoFocus onClick={onClose}>
                บิลถัดไป
              </Button>
            </div>
          </motion.div>
        ) : (
          <motion.div key="pay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid gap-5 pb-2 md:grid-cols-[1fr_1.1fr]">
            <div className="space-y-4">
              <div className="rounded-3xl bg-surface-2 p-5 text-center">
                <p className="text-sm font-medium text-ink-3">ยอดที่ต้องชำระ</p>
                <p className="mt-1 text-5xl font-bold tracking-tight text-ink">{formatBaht(total)}</p>
                {order && order.totals.vatAmount > 0 && <p className="mt-1 text-xs text-ink-3">รวม VAT {formatBaht(order.totals.vatAmount)}</p>}
              </div>
              <div role="radiogroup" aria-label="วิธีชำระเงิน" className="grid grid-cols-3 gap-2">
                {methods.map((m) => {
                  const Ico = ICON[m.kind] ?? Banknote;
                  const on = method?.id === m.id;
                  return (
                    <motion.button
                      key={m.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      whileTap={{ scale: 0.96 }}
                      onClick={() => setMethod(m)}
                      className={cn("flex h-20 flex-col items-center justify-center gap-1.5 rounded-2xl border-2 text-sm font-semibold transition-colors", on ? "border-brand bg-brand-soft text-brand-soft-ink" : "border-line bg-surface text-ink-2 hover:border-line-strong")}
                    >
                      <Ico className="h-6 w-6" aria-hidden="true" />
                      {m.kind === "platform" ? `ชำระผ่าน ${channel?.short ?? "แพลตฟอร์ม"}` : m.name.replace(/\s*\(.*\)/, "")}
                    </motion.button>
                  );
                })}
              </div>
              {methods.length === 1 && methods[0]?.kind === "cash" && (
                <Callout tone="info">เปิดรับพร้อมเพย์หรือบัตรได้ที่ ตั้งค่า → การรับเงิน</Callout>
              )}
            </div>

            <div className="space-y-4">
              {method?.kind === "cash" && (
                <>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-2">
                    {tenders.map((t) => (
                      <motion.button
                        key={t}
                        type="button"
                        whileTap={{ scale: 0.95 }}
                        onClick={() => setTendered(String(t / 100))}
                        className={cn("h-14 rounded-2xl border-2 text-lg font-semibold tabular transition-colors", tenderedSatang === t && tendered ? "border-brand bg-brand-soft text-brand-soft-ink" : "border-line bg-surface text-ink hover:border-line-strong")}
                      >
                        {t === total ? "พอดี" : formatBaht(t, { compact: true })}
                      </motion.button>
                    ))}
                  </div>
                  <div className="flex items-baseline justify-between rounded-2xl border border-line px-4 py-3">
                    <span className="text-sm text-ink-3">รับเงินมา</span>
                    <span className="text-2xl font-semibold tabular text-ink">{formatBaht(tenderedSatang)}</span>
                  </div>
                  <Keypad
                    decimal
                    onKey={(k) => setTendered((v) => (v.length >= 7 || (k === "." && v.includes(".")) ? v : v + k))}
                    onBackspace={() => setTendered((v) => v.slice(0, -1))}
                  />
                  <div className={cn("flex items-baseline justify-between rounded-2xl px-4 py-3", short ? "bg-danger-soft" : "bg-success-soft")} aria-live="polite">
                    <span className={cn("text-sm font-medium", short ? "text-danger" : "text-success")}>{short ? "รับเงินยังไม่พอ" : "เงินทอน"}</span>
                    <span className={cn("text-3xl font-bold tabular", short ? "text-danger" : "text-success")}>{short ? formatBaht(total - tenderedSatang) : formatBaht(change)}</span>
                  </div>
                </>
              )}
              {method?.kind === "promptpay" && (
                <div className="space-y-3 text-center">
                  <PromptPayQr id={method.promptpayId ?? "0812345678"} amount={total / 100} />
                  <p className="text-sm text-ink-2">ให้ลูกค้าสแกน QR ยอดจะขึ้นตรงบิลอัตโนมัติ ไม่ต้องพิมพ์ยอดเอง</p>
                  <p className="text-xs text-ink-3">ตรวจว่ามีเงินเข้าแล้วค่อยกดยืนยัน ระบบจะกระทบยอดกับบัญชีธนาคารให้ภายหลัง</p>
                </div>
              )}
              {method?.kind === "card" && (
                <div className="space-y-3">
                  <Callout tone="info" title="รูดหรือแตะบัตรที่เครื่อง EDC">
                    ใส่เลข 4 ตัวท้ายของสลิปเพื่อกระทบยอดกับธนาคาร (ค่าธรรมเนียม {(method.feeRate * 100).toFixed(1)}% คำนวณให้อัตโนมัติ)
                  </Callout>
                  <div className="flex items-baseline justify-between rounded-2xl border border-line px-4 py-3">
                    <span className="text-sm text-ink-3">เลขอ้างอิง</span>
                    <span className="text-2xl font-semibold tracking-[0.3em] tabular text-ink">{reference.padEnd(4, "•")}</span>
                  </div>
                  <Keypad onKey={(k) => setReference((v) => (v.length >= 4 ? v : v + k))} onBackspace={() => setReference((v) => v.slice(0, -1))} onClear={() => setReference("")} />
                </div>
              )}
              {method?.kind === "platform" && (
                <Callout tone="info" title={`ลูกค้าจ่ายผ่าน ${channel?.name} แล้ว`}>
                  ระบบจะบันทึกค่า GP {((order?.commissionRate ?? 0) * 100).toFixed(0)}% และรอเงินโอนจากแพลตฟอร์มในหน้า การเงิน → เงินที่ต้องเข้า
                </Callout>
              )}
              <Button size="xl" block loading={pending} disabled={!method || short || (method.requiresReference && reference.length < 4)} onClick={pay}>
                {method?.kind === "cash" ? `รับเงิน ${formatBaht(tenderedSatang)}${change > 0 ? ` · ทอน ${formatBaht(change)}` : ""}` : method?.kind === "promptpay" ? "ลูกค้าโอนแล้ว" : "ยืนยันการชำระ"}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Dialog>
  );
}
