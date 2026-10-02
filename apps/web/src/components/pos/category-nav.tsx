"use client";

import { LayoutGroup, motion } from "motion/react";
import { cn } from "@/lib/cn";
import { useSabai } from "@/lib/demo/store";

/** "All" and "best sellers" come before the shop's own categories. */
function useCategoryTabs() {
  const categories = useSabai((s) => s.db.menuCategories);
  return [{ id: "all", name: "ทั้งหมด", emoji: "🍽️" }, { id: "best", name: "ขายดี", emoji: "⭐" }, ...categories];
}

interface CategoryProps {
  category: string;
  onChange: (id: string) => void;
}

/** Side rail for tablets and wider. */
export function CategoryRail({ category, onChange }: CategoryProps) {
  const tabs = useCategoryTabs();
  return (
    <nav
      aria-label="หมวดเมนู"
      className="hidden w-[118px] shrink-0 flex-col gap-1 overflow-y-auto border-r border-[var(--glass-border)] bg-[var(--glass-bg)] p-2 backdrop-blur-xl backdrop-saturate-150 scrollbar-thin md:flex"
    >
      <LayoutGroup id="cats">
        {tabs.map((c) => {
          const on = category === c.id;
          return (
            <button
              key={c.id}
              onClick={() => onChange(c.id)}
              aria-pressed={on}
              className={cn("relative flex flex-col items-center gap-1 rounded-2xl px-1 py-3 text-center text-[13px] font-medium leading-tight", on ? "text-ink" : "text-ink-3 hover:bg-surface-2")}
            >
              {on && <motion.span layoutId="cat-pill" className="absolute inset-0 rounded-2xl bg-brand-soft ring-1 ring-brand/30" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
              <span className="relative text-2xl" aria-hidden="true">
                {c.emoji}
              </span>
              <span className="relative">{c.name}</span>
            </button>
          );
        })}
      </LayoutGroup>
    </nav>
  );
}

/** Scrolling chips for phones. */
export function CategoryChips({ category, onChange }: CategoryProps) {
  const tabs = useCategoryTabs();
  return (
    <div className="no-scrollbar flex gap-1.5 overflow-x-auto px-3 pb-2 md:hidden">
      {tabs.map((c) => (
        <button
          key={c.id}
          onClick={() => onChange(c.id)}
          aria-pressed={category === c.id}
          className={cn("h-11 shrink-0 rounded-full border px-3 text-sm font-medium", category === c.id ? "border-brand bg-brand-soft text-brand-soft-ink" : "border-line text-ink-2")}
        >
          {c.emoji} {c.name}
        </button>
      ))}
    </div>
  );
}
