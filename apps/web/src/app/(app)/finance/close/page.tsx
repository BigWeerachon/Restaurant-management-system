"use client";

import { formatThaiDate } from "@sabai/domain";
import { ArrowLeft, ArrowRight, CheckCircle2, Moon, Sparkles } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useState } from "react";
import { LoadBanner } from "@/components/app/load-banner";
import { PageHeader } from "@/components/app/page-header";
import { CloseShiftDialog } from "@/components/pos/pos-dialogs";
import { Button, LinkButton } from "@/components/ui/button";
import { AnimatedNumber, Stepper, SuccessCheck } from "@/components/ui/feedback";
import { Callout, Card } from "@/components/ui/primitives";
import { useDsAction, useLoad } from "@/hooks/use-data-source";
import { useAccess, useBusinessDate } from "@/hooks/use-sabai";
import { openShiftOf } from "@/lib/demo/engine";
import { formatBaht } from "@/lib/demo/selectors";
import { useSabai } from "@/lib/demo/store";
import type { DayClose } from "@/lib/demo/types";

/** Close the day in three checks — no accounting knowledge needed. */
export default function CloseDayPage() {
  const db = useSabai((s) => s.db);
  const { branch, can } = useAccess();
  const date = useBusinessDate();
  const { exec, pending } = useDsAction();
  const load = useLoad(["orders", "shifts", "finance"]);
  const [step, setStep] = useState(0);
  const [shiftOpen, setShiftOpen] = useState(false);
  const [summary, setSummary] = useState<DayClose["summary"] | null>(null);

  const openOrders = db.orders.filter((o) => o.branchId === branch.id && o.businessDate === date && o.status === "open");
  const shift = openShiftOf(db, branch.id);
  const paid = db.orders.filter((o) => o.branchId === branch.id && o.businessDate === date && o.status === "paid");
  const total = paid.reduce((s, o) => s + o.totals.total, 0);

  if (!can("finance.close_day")) return <Callout tone="info">ปิดยอดได้เฉพาะผู้จัดการหรือฝ่ายบัญชี</Callout>;

  if (summary) {
    return (
      <div className="mx-auto max-w-xl">
        <Card className="flex flex-col items-center gap-3 p-8 text-center">
          <SuccessCheck />
          <h1 className="text-2xl font-bold text-ink">ปิดยอดเรียบร้อย</h1>
          <p className="text-ink-3">{formatThaiDate(date)} · {branch.name}</p>
          <p className="text-4xl font-bold tabular text-ink">
            <AnimatedNumber value={summary.total} format={(v) => formatBaht(v)} />
          </p>
          <p className="text-ink-3">
            {summary.orders} บิล · เงินสด{summary.cashVariance === 0 ? "ตรงพอดี" : summary.cashVariance < 0 ? `ขาด ${formatBaht(-summary.cashVariance)}` : `เกิน ${formatBaht(summary.cashVariance)}`}
          </p>
          <Callout tone="success" className="w-full text-left" title="ระบบทำให้แล้ว">
            ลงบัญชียอดขาย ต้นทุน ของเสีย และเงินสด · สร้างรายการเงินที่ต้องเข้าธนาคาร (บัตร/แพลตฟอร์ม) · ล็อกวันนี้ไม่ให้แก้ย้อนหลัง
          </Callout>
          <div className="mt-2 flex gap-2">
            <LinkButton href="/reports">ดูเงินเหลือจริง</LinkButton>
            <LinkButton href="/today" variant="secondary">
              กลับหน้าแรก
            </LinkButton>
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-sm text-ink-3">
            <Sparkles className="h-4 w-4 text-accent" aria-hidden="true" /> ขอบคุณสำหรับวันนี้ พักผ่อนให้เต็มที่นะ
          </p>
        </Card>
      </div>
    );
  }

  const checks = [
    { ok: openOrders.length === 0, title: "ไม่มีบิลค้าง", fail: `มีบิลที่ยังไม่ชำระ ${openOrders.length} บิล`, action: <LinkButton href="/pos" size="sm" variant="secondary">ไปเก็บเงิน/ยกเลิก</LinkButton> },
    { ok: !shift, title: "ปิดกะและนับเงินสดแล้ว", fail: "กะยังเปิดอยู่ — นับเงินสดในลิ้นชักก่อน", action: <Button size="sm" variant="secondary" onClick={() => setShiftOpen(true)}>ปิดกะ</Button> },
  ];

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader eyebrow={<Link href="/finance" className="inline-flex items-center gap-1 hover:text-ink"><ArrowLeft className="h-4 w-4" /> การเงิน</Link>} title="ปิดยอดประจำวัน" description={`${formatThaiDate(date)} · ${branch.name} — ตรวจ 2 อย่าง แล้วกดปิดยอด ระบบลงบัญชีให้ทั้งหมด`} />
      <LoadBanner state={load} className="mb-4" />
      <Stepper steps={["ตรวจความพร้อม", "สรุปยอด"]} current={step} className="mb-6" />
      <AnimatePresence mode="wait">
        {step === 0 ? (
          <motion.div key="0" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-3">
            {checks.map((c) => (
              <Card key={c.title} className="flex items-center gap-4 p-4">
                <motion.span initial={{ scale: 0.6 }} animate={{ scale: 1 }} className={c.ok ? "grid h-11 w-11 place-items-center rounded-full bg-success-soft text-success" : "grid h-11 w-11 place-items-center rounded-full bg-warning-soft text-warning"}>
                  {c.ok ? <CheckCircle2 className="h-6 w-6" aria-hidden="true" /> : <span className="text-lg font-bold">!</span>}
                </motion.span>
                <div className="flex-1">
                  <p className="font-semibold text-ink">{c.ok ? c.title : c.fail}</p>
                  {c.ok && <p className="text-sm text-ink-3">เรียบร้อย</p>}
                </div>
                {!c.ok && c.action}
              </Card>
            ))}
            <div className="flex justify-end pt-2">
              <Button size="lg" disabled={checks.some((c) => !c.ok)} onClick={() => setStep(1)} iconRight={<ArrowRight className="h-4 w-4" />}>
                ต่อไป
              </Button>
            </div>
          </motion.div>
        ) : (
          <motion.div key="1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
            <Card className="p-5">
              <p className="text-sm text-ink-3">ยอดขายวันนี้</p>
              <p className="text-4xl font-bold tabular text-ink">{formatBaht(total)}</p>
              <p className="text-sm text-ink-3">{paid.length} บิล</p>
            </Card>
            <Callout tone="info" title="หลังปิดยอด">
              แก้รายการของวันนี้ไม่ได้ (เพื่อให้บัญชีถูกต้อง) รายการใหม่จะไปอยู่ในวันถัดไปให้เอง ถ้าจำเป็นต้องแก้ ผู้จัดการเปิดยอดวันนี้อีกครั้งได้ โดยต้องใส่เหตุผล
            </Callout>
            <div className="flex justify-between pt-2">
              <Button variant="ghost" onClick={() => setStep(0)} icon={<ArrowLeft className="h-4 w-4" />}>
                ย้อนกลับ
              </Button>
              <Button
                size="lg"
                loading={pending}
                icon={<Moon className="h-5 w-5" />}
                onClick={async () => {
                  const r = await exec((ds) => ds.closeDay(date));
                  if (r.ok) setSummary(r.value);
                }}
              >
                ปิดยอดวันนี้
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <CloseShiftDialog open={shiftOpen} onClose={() => setShiftOpen(false)} />
    </div>
  );
}
