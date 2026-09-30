"use client";

/**
 * Shared chart anatomy (see docs/02-ux-principles.md → Data visualisation):
 * recessive grid, text in ink tokens (never the series colour), a hover/focus
 * tooltip on every plotted chart, and a table view for every chart.
 */
import { BarChart3, Table2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Card } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";

/**
 * Width of an element, tracked with ResizeObserver (charts are fluid). The first width arrives with the observer's first
 * report, right after the layout the browser does anyway. It is not read on the spot (`clientWidth` in a layout effect):
 * that makes the browser lay the whole page out in the middle of drawing it, inside one long block with the commit. A
 * chart's box keeps its height meanwhile (`minHeight` on the wrapper), so nothing below it moves when the chart appears.
 */
export function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/** "Nice" axis ticks from 0 to ≥max. */
export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = 0; v < max + step * 0.999; v += step) out.push(Math.round(v));
  return out;
}

/** Compact baht for axis labels: 12,000 → 12K. Input in satang. */
export function axisBaht(satang: number): string {
  const v = satang / 100;
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toLocaleString("th-TH", { maximumFractionDigits: 1 })}M`;
  if (Math.abs(v) >= 1000) return `${(v / 1000).toLocaleString("th-TH", { maximumFractionDigits: 1 })}K`;
  return v.toLocaleString("th-TH", { maximumFractionDigits: 0 });
}

export function Swatch({ color, shape = "square" }: { color: string; shape?: "square" | "line" | "dot" }) {
  if (shape === "line") return <span className="inline-block h-0.5 w-3.5 rounded-full" style={{ background: color }} aria-hidden="true" />;
  return <span className={cn("inline-block h-2.5 w-2.5", shape === "dot" ? "rounded-full" : "rounded-[3px]")} style={{ background: color }} aria-hidden="true" />;
}

export function Legend({ items, className }: { items: { label: string; color: string; shape?: "square" | "line" | "dot" }[]; className?: string }) {
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-ink-2", className)} aria-label="คำอธิบายสี">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <Swatch color={i.color} shape={i.shape} />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * Tooltip positioned inside a `relative` chart container. Flips to the left of
 * the pointer near the right edge so it never overflows on phones.
 */
export function ChartTooltip({ x, y, containerWidth, visible, children }: { x: number; y: number; containerWidth: number; visible: boolean; children: ReactNode }) {
  const flip = x > containerWidth - 190;
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          role="status"
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1, x: flip ? x - 12 : x + 12, y: Math.max(y - 12, 0) }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ type: "spring", stiffness: 700, damping: 45, opacity: { duration: 0.12 } }}
          style={{ translateX: flip ? "-100%" : "0%" }}
          className="pointer-events-none absolute left-0 top-0 z-10 min-w-40 max-w-64 rounded-xl border border-line bg-surface px-3 py-2 text-[13px] text-ink shadow-lg"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function TooltipRow({ color, label, value, shape }: { color?: string; label: ReactNode; value: ReactNode; shape?: "square" | "line" | "dot" }) {
  return (
    <p className="flex items-center gap-2 py-0.5">
      {color && <Swatch color={color} shape={shape} />}
      <span className="flex-1 text-ink-2">{label}</span>
      <span className="font-semibold tabular text-ink">{value}</span>
    </p>
  );
}

/** Card with a title, an optional legend, and a chart ⇄ table toggle. */
export function ChartCard({
  title,
  description,
  legend,
  chart,
  table,
  className,
  footer,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  legend?: ReactNode;
  chart: ReactNode;
  table: ReactNode;
  className?: string;
  footer?: ReactNode;
  actions?: ReactNode;
}) {
  const [view, setView] = useState<"chart" | "table">("chart");
  return (
    <Card as="section" className={cn("flex flex-col", className)}>
      <header className="flex items-start gap-3 px-5 pt-5">
        <div className="min-w-0 flex-1">
          <h3 className="text-[17px] font-semibold text-ink">{title}</h3>
          {description && <p className="mt-0.5 text-sm text-ink-3">{description}</p>}
        </div>
        {actions}
        <button
          type="button"
          onClick={() => setView(view === "chart" ? "table" : "chart")}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-ink-3 hover:bg-surface-2 hover:text-ink"
          aria-label={view === "chart" ? "ดูเป็นตาราง" : "ดูเป็นกราฟ"}
        >
          {view === "chart" ? <Table2 className="h-4 w-4" aria-hidden="true" /> : <BarChart3 className="h-4 w-4" aria-hidden="true" />}
          <span className="hidden sm:inline">{view === "chart" ? "ตาราง" : "กราฟ"}</span>
        </button>
      </header>
      {legend && view === "chart" && <div className="px-5 pt-3">{legend}</div>}
      <div className="flex-1 px-5 pb-5 pt-4">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={view} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
            {view === "chart" ? chart : <div className="max-h-96 overflow-auto rounded-xl border border-line">{table}</div>}
          </motion.div>
        </AnimatePresence>
      </div>
      {footer}
    </Card>
  );
}

export function DataTable({ columns, rows }: { columns: { label: string; align?: "right" }[]; rows: ReactNode[][] }) {
  return (
    <table className="w-full text-sm">
      <thead className="sticky top-0 bg-surface-2 text-ink-3">
        <tr>
          {columns.map((c) => (
            <th key={c.label} scope="col" className={cn("px-3 py-2 font-medium", c.align === "right" ? "text-right" : "text-left")}>
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((cell, j) => (
              <td key={j} className={cn("px-3 py-2 text-ink", columns[j]?.align === "right" && "text-right tabular")}>
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
