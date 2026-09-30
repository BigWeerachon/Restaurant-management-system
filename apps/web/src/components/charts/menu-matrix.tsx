"use client";

import { MENU_CLASS_COPY, type EngineeredItem } from "@sabai/domain";
import { motion } from "motion/react";
import { useMemo, useState, type KeyboardEvent } from "react";
import { axisBaht, ChartTooltip, TooltipRow, useWidth } from "./chart-kit";

/**
 * Menu engineering scatter: popularity (share of items sold) × profit per
 * dish. Quadrant lines are the Kasavana–Smith thresholds; quadrant names are
 * printed in the plot so class is never colour-alone. One series, one hue.
 */
export function MenuMatrix({ items, format, height = 300 }: { items: EngineeredItem[]; format: (v: number) => string; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const pad = { top: 16, right: 16, bottom: 34, left: 48 };
  const w = Math.max(width - pad.left - pad.right, 10);
  const h = height - pad.top - pad.bottom;

  const { popT, avgC, maxX, maxY, minY, sorted } = useMemo(() => {
    const totalQty = items.reduce((s, i) => s + i.qty, 0) || 1;
    const popT = items.length ? (1 / items.length) * 0.7 : 0;
    const avgC = items.reduce((s, i) => s + (i.sales - i.cost), 0) / totalQty;
    return {
      popT,
      avgC,
      maxX: Math.max(popT * 2, ...items.map((i) => i.mixPct)) * 1.08,
      maxY: Math.max(avgC * 2, ...items.map((i) => i.contributionPerItem)) * 1.08,
      minY: Math.min(0, ...items.map((i) => i.contributionPerItem)),
      sorted: [...items].sort((a, b) => a.mixPct - b.mixPct),
    };
  }, [items]);

  const x = (v: number) => pad.left + (v / (maxX || 1)) * w;
  const y = (v: number) => pad.top + h - ((v - minY) / (maxY - minY || 1)) * h;
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "ArrowUp") setActive((v) => Math.min((v ?? -1) + 1, sorted.length - 1));
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") setActive((v) => Math.max((v ?? sorted.length) - 1, 0));
    else if (e.key === "Escape") setActive(null);
    else return;
    e.preventDefault();
  };
  const cur = active !== null ? sorted[active] : null;
  const quadrant = (cls: keyof typeof MENU_CLASS_COPY, qx: "l" | "r", qy: "t" | "b") => (
    <text
      x={qx === "l" ? pad.left + 8 : pad.left + w - 8}
      y={qy === "t" ? pad.top + 14 : pad.top + h - 8}
      textAnchor={qx === "l" ? "start" : "end"}
      className="fill-ink-3 text-[12px] font-medium"
    >
      {MENU_CLASS_COPY[cls].emoji} {MENU_CLASS_COPY[cls].th}
    </text>
  );

  return (
    <div ref={ref} className="relative w-full" style={{ minHeight: height }}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          tabIndex={0}
          onKeyDown={onKey}
          onBlur={() => setActive(null)}
          aria-label="แผนภาพเมนู: แกนนอนคือความนิยม แกนตั้งคือกำไรต่อจาน ใช้ปุ่มลูกศรเพื่อไล่ดูทีละเมนู"
          className="block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <rect x={pad.left} y={pad.top} width={w} height={h} fill="none" stroke="var(--viz-grid)" />
          <line x1={x(popT)} x2={x(popT)} y1={pad.top} y2={pad.top + h} stroke="var(--viz-axis)" strokeDasharray="4 4" />
          <line x1={pad.left} x2={pad.left + w} y1={y(avgC)} y2={y(avgC)} stroke="var(--viz-axis)" strokeDasharray="4 4" />
          {quadrant("puzzle", "l", "t")}
          {quadrant("star", "r", "t")}
          {quadrant("dog", "l", "b")}
          {quadrant("plowhorse", "r", "b")}
          <text x={pad.left - 8} y={y(avgC)} dy="0.32em" textAnchor="end" className="fill-ink-3 text-[11px] tabular">
            ฿{axisBaht(avgC)}
          </text>
          <text x={pad.left - 8} y={pad.top + 4} dy="0.32em" textAnchor="end" className="fill-ink-3 text-[11px] tabular">
            ฿{axisBaht(maxY)}
          </text>
          <text x={pad.left + w / 2} y={height - 6} textAnchor="middle" className="fill-ink-3 text-[12px]">
            ขายบ่อย →
          </text>
          <text transform={`translate(12 ${pad.top + h / 2}) rotate(-90)`} textAnchor="middle" className="fill-ink-3 text-[12px]">
            กำไรต่อจาน →
          </text>
          {sorted.map((it, i) => (
            <motion.circle
              key={it.menuItemId}
              cx={x(it.mixPct)}
              cy={y(it.contributionPerItem)}
              fill="var(--series-1)"
              stroke="var(--surface)"
              strokeWidth={2}
              initial={{ r: 0 }}
              animate={{ r: active === i ? 7 : 5 }}
              transition={{ type: "spring", stiffness: 400, damping: 22, delay: active === null ? i * 0.02 : 0 }}
            />
          ))}
          {sorted.map((it, i) => (
            <circle key={`hit-${it.menuItemId}`} cx={x(it.mixPct)} cy={y(it.contributionPerItem)} r={14} fill="transparent" onPointerEnter={() => setActive(i)} onPointerLeave={() => setActive(null)} />
          ))}
        </svg>
      )}
      <ChartTooltip visible={!!cur} x={cur ? x(cur.mixPct) : 0} y={cur ? y(cur.contributionPerItem) : 0} containerWidth={width}>
        {cur && (
          <>
            <p className="mb-1 font-semibold">{cur.name}</p>
            <TooltipRow label="กำไรต่อจาน" value={format(cur.contributionPerItem)} />
            <TooltipRow label="ขายไป" value={`${cur.qty.toLocaleString("th-TH")} จาน`} />
            <p className="mt-1 text-xs text-ink-3">
              {MENU_CLASS_COPY[cur.class].emoji} {MENU_CLASS_COPY[cur.class].th}
            </p>
          </>
        )}
      </ChartTooltip>
    </div>
  );
}
