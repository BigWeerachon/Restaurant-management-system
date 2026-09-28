"use client";

import { motion } from "motion/react";

/** 14-day trend next to a KPI. The last point (today) carries the accent. */
export function Sparkline({ values, width = 120, height = 36, label }: { values: number[]; width?: number; height?: number; label: string }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const x = (i: number) => (i / (values.length - 1)) * (width - 6) + 3;
  const y = (v: number) => height - 4 - ((v - min) / (max - min || 1)) * (height - 8);
  const hist = values.slice(0, -1);
  const d = hist.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const last = values.length - 1;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="overflow-visible">
      <motion.path d={d} fill="none" stroke="var(--ink-3)" strokeOpacity={0.55} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9, ease: "easeOut" }} />
      <line x1={x(last - 1)} y1={y(values[last - 1]!)} x2={x(last)} y2={y(values[last]!)} stroke="var(--series-1)" strokeWidth={2} strokeDasharray="3 3" />
      <circle cx={x(last)} cy={y(values[last]!)} r={4} fill="var(--series-1)" stroke="var(--surface)" strokeWidth={2} />
    </svg>
  );
}
