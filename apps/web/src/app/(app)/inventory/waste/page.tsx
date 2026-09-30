"use client";

import { formatQty, toBase, unitsFor, WASTE_REASONS } from "@sabai/domain";
import { ArrowLeft, Check } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { LoadBanner } from "@/components/app/load-banner";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState, Keypad, SuccessCheck } from "@/components/ui/feedback";
import { Card, SearchInput, Segmented } from "@/components/ui/primitives";
import { useDsAction, useLoad } from "@/hooks/use-data-source";
import { useAccess } from "@/hooks/use-sabai";
import { cn } from "@/lib/cn";
import { formatBaht } from "@/lib/demo/selectors";
import { useSabai } from "@/lib/demo/store";
import type { Ingredient } from "@/lib/demo/types";

/** Three taps: what, how much, why. Frequent items first. */
export default function WastePage() {
  const db = useSabai((s) => s.db);
  const { branch, can } = useAccess();
  const { exec, pending } = useDsAction();
  const load = useLoad(["stock"]);
  const [q, setQ] = useState("");
  const [ing, setIng] = useState<Ingredient | null>(null);
  const [amount, setAmount] = useState("");
  const [unit, setUnit] = useState<string>("g");
  const [reason, setReason] = useState<string>("");
  const [done, setDone] = useState<{ name: string; value: number } | null>(null);

  const frequent = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of db.movements) if (m.reason === "waste") counts.set(m.ingredientId, (counts.get(m.ingredientId) ?? 0) + 1);
    return db.ingredients.filter((i) => i.trackStock).sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) || a.name.localeCompare(b.name, "th"));
  }, [db.movements, db.ingredients]);
  const list = frequent.filter((i) => !q || i.name.includes(q));

  const pick = (i: Ingredient) => {
    setIng(i);
    setAmount("");
    setReason("");
    setUnit(i.baseUnit);
  };
  const baseQty = ing && amount ? toBase(Number(amount), unit) : 0;
  const value = ing ? baseQty * (db.balances[`${branch.id}:${ing.id}`]?.avgCost || ing.lastCost || ing.standardCost) : 0;

  const save = async () => {
    if (!ing) return;
    const r = await exec((ds) => ds.recordWaste(ing.id, baseQty, reason));
    if (r.ok) {
      setDone({ name: ing.name, value: r.value });
      setIng(null);
    }
  };

  if (!can("inventory.waste")) return <EmptyState emoji="🔒" title="ตำแหน่งนี้ยังบันทึกของเสียไม่ได้" description="ขอให้ผู้จัดการเพิ่มสิทธิ์ “บันทึกของเสีย” ให้" />;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader eyebrow={<Link href="/inventory" className="inline-flex items-center gap-1 hover:text-ink"><ArrowLeft className="h-4 w-4" /> สต็อก</Link>} title="บันทึกของเสีย" description="ของหก ของหมดอายุ ทำเสีย — บันทึกทันทีที่เกิด ต้นทุนจริงจะแม่นขึ้นมาก" />
      <LoadBanner state={load} className="mb-4" />
      <AnimatePresence mode="wait">
        {done ? (
          <motion.div key="done" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}>
            <Card className="flex flex-col items-center gap-3 p-8 text-center">
              <SuccessCheck />
              <p className="text-xl font-semibold text-ink">บันทึก “{done.name}” แล้ว</p>
              <p className="text-ink-3">มูลค่าประมาณ {formatBaht(Math.round(done.value * 100))} · เจ้าของร้านเห็นในรายงานเงินเหลือจริง</p>
              <div className="flex gap-2">
                <Button onClick={() => setDone(null)}>บันทึกรายการอื่น</Button>
                <Link href="/inventory" className="inline-flex h-11 items-center rounded-xl px-4 font-medium text-ink-2 hover:bg-surface-2">
                  เสร็จแล้ว
                </Link>
              </div>
            </Card>
          </motion.div>
        ) : !ing ? (
          <motion.div key="pick" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
            <SearchInput value={q} onChange={setQ} placeholder="ค้นหาวัตถุดิบ" autoFocus />
            {list.length === 0 ? (
              <EmptyState compact emoji="🔍" title="ไม่พบวัตถุดิบ" description="เพิ่มวัตถุดิบในหน้าสต็อกก่อน แล้วค่อยกลับมาบันทึก" />
            ) : (
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {list.map((i) => (
                  <li key={i.id}>
                    <motion.button whileTap={{ scale: 0.96 }} onClick={() => pick(i)} className="flex h-full w-full items-center gap-3 rounded-2xl border border-line bg-surface p-3 text-left shadow-xs hover:border-brand">
                      <span className="text-3xl" aria-hidden="true">
                        {i.emoji}
                      </span>
                      <span className="text-[15px] font-medium leading-snug text-ink">{i.name}</span>
                    </motion.button>
                  </li>
                ))}
              </ul>
            )}
          </motion.div>
        ) : (
          <motion.div key="form" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}>
            <Card className="p-5 sm:p-6">
              <button onClick={() => setIng(null)} className="mb-4 inline-flex h-10 items-center gap-1 rounded-lg px-2 text-sm text-ink-3 hover:bg-surface-2">
                <ArrowLeft className="h-4 w-4" aria-hidden="true" /> เปลี่ยนรายการ
              </button>
              <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <span className="text-4xl" aria-hidden="true">
                      {ing.emoji}
                    </span>
                    <div>
                      <p className="text-xl font-semibold text-ink">{ing.name}</p>
                      <p className="text-sm text-ink-3">คงเหลือ {formatQty(db.balances[`${branch.id}:${ing.id}`]?.qty ?? 0, ing.baseUnit, ing.displayUnit)}</p>
                    </div>
                  </div>
                  <div className="rounded-2xl bg-surface-2 p-4">
                    <p className="text-sm text-ink-3">ปริมาณที่เสีย</p>
                    <p className="text-4xl font-bold tabular text-ink">
                      {amount || "0"} <span className="text-xl font-medium text-ink-3">{unitsFor(ing.baseUnit === "g" ? "mass" : ing.baseUnit === "ml" ? "volume" : "count").find((u) => u.code === unit)?.shortTh}</span>
                    </p>
                    {value > 0 && <p className="mt-1 text-sm text-ink-3">มูลค่าประมาณ {formatBaht(Math.round(value * 100))}</p>}
                  </div>
                  {ing.baseUnit !== "pcs" && (
                    <Segmented
                      label="หน่วย"
                      value={unit}
                      onChange={setUnit}
                      options={unitsFor(ing.baseUnit === "g" ? "mass" : "volume")
                        .filter((u) => ["g", "kg", "ml", "l", "tbsp"].includes(u.code))
                        .map((u) => ({ value: u.code, label: u.nameTh }))}
                    />
                  )}
                  <Keypad decimal onKey={(k) => setAmount((v) => (v.length > 6 || (k === "." && v.includes(".")) ? v : v + k))} onBackspace={() => setAmount((v) => v.slice(0, -1))} />
                </div>
                <div className="space-y-3">
                  <p className="font-semibold text-ink">สาเหตุ</p>
                  <div role="radiogroup" aria-label="สาเหตุ" className="grid grid-cols-2 gap-2">
                    {WASTE_REASONS.map((r) => (
                      <button key={r.code} role="radio" aria-checked={reason === r.code} onClick={() => setReason(r.code)} className={cn("flex h-14 items-center justify-center gap-2 rounded-2xl border-2 text-[15px] font-medium", reason === r.code ? "border-brand bg-brand-soft text-brand-soft-ink" : "border-line text-ink hover:border-line-strong")}>
                        {reason === r.code && <Check className="h-4 w-4" aria-hidden="true" />}
                        {r.th}
                      </button>
                    ))}
                  </div>
                  <Button size="xl" block className="mt-4" disabled={!(baseQty > 0) || !reason} loading={pending} onClick={save}>
                    บันทึกของเสีย
                  </Button>
                  {(!(baseQty > 0) || !reason) && <p className="text-center text-sm text-ink-3">{!(baseQty > 0) ? "ใส่ปริมาณก่อน" : "เลือกสาเหตุ 1 อย่าง"}</p>}
                </div>
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
