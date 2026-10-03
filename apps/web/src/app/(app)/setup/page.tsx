"use client";

import type { StepKey } from "@sabai/domain";
import { ArrowRight, Check, Clock, PartyPopper } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { LoadBanner } from "@/components/app/load-banner";
import { PageHeader } from "@/components/app/page-header";
import { Button, LinkButton } from "@/components/ui/button";
import { ProgressRing } from "@/components/ui/feedback";
import { Badge, Card } from "@/components/ui/primitives";
import { useDsAction, useLoad } from "@/hooks/use-data-source";
import { useAccess } from "@/hooks/use-sabai";
import { cn } from "@/lib/cn";
import { onboarding } from "@/lib/demo/selectors";
import { useSabai } from "@/lib/demo/store";

const EMOJI: Record<StepKey, string> = { branch: "🏪", payments: "💳", ingredient: "🥚", menu: "🍜", recipe: "📋", staff: "👥", first_sale: "🎉" };

/** First-run checklist. Progress comes from real data, never from ticked boxes. */
export default function SetupPage() {
  const db = useSabai((s) => s.db);
  const { can } = useAccess();
  const { exec } = useDsAction();
  const load = useLoad(["onboarding"]);
  const p = onboarding(db);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="เริ่มต้นใช้งาน" description="ทำตามทีละขั้น ส่วนใหญ่ใช้เวลาไม่ถึง 2 นาที — ข้ามขั้นที่ไม่จำเป็นได้ และกลับมาทำต่อเมื่อไรก็ได้" />
      <LoadBanner state={load} className="mb-4" />
      <Card className="mb-6 flex items-center gap-5 overflow-hidden bg-grain p-5 sm:p-6">
        <ProgressRing value={p.percent} size={96} stroke={9} label="ความคืบหน้าการตั้งค่าร้าน">
          <span className="text-xl font-bold text-ink">{p.percent}%</span>
        </ProgressRing>
        <div>
          {p.isComplete ? (
            <>
              <p className="flex items-center gap-2 text-xl font-semibold text-ink">
                <PartyPopper className="h-6 w-6 text-accent" aria-hidden="true" /> ร้านพร้อมแล้ว!
              </p>
              <p className="mt-1 text-ink-2">ต่อจากนี้ระบบจะดูแลสต็อก ต้นทุน และตัวเลขให้เองทุกครั้งที่ขาย</p>
              <LinkButton href="/today" className="mt-3" iconRight={<ArrowRight className="h-4 w-4" />}>
                ไปหน้าวันนี้
              </LinkButton>
            </>
          ) : (
            <>
              <p className="text-sm text-ink-3">
                เสร็จแล้ว {p.completed} จาก {p.total} ขั้น
              </p>
              <p className="mt-0.5 text-xl font-semibold text-ink">เหลืออีกประมาณ {p.minutesLeft} นาที</p>
              <p className="mt-1 text-sm text-ink-2">ความคืบหน้านับจากข้อมูลจริง เช่น เพิ่มวัตถุดิบจากหน้าไหนก็ได้ ขั้นนั้นจะเสร็จเอง</p>
            </>
          )}
        </div>
      </Card>

      <ol className="space-y-3">
        {p.steps.map((s, i) => {
          const isNext = p.next?.key === s.key;
          const done = s.status === "done";
          return (
            <motion.li key={s.key} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
              <Card className={cn("flex flex-wrap items-center gap-4 p-4 sm:flex-nowrap", isNext && "ring-2 ring-brand", s.status !== "todo" && "bg-surface-2/60")}>
                <span className={cn("grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-2xl", done ? "bg-success-soft" : "bg-surface-2")} aria-hidden="true">
                  {done ? (
                    <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 500, damping: 18 }}>
                      <Check className="h-6 w-6 text-success" strokeWidth={3} />
                    </motion.span>
                  ) : (
                    EMOJI[s.key]
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={cn("font-semibold", done ? "text-ink-3 line-through decoration-ink-3/40" : "text-ink")}>
                    <span className="sr-only">{done ? "เสร็จแล้ว: " : s.status === "skipped" ? "ข้ามแล้ว: " : ""}</span>
                    {s.title}
                    {s.optional && s.status === "todo" && (
                      <Badge className="ml-2 align-middle" tone="neutral">
                        ไม่บังคับ
                      </Badge>
                    )}
                  </p>
                  {s.status === "todo" && <p className="mt-0.5 text-sm text-ink-3">{s.why}</p>}
                  {s.status === "skipped" && <p className="text-sm text-ink-3">ข้ามไว้ก่อน — ทำได้ทุกเมื่อ</p>}
                </div>
                {s.status !== "done" && (
                  <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto">
                    <span className="mr-auto flex items-center gap-1 text-xs text-ink-3 sm:mr-1">
                      <Clock className="h-3.5 w-3.5" aria-hidden="true" /> {s.minutes} นาที
                    </span>
                    {s.optional && s.status === "todo" && can("settings.manage") && (
                      <Button variant="ghost" size="sm" onClick={() => exec((ds) => ds.skipOnboardingStep(s.key), { success: "ข้ามไว้ก่อน", successDetail: "กลับมาทำได้จากหน้านี้" })}>
                        ข้าม
                      </Button>
                    )}
                    <LinkButton href={s.href} size="sm" variant={isNext ? "primary" : "secondary"}>
                      {s.cta}
                    </LinkButton>
                  </div>
                )}
              </Card>
            </motion.li>
          );
        })}
      </ol>
      <p className="mt-6 text-center text-sm text-ink-3">
        อยากลองก่อน? <Link href="/" className="font-medium text-brand underline-offset-4 hover:underline">เปิดร้านตัวอย่าง</Link> ที่มีข้อมูล 30 วันให้ลองกดได้ทุกอย่าง
      </p>
    </div>
  );
}
