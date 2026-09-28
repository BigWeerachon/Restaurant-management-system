"use client";

import { parsePromptPayId } from "@sabai/domain";
import { ArrowLeft, Banknote, Bike, Check, CreditCard, QrCode } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { PageHeader } from "@/components/app/page-header";
import { PromptPayQr } from "@/components/app/promptpay-qr";
import { Button } from "@/components/ui/button";
import { Badge, Card, Field, Input } from "@/components/ui/primitives";
import { useAction } from "@/hooks/use-sabai";
import { cn } from "@/lib/cn";
import { confirmCashOnly, updateChannel, updatePaymentMethod } from "@/lib/demo/engine";
import { useSabai } from "@/lib/demo/store";

function Choice({ icon, title, detail, on, onToggle, locked, children }: { icon: ReactNode; title: string; detail: string; on: boolean; onToggle?: () => void; locked?: boolean; children?: ReactNode }) {
  return (
    <Card className={cn("overflow-hidden transition-shadow", on && "ring-2 ring-brand")}>
      <button type="button" role="switch" aria-checked={on} disabled={locked} onClick={onToggle} className="flex w-full items-center gap-4 p-4 text-left disabled:cursor-default">
        <span className={cn("grid h-12 w-12 shrink-0 place-items-center rounded-2xl", on ? "bg-brand-soft text-brand" : "bg-surface-2 text-ink-3")}>{icon}</span>
        <span className="flex-1">
          <span className="block font-semibold text-ink">{title}</span>
          <span className="block text-sm text-ink-3">{detail}</span>
        </span>
        {locked ? (
          <Badge>เปิดเสมอ</Badge>
        ) : (
          <span className={cn("grid h-7 w-7 place-items-center rounded-full border-2", on ? "border-brand bg-brand text-brand-ink" : "border-line-strong")} aria-hidden="true">
            {on && <Check className="h-4 w-4" strokeWidth={3} />}
          </span>
        )}
      </button>
      <AnimatePresence initial={false}>
        {on && children && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="border-t border-line p-4">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}

/** How the shop gets paid — sensible defaults, one screen, one save. */
export default function SetupPaymentsPage() {
  const db = useSabai((s) => s.db);
  const router = useRouter();
  const { exec, pending } = useAction();
  const pp = db.paymentMethods.find((m) => m.kind === "promptpay");
  const card = db.paymentMethods.find((m) => m.kind === "card");
  const platforms = db.channels.filter((c) => c.kind === "delivery_platform");
  const [usePp, setUsePp] = useState(pp?.active ?? true);
  const [ppId, setPpId] = useState(pp?.promptpayId ?? "");
  const [useCard, setUseCard] = useState(card?.active ?? false);
  const [chan, setChan] = useState<Record<string, boolean>>(() => Object.fromEntries(platforms.map((c) => [c.id, c.active])));
  const [error, setError] = useState("");
  const ppValid = !!parsePromptPayId(ppId);

  const save = async () => {
    if (usePp && !ppValid) return setError("ใส่เบอร์มือถือ 10 หลัก หรือเลขผู้เสียภาษี 13 หลักที่ผูกพร้อมเพย์ไว้");
    setError("");
    const r = await exec(
      (d, c) => {
        if (pp) updatePaymentMethod(d, c, pp.id, usePp ? { promptpayId: ppId, active: true } : { active: false });
        if (card) updatePaymentMethod(d, c, card.id, { active: useCard });
        for (const ch of platforms) if (ch.active !== chan[ch.id]) updateChannel(d, c, ch.id, { active: !!chan[ch.id] });
        if (!usePp && !useCard) confirmCashOnly(d, c);
      },
      { success: "ตั้งค่าการรับเงินเรียบร้อย", successDetail: usePp ? "หน้าขายจะสร้าง QR ตามยอดบิลให้อัตโนมัติ" : undefined },
    );
    if (r.ok) router.push("/setup");
  };

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader eyebrow={<Link href="/setup" className="inline-flex items-center gap-1 hover:text-ink"><ArrowLeft className="h-4 w-4" /> เริ่มต้นใช้งาน</Link>} title="ลูกค้าจ่ายเงินด้วยอะไรบ้าง" description="เลือกที่ร้านรับจริง เปลี่ยนภายหลังได้ในหน้าตั้งค่า" />
      <div className="space-y-3">
        <Choice icon={<Banknote className="h-6 w-6" />} title="เงินสด" detail="นับเงินตอนปิดกะ ระบบบอกยอดที่ควรมีในลิ้นชัก" on locked />
        <Choice icon={<QrCode className="h-6 w-6" />} title="พร้อมเพย์ / QR" detail="ไม่มีค่าธรรมเนียม เงินเข้าทันที — ยอดล็อกตามบิล" on={usePp} onToggle={() => setUsePp(!usePp)}>
          <div className="grid items-center gap-4 sm:grid-cols-[1fr_12rem]">
            <Field label="หมายเลขพร้อมเพย์ของร้าน" required error={error} hint={ppValid ? "✓ ใช้ได้ — ดูตัวอย่าง QR ด้านข้าง" : "เบอร์มือถือ หรือเลขผู้เสียภาษี 13 หลัก"} htmlFor="pp">
              <Input id="pp" inputMode="numeric" autoFocus value={ppId} invalid={!!error} onChange={(e) => setPpId(e.target.value)} placeholder="08x-xxx-xxxx" />
            </Field>
            {ppValid ? <PromptPayQr id={ppId} amount={145} className="w-44" /> : <div className="hidden h-44 place-items-center rounded-3xl border border-dashed border-line-strong text-center text-xs text-ink-3 sm:grid">ตัวอย่าง QR<br />จะขึ้นที่นี่</div>}
          </div>
        </Choice>
        <Choice icon={<CreditCard className="h-6 w-6" />} title="บัตรเครดิต / เดบิต" detail={`ผ่านเครื่อง EDC · ค่าธรรมเนียม ${((card?.feeRate ?? 0.02) * 100).toFixed(1)}% หักอัตโนมัติในรายงานกำไร`} on={useCard} onToggle={() => setUseCard(!useCard)} />
        <p className="pt-3 text-sm font-semibold text-ink-3">ขายผ่านแอปเดลิเวอรีไหม</p>
        {platforms.map((c) => (
          <Choice key={c.id} icon={<Bike className="h-6 w-6" />} title={c.name} detail={`GP เริ่มต้น ${Math.round(c.commissionRate * 100)}% (แก้ได้) · เงินเข้าทุก ${c.settlementDays} วัน`} on={!!chan[c.id]} onToggle={() => setChan({ ...chan, [c.id]: !chan[c.id] })} />
        ))}
      </div>
      <div className="sticky bottom-20 mt-6 lg:bottom-4">
        <Button block size="lg" loading={pending} icon={<Check className="h-5 w-5" />} onClick={save} className="shadow-lg">
          {!usePp && !useCard ? "ร้านรับเงินสดอย่างเดียว — บันทึก" : "บันทึกและไปขั้นต่อไป"}
        </Button>
      </div>
    </div>
  );
}
