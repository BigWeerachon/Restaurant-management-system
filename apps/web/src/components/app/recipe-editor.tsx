"use client";

import { costRecipe, foodCostPct, formatQty, marginHealth, suggestPrice, toBase, unitsFor, type MarginHealth, type Recipe } from "@sabai/domain";
import { AlertTriangle, CheckCircle2, Flame, Plus, Sparkles, Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import { Badge, Input, SearchInput, Select } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { recipeBook } from "@/lib/demo/engine";
import { formatBaht } from "@/lib/demo/selectors";
import type { DemoState } from "@/lib/demo/types";

export const HEALTH: Record<MarginHealth, { label: string; tone: "success" | "brand" | "warning" | "danger"; icon: typeof CheckCircle2; advice: string }> = {
  great: { label: "ต้นทุนดีมาก", tone: "success", icon: CheckCircle2, advice: "กำไรต่อจานดี รักษาคุณภาพไว้" },
  ok: { label: "ต้นทุนดี", tone: "brand", icon: CheckCircle2, advice: "อยู่ในเกณฑ์ร้านทั่วไป (28–35%)" },
  watch: { label: "ควรดู", tone: "warning", icon: AlertTriangle, advice: "ลองปรับขนาด ส่วนผสม หรือขึ้นราคาเล็กน้อย" },
  high: { label: "ต้นทุนสูงเกินไป", tone: "danger", icon: Flame, advice: "ขายยิ่งมากยิ่งได้กำไรน้อย ควรปรับราคาหรือสูตร" },
};

export function HealthBadge({ health }: { health: MarginHealth }) {
  const h = HEALTH[health];
  const Ico = h.icon;
  return (
    <Badge tone={h.tone} icon={<Ico className="h-3.5 w-3.5" aria-hidden="true" />}>
      {h.label}
    </Badge>
  );
}

/** Food-cost meter: the track is a lighter step of the same scale, fill carries severity. */
export function CostMeter({ pct, health }: { pct: number; health: MarginHealth }) {
  const color = { great: "bg-success", ok: "bg-brand", watch: "bg-warning-fill", high: "bg-danger-fill" }[health];
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-ink-3">ต้นทุนวัตถุดิบต่อราคาขาย</span>
        <span className="text-lg font-bold tabular text-ink">{(pct * 100).toFixed(1)}%</span>
      </div>
      <div className="relative mt-2 h-3 overflow-hidden rounded-full bg-surface-3" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct * 100)} aria-label="สัดส่วนต้นทุน">
        <motion.div className={cn("h-full rounded-full", color)} initial={{ width: 0 }} animate={{ width: `${Math.min(pct * 100, 100)}%` }} transition={{ type: "spring", stiffness: 120, damping: 20 }} />
        <span className="absolute inset-y-0 left-[28%] w-px bg-ink/20" aria-hidden="true" />
        <span className="absolute inset-y-0 left-[35%] w-px bg-ink/20" aria-hidden="true" />
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-ink-3">
        <span>0%</span>
        <span>เป้าหมาย 28–35%</span>
        <span>100%</span>
      </div>
    </div>
  );
}

export interface EditableLine {
  ingredientId: string;
  amount: string;
  unit: string;
  /** Trim/cooking loss kept from the saved recipe (edited by chefs in V2). */
  wasteRate?: number;
}

export function toRecipe(lines: EditableLine[]): Recipe {
  return {
    yieldQty: 1,
    lines: lines.filter((l) => Number(l.amount) > 0).map((l) => ({ ingredientId: l.ingredientId, qty: toBase(Number(l.amount), l.unit), wasteRate: l.wasteRate ?? 0 })),
  };
}

export function fromRecipe(db: DemoState, recipe?: Recipe): EditableLine[] {
  return (recipe?.lines ?? []).map((l) => {
    const ing = db.ingredients.find((i) => i.id === l.ingredientId);
    return { ingredientId: l.ingredientId, amount: String(l.qty), unit: ing?.baseUnit ?? "g", wasteRate: l.wasteRate ?? 0 };
  });
}

export function useCosting(db: DemoState, lines: EditableLine[], price: number) {
  return useMemo(() => {
    const book = recipeBook(db);
    const recipe = toRecipe(lines);
    const breakdown = costRecipe(recipe, book);
    const vat = db.tenant.vatRegistered ? db.tenant.vatRate : 0;
    const pct = foodCostPct(breakdown.cost, price, vat, db.tenant.pricesIncludeVat);
    return { breakdown, pct, health: marginHealth(pct), suggested: suggestPrice(breakdown.cost, 0.3, vat, db.tenant.pricesIncludeVat) };
  }, [db, lines, price]);
}

