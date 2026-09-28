"use client";

import { formatThaiDate } from "@sabai/domain";
import { motion } from "motion/react";
import { useState, type KeyboardEvent, type PointerEvent } from "react";
import { axisBaht, ChartTooltip, niceTicks, TooltipRow, useWidth } from "./chart-kit";

export interface TrendSeries {
  key: string;
  label: string;
  color: string;
}

/**
 * Daily trend on ONE axis (both series are baht). 2px lines, crosshair +
 * tooltip on hover, arrow keys move the crosshair, direct labels at the line
 * ends (nudged apart when they would collide).
 */
export function TrendChart<T extends { date: string } & Record<string, number | string>>({
  data,
  series,
  format,
  height = 240,
  label,
}: {
  data: T[];
  series: TrendSeries[];
  format: (v: number) => string;
  height?: number;
  label: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { top: 12, right: 84, bottom: 26, left: 44 };
  const w = Math.max(width - pad.left - pad.right, 10);
  const h = height - pad.top - pad.bottom;
  const max = Math.max(1, ...data.flatMap((d) => series.map((s) => Number(d[s.key]))));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1] || 1;
  const x = (i: number) => pad.left + (data.length <= 1 ? w / 2 : (i / (data.length - 1)) * w);
  const y = (v: number) => pad.top + h - (Math.max(v, 0) / top) * h;
  const path = (key: string) => data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(Number(d[key])).toFixed(1)}`).join(" ");
  const area = (key: string) => `${path(key)} L${x(data.length - 1).toFixed(1)} ${y(0)} L${x(0).toFixed(1)} ${y(0)} Z`;
  const every = Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor(w / 64))));

  // End labels, pushed apart by at least 16px.
  const ends = series
    .map((s) => ({ s, y: y(Number(data[data.length - 1]?.[s.key] ?? 0)) }))
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i]!.y - ends[i - 1]!.y < 16) ends[i]!.y = ends[i - 1]!.y + 16;
  // …then keep the stack inside the plot, shifting it up from the baseline.
  const overflow = (ends[ends.length - 1]?.y ?? 0) - (pad.top + h);
  if (overflow > 0) for (const e of ends) e.y -= overflow;

  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const i = Math.round((px / rect.width) * (data.length - 1));
    setHover(Math.min(Math.max(i, 0), data.length - 1));
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowRight") setHover((v) => Math.min((v ?? -1) + 1, data.length - 1));
    else if (e.key === "ArrowLeft") setHover((v) => Math.max((v ?? data.length) - 1, 0));
    else if (e.key === "Escape") setHover(null);
    else return;
    e.preventDefault();
  };
  const hd = hover !== null ? data[hover] : null;
  const key = data.map((d) => d.date).join(",");

  return (
    <div ref={ref} className="relative w-full">
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={label}
          tabIndex={0}
          onKeyDown={onKey}
          onBlur={() => setHover(null)}
          className="block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.left} x2={pad.left + w} y1={y(t)} y2={y(t)} stroke="var(--viz-grid)" strokeWidth={1} />
              <text x={pad.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-ink-3 text-[11px] tabular">
                {axisBaht(t)}
              </text>
            </g>
          ))}
          {data.map((d, i) =>
            i % every === 0 || i === data.length - 1 ? (
              <text key={d.date} x={x(i)} y={height - 6} textAnchor={i === 0 ? "start" : i === data.length - 1 ? "end" : "middle"} className="fill-ink-3 text-[11px]">
                {formatThaiDate(d.date, false).replace(/ \d{4}$/, "")}
              </text>
            ) : null,
          )}
          <motion.path key={`a-${key}`} d={area(series[0]!.key)} fill={series[0]!.color} initial={{ opacity: 0 }} animate={{ opacity: 0.1 }} transition={{ duration: 0.6 }} />
          {series.map((s, si) => (
            <motion.path
              key={`${s.key}-${key}`}
              d={path(s.key)}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.9, delay: si * 0.15, ease: [0.22, 1, 0.36, 1] }}
            />
          ))}
          {ends.map(({ s, y: ly }) => (
            <g key={s.key}>
              <circle cx={x(data.length - 1)} cy={y(Number(data[data.length - 1]?.[s.key] ?? 0))} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
              <text x={x(data.length - 1) + 10} y={ly} dy="0.32em" className="fill-ink-2 text-[12px] font-medium">
                {s.label}
              </text>
            </g>
          ))}
          {hover !== null && hd && (
            <g pointerEvents="none">
              <line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={pad.top + h} stroke="var(--ink-3)" strokeWidth={1} strokeDasharray="3 3" />
              {series.map((s) => (
                <circle key={s.key} cx={x(hover)} cy={y(Number(hd[s.key]))} r={5} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
              ))}
            </g>
          )}
          <rect x={pad.left} y={pad.top} width={w} height={h} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} style={{ touchAction: "pan-y" }} />
        </svg>
      )}
      <ChartTooltip visible={hover !== null && !!hd} x={hover !== null ? x(hover) : 0} y={hd ? y(Number(hd[series[0]!.key])) : 0} containerWidth={width}>
        {hd && (
          <>
            <p className="mb-1 font-semibold text-ink">{formatThaiDate(hd.date)}</p>
            {series.map((s) => (
              <TooltipRow key={s.key} color={s.color} shape="line" label={s.label} value={format(Number(hd[s.key]))} />
            ))}
          </>
        )}
      </ChartTooltip>
    </div>
  );
}
