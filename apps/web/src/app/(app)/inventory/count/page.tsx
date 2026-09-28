"use client";

import { formatQty, summarizeCount, toBase } from "@sabai/domain";
import { ArrowLeft, ArrowRight, CheckCircle2, ClipboardCheck, EyeOff, SkipForward } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/app/page-header";
import { Button, LinkButton } from "@/components/ui/button";
import { EmptyState, Keypad, ProgressBar } from "@/components/ui/feedback";
import { Badge, Callout, Card, Segmented } from "@/components/ui/primitives";
import { useAccess, useAction } from "@/hooks/use-sabai";
import { cn } from "@/lib/cn";
import { approveCount, recordCount, startCount, submitCount } from "@/lib/demo/engine";
import { formatBaht } from "@/lib/demo/selectors";
import { useSabai } from "@/lib/demo/store";

/**
 * Blind count, shelf by shelf: one item at a time, big keypad, no expected
 * numbers on screen (people count what they see, not what the system hopes).
 */
export default function CountPage() {
  const db = useSabai((s) => s.db);
  const { branch, can } = useAccess();
  const { exec, pending } = useAction();
  const count = db.counts.find((c) => c.branchId === branch.id && c.status !== "approved");
  const [idx, setIdx] = useState(0);
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState<string>("");

  const lines = count?.lines ?? [];
  const line = lines[idx];
  const ing = line ? db.ingredients.find((i) => i.id === line.ingredientId) : undefined;
  const counted = lines.filter((l) => l.counted !== null).length;

  useEffect(() => {
    if (!ing || !line) return;
    const big = ing.displayUnit && ["kg", "l"].includes(ing.displayUnit) ? ing.displayUnit : ing.baseUnit;
    setUnit(big);
    setValue(line.counted === null ? "" : String(big === ing.baseUnit ? line.counted : line.counted / 1000));
  }, [idx, ing?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const summary = useMemo(
    () =>
      count?.status === "submitted"
        ? summarizeCount(count.lines.map((l) => ({ ingredientId: l.ingredientId, name: db.ingredients.find((i) => i.id === l.ingredientId)?.name ?? "", expected: l.expected ?? 0, counted: l.counted, unitCost: l.unitCost ?? 0 })))
        : null,
    [count, db.ingredients],
  );

  if (!can("inventory.count")) return <EmptyState emoji="🔒" title="ตำแหน่งนี้ยังนับสต็อกไม่ได้" description="ขอให้ผู้จัดการเพิ่มสิทธิ์ “นับสต็อก”" />;

  const save = async (advance: boolean, skip = false) => {
    if (!count || !line || !ing) return;
    const qty = skip || value === "" ? null : toBase(Number(value), unit);
    const r = await exec((d, c) => recordCount(d, c, count.id, line.ingredientId, qty));
    if (r.ok && advance) {
      setIdx((i) => Math.min(i + 1, lines.length - 1));
    }
  };

  if (!count) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader eyebrow={<Link href="/inventory" className="inline-flex items-center gap-1 hover:text-ink"><ArrowLeft className="h-4 w-4" /> สต็อก</Link>} title="นับสต็อก" />
        <Card>
          <EmptyState
            emoji="📋"
            title="พร้อมนับสต็อกหรือยัง?"
            description="ระบบจะเรียงรายการตามชั้นวาง นับทีละรายการ ไม่ต้องจดใส่กระดาษ ถ้าพักกลางทางก็กลับมานับต่อได้"
            action={
              <Button size="lg" icon={<ClipboardCheck className="h-5 w-5" />} loading={pending} onClick={() => exec((d, c) => startCount(d, c))}>
                เริ่มนับ ({db.ingredients.filter((i) => i.trackStock).length} รายการ)
              </Button>
            }
          />
          <div className="px-6 pb-6">
            <Callout tone="info" title="ทำไมไม่เห็นยอดในระบบ?">
              เพื่อให้ได้ตัวเลขจริง ผู้นับจะไม่เห็นยอดที่ระบบคาดไว้ (Blind count) ผู้จัดการจะเห็นส่วนต่างหลังส่งผล
            </Callout>
          </div>
        </Card>
      </div>
    );
  }

  if (count.status === "submitted") {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title={`ผลการนับ ${count.countNo}`} description="ส่วนต่าง = ที่นับได้ − ที่ระบบคาด (ขาย รับของ ของเสีย ที่บันทึกไว้)" />
        {summary && (
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <Card className="p-4">
              <p className="text-sm text-ink-3">นับแล้ว</p>
              <p className="text-2xl font-bold text-ink">{summary.counted} รายการ</p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-ink-3">ยังไม่นับ (ไม่ปรับยอด)</p>
              <p className="text-2xl font-bold text-ink">{summary.uncounted} รายการ</p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-ink-3">มูลค่าส่วนต่าง</p>
              <p className={cn("text-2xl font-bold", summary.varianceValue < 0 ? "text-danger" : "text-success")}>{formatBaht(Math.round(summary.varianceValue * 100), { sign: true })}</p>
            </Card>
          </div>
        )}
        {summary && summary.biggestLosses.length > 0 && (
          <Card className="mb-4 p-4">
            <p className="mb-2 font-semibold text-ink">หายมากที่สุด — ควรตรวจก่อน</p>
            <ul className="divide-y divide-line">
              {summary.biggestLosses.map((l) => {
                const i = db.ingredients.find((x) => x.id === l.ingredientId)!;
                return (
                  <li key={l.ingredientId} className="flex items-center gap-3 py-2 text-[15px]">
                    <span aria-hidden="true">{i.emoji}</span>
                    <span className="flex-1">{i.name}</span>
                    <span className="text-ink-3">
                      คาด {formatQty(l.expected, i.baseUnit, i.displayUnit)} · นับได้ {formatQty(l.counted ?? 0, i.baseUnit, i.displayUnit)}
                    </span>
                    <span className="w-24 text-right font-semibold tabular text-danger">{formatBaht(Math.round(l.value * 100))}</span>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
        {can("inventory.adjust") ? (
          <Button size="lg" loading={pending} onClick={() => exec((d, c) => approveCount(d, c, count.id), { success: "ปรับยอดสต็อกตามที่นับแล้ว", successDetail: "ส่วนต่างถูกบันทึกเป็น “ของหายจากการนับ” ในรายงานเงินเหลือจริง" })}>
            อนุมัติและปรับยอดสต็อก
          </Button>
        ) : (
          <Callout tone="info">ส่งผลให้ผู้จัดการแล้ว ผู้จัดการจะตรวจและอนุมัติการปรับยอด</Callout>
        )}
      </div>
    );
  }

  const zone = ing?.zone ?? "อื่นๆ";
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow={<Link href="/inventory" className="inline-flex items-center gap-1 hover:text-ink"><ArrowLeft className="h-4 w-4" /> สต็อก</Link>}
        title={`นับสต็อก ${count.countNo}`}
        description="นับทีละรายการตามชั้นวาง ระบบบันทึกให้ทุกครั้งที่กดถัดไป"
        actions={<Badge tone="info" icon={<EyeOff className="h-3.5 w-3.5" aria-hidden="true" />}>นับแบบไม่เห็นยอดระบบ</Badge>}
      />
      <div className="mb-4 flex items-center gap-3">
        <ProgressBar value={(counted / Math.max(lines.length, 1)) * 100} label="ความคืบหน้าการนับ" />
        <span className="shrink-0 text-sm tabular text-ink-3">
          {counted}/{lines.length}
        </span>
      </div>
      {ing && line && (
        <AnimatePresence mode="wait">
          <motion.div key={ing.id} initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }} transition={{ type: "spring", stiffness: 400, damping: 36 }}>
            <Card className="grid gap-6 p-5 sm:p-6 md:grid-cols-2">
              <div className="space-y-4">
                <p className="text-sm font-medium text-ink-3">📍 {zone}</p>
                <div className="flex items-center gap-3">
                  <span className="text-5xl" aria-hidden="true">
                    {ing.emoji}
                  </span>
                  <div>
                    <p className="text-2xl font-bold text-ink">{ing.name}</p>
                    {ing.pack && <p className="text-sm text-ink-3">ปกติมาเป็น {ing.pack.name}</p>}
                  </div>
                </div>
                <div className="rounded-2xl bg-surface-2 p-4">
                  <p className="text-sm text-ink-3">นับได้</p>
                  <p className="text-4xl font-bold tabular text-ink">{value || "—"}</p>
                </div>
                {ing.baseUnit !== "pcs" && (
                  <Segmented label="หน่วย" value={unit} onChange={setUnit} options={(ing.baseUnit === "g" ? ["kg", "g"] : ["l", "ml"]).map((u) => ({ value: u, label: u === "kg" ? "กิโลกรัม" : u === "g" ? "กรัม" : u === "l" ? "ลิตร" : "มิลลิลิตร" }))} />
                )}
                {line.counted !== null && (
                  <p className="flex items-center gap-1.5 text-sm text-success">
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> บันทึกแล้ว {formatQty(line.counted, ing.baseUnit, ing.displayUnit)}
                  </p>
                )}
              </div>
              <div className="space-y-3">
                <Keypad decimal size="lg" onKey={(k) => setValue((v) => (v.length > 6 || (k === "." && v.includes(".")) ? v : v + k))} onBackspace={() => setValue((v) => v.slice(0, -1))} />
                <div className="grid grid-cols-[auto_1fr] gap-2">
                  <Button variant="secondary" size="lg" icon={<SkipForward className="h-4 w-4" />} onClick={() => save(true, true)}>
                    ข้าม
                  </Button>
                  <Button size="lg" disabled={value === ""} loading={pending} onClick={() => save(true)} iconRight={<ArrowRight className="h-4 w-4" />}>
                    {idx === lines.length - 1 ? "บันทึก" : "ถัดไป"}
                  </Button>
                </div>
                <div className="flex justify-between text-sm">
                  <button disabled={idx === 0} onClick={() => setIdx((i) => i - 1)} className="h-10 rounded-lg px-2 text-ink-3 hover:bg-surface-2 disabled:opacity-40">
                    ← ก่อนหน้า
                  </button>
                  <span className="self-center text-ink-3">
                    รายการ {idx + 1} จาก {lines.length}
                  </span>
                </div>
              </div>
            </Card>
          </motion.div>
        </AnimatePresence>
      )}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-3">ยังไม่ได้นับ {lines.length - counted} รายการ — รายการที่ไม่นับจะไม่ถูกปรับยอด (ไม่ถือว่าเป็นศูนย์)</p>
        <Button variant={counted === lines.length ? "primary" : "secondary"} disabled={counted === 0} loading={pending} onClick={() => exec((d, c) => submitCount(d, c, count.id), { success: "ส่งผลการนับแล้ว" })}>
          ส่งผลการนับ
        </Button>
      </div>
      <LinkButton href="/inventory" variant="ghost" className="mt-2">
        พักไว้ก่อน นับต่อทีหลัง
      </LinkButton>
    </div>
  );
}
