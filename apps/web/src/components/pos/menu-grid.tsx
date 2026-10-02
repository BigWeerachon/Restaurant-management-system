"use client";

import { MoreVertical } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { usePos } from "@/components/pos/pos-store";
import { useAccess } from "@/hooks/use-sabai";
import { cn } from "@/lib/cn";
import { priceFor } from "@/lib/demo/engine";
import { formatBaht } from "@/lib/demo/selectors";
import { useSabai } from "@/lib/demo/store";
import type { Channel, MenuItem } from "@/lib/demo/types";

/** The dishes the cashier taps. A tile shows its price, a sold-out badge, and how many are already in the bill. */
export function MenuGrid({ items, channel, onTap, onManage }: { items: MenuItem[]; channel?: Channel; onTap: (m: MenuItem) => void; onManage: (m: MenuItem) => void }) {
  const categories = useSabai((s) => s.db.menuCategories);
  const { branch, can } = useAccess();
  const pos = usePos();

  return (
    <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
      {items.map((m, i) => {
        const cat = categories.find((c) => c.id === m.categoryId);
        const out = !!m.soldOut[branch.id];
        const inCart = pos.lines.filter((l) => l.menuItemId === m.id).reduce((s, l) => s + l.qty, 0);
        return (
          <motion.li key={m.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.015, 0.2) }} className="relative">
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => onTap(m)}
              className={cn(
                "glass-soft group relative flex h-full w-full flex-col overflow-hidden rounded-2xl text-left transition-[box-shadow,border-color]",
                out ? "" : "hover:border-brand/50 hover:shadow-md",
                inCart && "border-brand ring-2 ring-brand/25",
              )}
            >
              <span
                className={cn("grid h-24 place-items-center text-5xl sm:h-28", out && "opacity-40 grayscale")}
                style={{
                  background: `radial-gradient(circle at 50% 32%, color-mix(in srgb, white 18%, transparent), transparent 70%), color-mix(in oklab, ${cat?.color ?? "var(--brand)"} var(--cat-tint), var(--tile-surface))`,
                }}
                aria-hidden="true"
              >
                <motion.span whileHover={{ scale: 1.08, rotate: -3 }}>{m.emoji}</motion.span>
              </span>
              <span className="flex flex-1 flex-col gap-0.5 p-3">
                <span className={cn("line-clamp-2 text-[15px] font-semibold leading-snug", out ? "text-ink-2 line-through" : "text-ink")}>{m.name}</span>
                <span className="mt-auto text-[15px] font-semibold tabular text-ink-2">{formatBaht(priceFor(m, channel), { compact: true })}</span>
              </span>
              {out && <span className="absolute left-2 top-2 rounded-full bg-ink px-2 py-0.5 text-xs font-semibold text-ink-inverse">หมด</span>}
              {!out && m.tags?.[0] && <span className="absolute left-2 top-2 rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-on-accent shadow-sm">{m.tags[0]}</span>}
              <AnimatePresence>
                {inCart > 0 && (
                  <motion.span
                    key={inCart}
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    exit={{ scale: 0 }}
                    className="absolute right-2 top-2 grid h-7 min-w-7 place-items-center rounded-full bg-brand px-1.5 text-sm font-bold text-brand-ink shadow-md"
                  >
                    <span className="sr-only">ในบิลแล้ว </span>
                    {inCart}
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.button>
            {can("menu.availability") && (
              <button onClick={() => onManage(m)} className="absolute bottom-2 right-2 grid h-11 w-11 place-items-center rounded-lg text-ink-3 hover:bg-surface-2 hover:text-ink" aria-label={`ตั้งค่า ${m.name}`}>
                <MoreVertical className="h-4 w-4" />
              </button>
            )}
          </motion.li>
        );
      })}
    </ul>
  );
}
