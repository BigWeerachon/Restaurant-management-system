"use client";

import type { WaterfallStep } from "@sabai/domain";
import { motion } from "motion/react";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { ChartTooltip, TooltipRow, useWidth } from "./chart-kit";

const pct = (v: number, digits = 0) => `${(v * 100).toFixed(digits)}%`;

/** Pointer/focus tooltip state shared by the HTML bar charts below. */
function useHoverTip<K>() {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<{ key: K; x: number; y: number } | null>(null);
  const at = (key: K) => ({
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const box = ref.current?.getBoundingClientRect();
      if (box) setTip({ key, x: e.clientX - box.left, y: e.clientY - box.top });
    },
    onPointerLeave: () => setTip(null),
    onFocus: (e: React.FocusEvent<HTMLElement>) => {
      const box = ref.current?.getBoundingClientRect();
      const r = e.currentTarget.getBoundingClientRect();
      if (box) setTip({ key, x: r.left - box.left + r.width / 2, y: r.top - box.top });
    },
    onBlur: () => setTip(null),
  });
  return { ref, width, tip, at };
}

// ---------------------------------------------------------------------------
// Profit waterfall — "เหลือเงินจริงเท่าไร"
// ---------------------------------------------------------------------------
export function Waterfall({ steps, format }: { steps: WaterfallStep[]; format: (v: number) => string }) {
  const { ref, width, tip, at } = useHoverTip<string>();
  const lo = Math.min(0, ...steps.map((s) => s.running));
  const hi = Math.max(1, ...steps.map((s) => Math.max(s.running, s.kind === "start" ? s.value : 0)));
  const span = hi - lo;
  const hovered = steps.find((s) => s.key === tip?.key);
  return (
    <div ref={ref} className="relative">
      <ol className="space-y-2">
        {steps.map((s, i) => {
          const from = s.kind === "minus" ? s.running - s.value : 0;
          const to = s.kind === "minus" ? s.running : s.kind === "start" ? s.value : s.running;
          const left = ((Math.min(from, to) - lo) / span) * 100;
          const w = (Math.abs(to - from) / span) * 100;
          const negative = s.kind === "minus" || to < 0;
          const total = s.kind !== "minus";
          return (
            <li
              key={s.key}
              tabIndex={0}
              aria-label={`${s.label} ${format(s.value)} (${pct(s.pctOfSales, 1)} ของยอดขาย) — ${s.explain}`}
              {...at(s.key)}
              className={cn("grid grid-cols-[7.5rem_1fr_6.5rem] items-center gap-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-[10rem_1fr_8rem]", total && "py-1")}
            >
              <span className={cn("truncate text-sm", total ? "font-semibold text-ink" : "text-ink-2")}>{s.label}</span>
              <span className="relative h-6">
                {i > 0 && <span className="absolute -top-2 h-2 w-px bg-line-strong" style={{ left: `${((from - lo) / span) * 100}%` }} aria-hidden="true" />}
                <motion.span
                  className="absolute inset-y-0 rounded"
                  style={{
                    left: `${left}%`,
                    width: `max(${w}%, 3px)`,
                    background: negative ? "var(--series-neg)" : "var(--series-1)",
                    opacity: total ? 1 : 0.85,
                    transformOrigin: s.kind === "minus" ? "right" : "left",
                  }}
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: 0.55, delay: 0.1 + i * 0.07, ease: [0.22, 1, 0.36, 1] }}
                />
              </span>
              <span className="text-right">
                <span className={cn("block tabular", total ? "text-[15px] font-bold text-ink" : "text-sm font-medium text-ink")}>{format(s.value)}</span>
                {s.kind !== "start" && <span className="block text-[11px] tabular text-ink-3">{pct(s.pctOfSales, 1)} ของยอดขาย</span>}
              </span>
            </li>
          );
        })}
      </ol>
      <ChartTooltip visible={!!hovered} x={tip?.x ?? 0} y={tip?.y ?? 0} containerWidth={width}>
        {hovered && (
          <>
            <TooltipRow color={hovered.kind === "minus" || hovered.value < 0 ? "var(--series-neg)" : "var(--series-1)"} label={hovered.label} value={format(hovered.value)} />
            <p className="mt-1 text-xs text-ink-3">{hovered.explain}</p>
          </>
        )}
      </ChartTooltip>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Channel mix — 100% bars: kept / food cost / GP + fees
// ---------------------------------------------------------------------------
export interface ChannelMixRow {
  id: string;
  name: string;
  orders: number;
  netSales: number;
  cost: number;
  fees: number;
  contribution: number;
  shareOfSales: number;
}

export const CHANNEL_SEGMENTS = [
  { key: "contribution", label: "เหลือเป็นกำไรขั้นต้น", color: "var(--series-1)" },
  { key: "cost", label: "ต้นทุนวัตถุดิบ", color: "var(--series-2)" },
  { key: "fees", label: "GP + ค่าธรรมเนียม", color: "var(--series-3)" },
] as const;