export function RecipeEditor({ db, lines, onChange, showCost }: { db: DemoState; lines: EditableLine[]; onChange: (l: EditableLine[]) => void; showCost: boolean }) {
  const [q, setQ] = useState("");
  const book = useMemo(() => recipeBook(db), [db]);
  const options = db.ingredients.filter((i) => !lines.some((l) => l.ingredientId === i.id) && (!q || i.name.includes(q)));
  const set = (idx: number, patch: Partial<EditableLine>) => onChange(lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  return (
    <div className="space-y-3">
      {lines.length === 0 && <p className="rounded-2xl border border-dashed border-line-strong p-4 text-center text-sm text-ink-3">ยังไม่มีส่วนผสม — ค้นหาวัตถุดิบด้านล่างเพื่อเพิ่ม (ใส่เฉพาะของที่ใช้เยอะก่อนก็พอ)</p>}
      <ul className="space-y-2">
        <AnimatePresence initial={false}>
          {lines.map((l, idx) => {
            const ing = db.ingredients.find((i) => i.id === l.ingredientId)!;
            const units = unitsFor(ing.baseUnit === "g" ? "mass" : ing.baseUnit === "ml" ? "volume" : "count").filter((u) => ["g", "kg", "ml", "l", "tsp", "tbsp", "pcs"].includes(u.code));
            const qty = Number(l.amount) > 0 ? toBase(Number(l.amount), l.unit) : 0;
            const cost = qty * (book.ingredients.get(ing.id)?.unitCost ?? 0);
            return (
              <motion.li key={l.ingredientId} layout initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} className="flex flex-wrap items-center gap-2 rounded-2xl border border-line p-2 pl-3">
                <span className="text-xl" aria-hidden="true">
                  {ing.emoji}
                </span>
                <span className="min-w-28 flex-1 text-[15px] font-medium text-ink">{ing.name}</span>
                <Input className="w-24" inputMode="decimal" aria-label={`ปริมาณ ${ing.name}`} value={l.amount} onChange={(e) => set(idx, { amount: e.target.value.replace(/[^\d.]/g, "") })} placeholder="0" />
                <Select className="w-32" aria-label={`หน่วย ${ing.name}`} value={l.unit} onChange={(e) => set(idx, { unit: e.target.value })}>
                  {units.map((u) => (
                    <option key={u.code} value={u.code}>
                      {u.nameTh}
                    </option>
                  ))}
                </Select>
                {showCost && <span className="w-20 text-right text-sm tabular text-ink-2">{formatBaht(Math.round(cost * 100))}</span>}
                <button type="button" onClick={() => onChange(lines.filter((_, i) => i !== idx))} className="grid h-11 w-11 place-items-center rounded-xl text-ink-3 hover:bg-surface-2 hover:text-danger" aria-label={`ลบ ${ing.name}`}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
      <div>
        <SearchInput value={q} onChange={setQ} placeholder="+ เพิ่มส่วนผสม (พิมพ์ชื่อวัตถุดิบ)" />
        {q && (
          <ul className="mt-2 max-h-56 overflow-y-auto rounded-xl border border-line bg-surface">
            {options.slice(0, 8).map((i) => (
              <li key={i.id}>
                <button
                  type="button"
                  onClick={() => {
                    onChange([...lines, { ingredientId: i.id, amount: "", unit: i.baseUnit }]);
                    setQ("");
                  }}
                  className="flex h-12 w-full items-center gap-3 px-3 text-left hover:bg-surface-2"
                >
                  <span aria-hidden="true">{i.emoji}</span>
                  <span className="flex-1">{i.name}</span>
                  {i.kind === "prep" && <span className="text-xs text-ink-3">ของเตรียม</span>}
                </button>
              </li>
            ))}
            {options.length === 0 && <li className="p-3 text-sm text-ink-3">ไม่พบ “{q}” — เพิ่มในหน้าสต็อกก่อนได้</li>}
          </ul>
        )}
      </div>
      {!showCost && lines.length > 0 && (
        <p className="text-xs text-ink-3">
          รวม {lines.length} ส่วนผสม · ปริมาณรวม {formatQty(lines.reduce((s, l) => s + (Number(l.amount) > 0 ? toBase(Number(l.amount), l.unit) : 0), 0), "g")}
        </p>
      )}
    </div>
  );
}

export function SuggestedPrice({ price, suggested, onUse }: { price: number; suggested: number; onUse: (p: number) => void }) {
  if (!suggested || Math.abs(suggested - price) < 1) return null;
  return (
    <button type="button" onClick={() => onUse(suggested)} className="flex w-full items-center gap-2 rounded-2xl bg-accent-soft p-3 text-left text-sm text-accent-ink hover:brightness-95">
      <Sparkles className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="flex-1">
        ราคาที่ทำให้ต้นทุนอยู่ราว 30% คือ <strong>฿{suggested}</strong>
      </span>
      <span className="font-semibold underline">ใช้ราคานี้</span>
    </button>
  );
}

export { Plus };
