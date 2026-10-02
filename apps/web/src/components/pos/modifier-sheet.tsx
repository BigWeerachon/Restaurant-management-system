"use client";

import { Check, Minus, Plus } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/overlay";
import { Input } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { priceFor } from "@/lib/demo/engine";
import { formatBaht } from "@/lib/demo/selectors";
import type { Channel, MenuItem, ModifierGroup } from "@/lib/demo/types";

const NOTE_CHIPS = ["ไม่ใส่ผัก", "ไม่เผ็ด", "แยกน้ำแข็ง", "ใส่กล่อง", "ไม่รับช้อนส้อม"];

export function defaultOptions(item: MenuItem, groups: ModifierGroup[]): string[] {
  // Smart default: required single-choice groups start on their first option.
  return item.modifierGroupIds.flatMap((gid) => {
    const g = groups.find((x) => x.id === gid);
    return g && g.min >= 1 && g.max === 1 && g.options[0] ? [g.options[0].id] : [];
  });
}

export function needsSheet(item: MenuItem, groups: ModifierGroup[]): boolean {
  return item.modifierGroupIds.some((gid) => (groups.find((g) => g.id === gid)?.options.length ?? 0) > 0);
}

export function ModifierSheet({
  item,
  groups,
  channel,
  onClose,
  onAdd,
  initial,
}: {
  item: MenuItem | null;
  groups: ModifierGroup[];
  channel?: Channel;
  onClose: () => void;
  onAdd: (line: { menuItemId: string; qty: number; modifierOptionIds: string[]; note?: string }) => void;
  /** Editing an existing cart line. */
  initial?: { modifierOptionIds: string[]; qty: number; note?: string };
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (item) {
      setSelected(initial?.modifierOptionIds ?? defaultOptions(item, groups));
      setQty(initial?.qty ?? 1);
      setNote(initial?.note ?? "");
      setTouched(false);
    }
  }, [item, groups, initial]);

  const itemGroups = useMemo(() => (item ? item.modifierGroupIds.map((id) => groups.find((g) => g.id === id)).filter((g): g is ModifierGroup => !!g) : []), [item, groups]);
  const unit = item ? priceFor(item, channel) + selected.reduce((s, id) => s + (itemGroups.flatMap((g) => g.options).find((o) => o.id === id)?.priceDelta ?? 0), 0) : 0;
  const invalid = itemGroups.filter((g) => {
    const n = g.options.filter((o) => selected.includes(o.id)).length;
    return n < g.min || n > g.max;
  });

  const toggle = (g: ModifierGroup, optionId: string) => {
    setSelected((prev) => {
      const inGroup = g.options.map((o) => o.id);
      if (g.max === 1) return [...prev.filter((id) => !inGroup.includes(id)), ...(prev.includes(optionId) && g.min === 0 ? [] : [optionId])];
      if (prev.includes(optionId)) return prev.filter((id) => id !== optionId);
      if (prev.filter((id) => inGroup.includes(id)).length >= g.max) return prev;
      return [...prev, optionId];
    });
  };

  const submit = () => {
    setTouched(true);
    if (!item || invalid.length) return;
    onAdd({ menuItemId: item.id, qty, modifierOptionIds: selected, note: note.trim() || undefined });
  };

  return (
    <Dialog
      open={!!item}
      onOpenChange={(o) => !o && onClose()}
      title={
        <span className="flex items-center gap-3">
          <span className="text-3xl" aria-hidden="true">
            {item?.emoji}
          </span>
          {item?.name}
        </span>
      }
      description={item ? `${formatBaht(priceFor(item, channel))}${channel?.priceMarkup ? ` · ราคา${channel.short}` : ""}` : undefined}
      footer={
        <div className="flex w-full items-center gap-3">
          <div className="flex items-center rounded-2xl bg-surface-2 p-1" role="group" aria-label="จำนวน">
            <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} className="grid h-11 w-11 place-items-center rounded-xl hover:bg-surface-3" aria-label="ลดจำนวน">
              <Minus className="h-5 w-5" />
            </button>
            <span className="w-10 text-center text-lg font-semibold tabular" aria-live="polite">
              {qty}
            </span>
            <button type="button" onClick={() => setQty((q) => Math.min(99, q + 1))} className="grid h-11 w-11 place-items-center rounded-xl hover:bg-surface-3" aria-label="เพิ่มจำนวน">
              <Plus className="h-5 w-5" />
            </button>
          </div>
          <Button size="lg" className="flex-1" onClick={submit}>
            {initial ? "บันทึก" : "เพิ่มลงบิล"} · {formatBaht(unit * qty)}
          </Button>
        </div>
      }
    >
      <div className="space-y-5 pb-2">
        {itemGroups.map((g) => {
          const bad = touched && invalid.includes(g);
          return (
            <fieldset key={g.id}>
              <legend className="mb-2 flex w-full items-center gap-2 text-[15px] font-semibold text-ink">
                {g.name}
                <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", g.min > 0 ? "bg-accent-soft text-accent-ink" : "bg-surface-2 text-ink-3")}>
                  {g.min > 0 ? "ต้องเลือก" : g.max > 1 ? `เลือกได้ถึง ${g.max}` : "ไม่บังคับ"}
                </span>
                {bad && <span className="text-sm font-normal text-danger">เลือกให้ครบก่อนนะ</span>}
              </legend>
              <div className="flex flex-wrap gap-2">
                {g.options.map((o) => {
                  const on = selected.includes(o.id);
                  return (
                    <motion.button
                      key={o.id}
                      type="button"
                      role={g.max === 1 ? "radio" : "checkbox"}
                      aria-checked={on}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => toggle(g, o.id)}
                      className={cn(
                        "flex h-12 items-center gap-2 rounded-2xl border px-4 text-[15px] font-medium transition-colors",
                        on ? "border-brand bg-brand-soft text-brand-soft-ink" : "border-line bg-surface text-ink hover:border-line-strong",
                      )}
                    >
                      {on && <Check className="h-4 w-4" aria-hidden="true" />}
                      {o.name}
                      {o.priceDelta !== 0 && <span className="text-sm text-ink-3">+{formatBaht(o.priceDelta)}</span>}
                    </motion.button>
                  );
                })}
              </div>
            </fieldset>
          );
        })}
        <div>
          <label htmlFor="line-note" className="mb-2 block text-[15px] font-semibold text-ink">
            หมายเหตุถึงครัว <span className="text-sm font-normal text-ink-3">(ไม่บังคับ)</span>
          </label>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {NOTE_CHIPS.map((n) => (
              <button key={n} type="button" onClick={() => setNote((v) => (v ? `${v}, ${n}` : n))} className="h-11 rounded-full border border-line px-3 text-sm text-ink-2 hover:border-line-strong hover:text-ink">
                + {n}
              </button>
            ))}
          </div>
          <Input id="line-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น ไม่ใส่ผักชี" maxLength={140} />
        </div>
      </div>
    </Dialog>
  );
}