export function ChannelMix({ rows, format }: { rows: ChannelMixRow[]; format: (v: number) => string }) {
  const { ref, width, tip, at } = useHoverTip<string>();
  const [rowId, segKey] = tip?.key.split(":") ?? [];
  const row = rows.find((r) => r.id === rowId);
  const seg = CHANNEL_SEGMENTS.find((s) => s.key === segKey);
  return (
    <div ref={ref} className="relative">
      <ul className="space-y-4">
        {rows.map((r, ri) => {
          const margin = r.netSales > 0 ? r.contribution / r.netSales : 0;
          return (
            <li key={r.id}>
              <div className="mb-1.5 flex items-baseline justify-between gap-2 text-sm">
                <span className="font-medium text-ink">
                  {r.name} <span className="font-normal text-ink-3">· {r.orders.toLocaleString("th-TH")} บิล · {pct(r.shareOfSales)} ของยอดขาย</span>
                </span>
                <span className="shrink-0 text-ink-2">
                  เหลือ <strong className="tabular text-ink">{pct(margin)}</strong>
                </span>
              </div>
              <div className="flex h-5 gap-[2px] overflow-hidden rounded">
                {CHANNEL_SEGMENTS.map((s, si) => {
                  const v = Math.max(0, r[s.key]);
                  const w = r.netSales > 0 ? (v / r.netSales) * 100 : 0;
                  if (w <= 0) return null;
                  return (
                    <motion.span
                      key={s.key}
                      tabIndex={0}
                      role="img"
                      aria-label={`${r.name} ${s.label} ${format(v)} (${pct(v / (r.netSales || 1))})`}
                      {...at(`${r.id}:${s.key}`)}
                      className="h-full outline-none first:rounded-l last:rounded-r focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink"
                      style={{ background: s.color, transformOrigin: "left" }}
                      initial={{ width: 0 }}
                      animate={{ width: `${w}%` }}
                      transition={{ duration: 0.6, delay: ri * 0.08 + si * 0.05, ease: [0.22, 1, 0.36, 1] }}
                    />
                  );
                })}
              </div>
            </li>
          );
        })}
      </ul>
      <ChartTooltip visible={!!row && !!seg} x={tip?.x ?? 0} y={tip?.y ?? 0} containerWidth={width}>
        {row && seg && (
          <>
            <p className="mb-1 font-semibold">{row.name}</p>
            <TooltipRow color={seg.color} label={seg.label} value={format(Math.max(0, row[seg.key]))} />
            <p className="text-xs text-ink-3">{pct(Math.max(0, row[seg.key]) / (row.netSales || 1), 1)} ของยอดขายช่องทางนี้ ({format(row.netSales)})</p>
          </>
        )}
      </ChartTooltip>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ranked horizontal bars (single series — the title names it, no legend)
// ---------------------------------------------------------------------------
export function RankBars({ rows, format }: { rows: { id: string; label: ReactNode; value: number; detail?: ReactNode; tip?: ReactNode }[]; format: (v: number) => string }) {
  const { ref, width, tip, at } = useHoverTip<string>();
  const max = Math.max(1, ...rows.map((r) => r.value));
  const hovered = rows.find((r) => r.id === tip?.key);
  return (
    <div ref={ref} className="relative">
      <ol className="space-y-3">
        {rows.map((r, i) => (
          <li key={r.id} tabIndex={0} {...at(r.id)} className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-ink">{r.label}</span>
              <span className="shrink-0 font-semibold tabular text-ink">{format(r.value)}</span>
            </div>
            <div className="h-2 rounded bg-surface-2">
              <motion.div className="h-full rounded" style={{ background: "var(--series-1)" }} initial={{ width: 0 }} animate={{ width: `${(Math.max(r.value, 0) / max) * 100}%` }} transition={{ duration: 0.6, delay: i * 0.04, ease: [0.22, 1, 0.36, 1] }} />
            </div>
            {r.detail && <p className="mt-1 text-xs text-ink-3">{r.detail}</p>}
          </li>
        ))}
      </ol>
      <ChartTooltip visible={!!hovered?.tip} x={tip?.x ?? 0} y={tip?.y ?? 0} containerWidth={width}>
        {hovered?.tip}
      </ChartTooltip>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Orders by hour — columns anchored to the baseline, peak labelled directly
// ---------------------------------------------------------------------------
export function HourColumns({ hours, from = 6, to = 22 }: { hours: number[]; from?: number; to?: number }) {
  const { ref, width, tip, at } = useHoverTip<number>();
  const slice = hours.slice(from, to + 1);
  const max = Math.max(1, ...slice);
  const peak = slice.indexOf(Math.max(...slice)) + from;
  const total = slice.reduce((a, b) => a + b, 0);
  return (
    <div ref={ref} className="relative">
      <div className="flex h-44 items-end gap-[2px] border-b border-viz-axis pt-6" role="list" aria-label="จำนวนบิลตามชั่วโมง">
        {slice.map((n, i) => {
          const h = from + i;
          return (
            <div key={h} role="listitem" tabIndex={0} aria-label={`${h}:00 น. ${n.toLocaleString("th-TH")} บิล`} {...at(h)} className="relative flex h-full flex-1 items-end outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {h === peak && n > 0 && <span className="absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] font-medium text-ink-2">ขายดีสุด</span>}
              <motion.div
                className="w-full rounded-t"
                style={{ background: "var(--series-1)", opacity: tip && tip.key !== h ? 0.55 : 1, transformOrigin: "bottom" }}
                initial={{ height: 0 }}
                animate={{ height: `${(n / max) * 100}%` }}
                transition={{ duration: 0.5, delay: i * 0.025, ease: [0.22, 1, 0.36, 1] }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-[2px] text-[11px] text-ink-3" aria-hidden="true">
        {slice.map((_, i) => (
          <span key={i} className="flex-1 text-center">
            {(from + i) % 3 === 0 ? from + i : ""}
          </span>
        ))}
      </div>
      <ChartTooltip visible={tip !== null} x={tip?.x ?? 0} y={tip?.y ?? 0} containerWidth={width}>
        {tip && (
          <>
            <p className="font-semibold">
              {tip.key}:00–{tip.key}:59 น.
            </p>
            <TooltipRow color="var(--series-1)" label="จำนวนบิล" value={(hours[tip.key] ?? 0).toLocaleString("th-TH")} />
            <p className="text-xs text-ink-3">{pct((hours[tip.key] ?? 0) / (total || 1))} ของทั้งวัน</p>
          </>
        )}
      </ChartTooltip>
    </div>
  );
}
