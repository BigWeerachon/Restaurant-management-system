"use client";

import { addDays, formatThaiDate, MENU_CLASS_COPY, percentChange, type MenuClass } from "@sabai/domain";
import { Download, Lightbulb, TrendingDown, TrendingUp } from "lucide-react";
import { motion } from "motion/react";
import { useMemo, useState } from "react";
import { LoadBanner } from "@/components/app/load-banner";
import { PageHeader } from "@/components/app/page-header";
import { CHANNEL_SEGMENTS, ChannelMix, HourColumns, RankBars, Waterfall } from "@/components/charts/bars";
import { ChartCard, DataTable, Legend } from "@/components/charts/chart-kit";
import { MenuMatrix } from "@/components/charts/menu-matrix";
import { TrendChart } from "@/components/charts/trend-chart";
import { Button } from "@/components/ui/button";
import { AnimatedNumber, EmptyState, Skeleton } from "@/components/ui/feedback";
import { Card, Segmented } from "@/components/ui/primitives";
import { useReportSummary } from "@/hooks/use-data-source";
import { useAccess, useBusinessDate } from "@/hooks/use-sabai";
import { cn } from "@/lib/cn";
import { emptyReportSummary } from "@/lib/data-source/live-mappers";
import { formatBaht } from "@/lib/demo/selectors";
import { useSabai } from "@/lib/demo/store";

type Preset = "today" | "7d" | "30d";
const money = (v: number) => formatBaht(v, { compact: true });
const pct = (v: number, d = 0) => `${(v * 100).toFixed(d)}%`;

function Section({ q, title, children }: { q: string; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4" aria-labelledby={`q-${q}`}>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-brand">{q}</p>
        <h2 id={`q-${q}`} className="text-xl font-semibold text-ink">
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-surface-2 p-3">
      <p className="text-xs text-ink-3">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular text-ink">{value}</p>
      {sub && <p className="text-xs text-ink-3">{sub}</p>}
    </div>
  );
}

function Delta({ current, previous, label }: { current: number; previous: number | null; label: string }) {
  if (previous === null) return null;
  const pc = percentChange(current, previous);
  if (pc === null) return null;
  const up = pc >= 0;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-sm font-medium", up ? "bg-success-soft text-success" : "bg-danger-soft text-danger")}>
      {up ? <TrendingUp className="h-4 w-4" aria-hidden="true" /> : <TrendingDown className="h-4 w-4" aria-hidden="true" />}
      {up ? "+" : ""}
      {pct(pc)} <span className="font-normal">{label}</span>
    </span>
  );
}

function downloadCsv(name: string, rows: (string | number)[][]) {
  const csv = "﻿" + rows.map((r) => r.map((c) => (typeof c === "string" && /[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ReportsPage() {
  const db = useSabai((s) => s.db);
  const { can, branches } = useAccess();
  const today = useBusinessDate();
  const [preset, setPreset] = useState<Preset>(db.mode === "fresh" ? "today" : "7d");
  const [branchId, setBranchId] = useState<string>(branches.length > 1 ? "all" : (branches[0]?.id ?? "all"));
  const showProfit = can("reports.profit");

  // Multi-day ranges end yesterday: only complete days, so trends and
  // comparisons are fair (today's partial day lives under "วันนี้").
  const range = useMemo(() => {
    if (preset === "today") return { from: today, to: today, days: 1 };
    const days = preset === "7d" ? 7 : 30;
    return { from: addDays(today, -days), to: addDays(today, -1), days };
  }, [preset, today]);
  const bid = branchId === "all" ? null : branchId;
  const query = useReportSummary({ from: range.from, to: range.to, branchId: bid ?? undefined });
  // Previous period only where the history fully covers it (a fair comparison).
  const prevQuery = useReportSummary(preset === "7d" ? { from: addDays(range.from, -7), to: addDays(range.to, -7), branchId: bid ?? undefined } : null);
  const prev = prevQuery.data ?? null;
  // Until the first answer arrives the page is laid out with an empty report, and says it is still loading.
  const r = useMemo(() => query.data ?? emptyReportSummary(range), [query.data, range]);

  const profit = r.waterfall[r.waterfall.length - 1]!;
  const foodPct = r.totals.netSales ? r.totals.cost / r.totals.netSales : 0;
  const channels = r.channels.map((c) => ({ id: c.channelId, name: c.name, orders: c.orders, netSales: c.netSales, cost: c.cost, fees: c.commission + c.paymentFees, contribution: c.contribution, shareOfSales: c.shareOfSales }));
  const bestCh = [...channels].sort((a, b) => b.contribution / (b.netSales || 1) - a.contribution / (a.netSales || 1));
  const menuName = (id: string) => db.menuItems.find((m) => m.id === id);
  const byClass = (cls: MenuClass) => r.items.filter((i) => i.class === cls);
  const rangeLabel = preset === "today" ? formatThaiDate(today) : `${formatThaiDate(range.from, false)} – ${formatThaiDate(range.to, false)}`;
  const empty = r.totals.orders === 0;
  const waiting = !query.data;

  return (
    <div className="space-y-10">
      <PageHeader
        title="รายงาน"
        description="ตอบ 4 คำถามของเจ้าของร้าน: เหลือเงินจริงเท่าไร · ผ่านช่องทางไหน · อะไรขายดี · ขายที่ไหน เมื่อไร"
        actions={
          !empty && (
            <Button
              variant="secondary"
              icon={<Download className="h-4 w-4" />}
              onClick={() =>
                downloadCsv(`sabai-report-${range.from}-${range.to}.csv`, [
                  ["วันที่", "ยอดขายสุทธิ (บาท)", "กำไรขั้นต้น (บาท)", "จำนวนบิล"],
                  ...r.days.map((d) => [d.date, d.netSales / 100, showProfit ? d.contribution / 100 : "", d.orders]),
                ])
              }
            >
              ดาวน์โหลด CSV
            </Button>
          )
        }
      />

      {/* Filters — one row above every chart */}
      <div className="-mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Segmented
          label="ช่วงเวลา"
          value={preset}
          onChange={setPreset}
          options={[
            { value: "today", label: "วันนี้" },
            { value: "7d", label: "7 วันล่าสุด" },
            { value: "30d", label: "30 วันล่าสุด" },
          ]}
        />
        {branches.length > 1 && <Segmented label="สาขา" value={branchId} onChange={setBranchId} options={[{ value: "all", label: "ทุกสาขา" }, ...branches.map((b) => ({ value: b.id, label: b.name.replace(/^สาขา/, "") }))]} />}
        <p className="text-sm text-ink-3 sm:ml-auto">
          {rangeLabel}
          {preset !== "today" && <span className="block text-xs sm:text-right">นับเฉพาะวันที่จบแล้ว</span>}
        </p>
      </div>

      <LoadBanner state={query} />

      {waiting ? (
        <Card className="space-y-4 p-6" aria-busy={query.loading}>
          <Skeleton className="h-8 w-1/3" />
          <Skeleton className="h-40 w-full" />
        </Card>
      ) : empty ? (
        <Card>
          <EmptyState
            emoji="📊"
            title="ยังไม่มียอดขายในช่วงนี้"
            description="เมื่อเริ่มขาย รายงานจะคำนวณให้อัตโนมัติ ทั้งกำไรจริง ช่องทาง และเมนูขายดี — ไม่ต้องทำบัญชีเอง"
            action={preset !== "today" ? <Button variant="secondary" onClick={() => setPreset("today")}>ดูยอดของวันนี้</Button> : undefined}
          />
        </Card>
      ) : (
        <>
          {showProfit && (
            <Section q="คำถามที่ 1" title="สุดท้ายเหลือเงินจริงเท่าไร">
              <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
                <Card className="relative overflow-hidden p-6">
                  <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-brand-soft opacity-70 blur-2xl" aria-hidden="true" />
                  <p className="relative text-sm font-medium text-ink-3">เหลือเงินจริง</p>
                  <motion.p key={`${preset}-${branchId}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className={cn("relative mt-1 text-5xl font-bold tracking-tight tabular", profit.value < 0 ? "text-danger" : "text-ink")}>
                    <AnimatedNumber value={profit.value} format={(v) => formatBaht(Math.round(v), { compact: true })} />
                  </motion.p>
                  <p className="relative mt-2 flex flex-wrap items-center gap-2 text-[15px] text-ink-2">
                    คิดเป็น <strong className="text-ink">{pct(profit.pctOfSales, 1)}</strong> ของยอดขาย
                    <Delta current={profit.value} previous={prev ? prev.waterfall[prev.waterfall.length - 1]!.value : null} label="เทียบ 7 วันก่อน" />
                  </p>
                  <div className="relative mt-5 grid grid-cols-2 gap-2">
                    <Stat label="ยอดขายสุทธิ (ไม่รวม VAT)" value={money(r.totals.netSales)} sub={prev && <Delta current={r.totals.netSales} previous={prev.totals.netSales} label="" />} />
                    <Stat label="จำนวนบิล" value={r.totals.orders.toLocaleString("th-TH")} sub={`เฉลี่ย ${money(r.totals.avgTicket)} / บิล`} />
                    <Stat label="ต้นทุนวัตถุดิบ" value={pct(foodPct, 1)} sub={foodPct <= 0.35 ? "อยู่ในเกณฑ์ดี (≤35%)" : "สูงกว่าเกณฑ์ 35%"} />
                    <Stat label="ค่า GP เดลิเวอรี" value={money(r.totals.commission)} sub={`${pct(r.totals.netSales ? r.totals.commission / r.totals.netSales : 0, 1)} ของยอดขาย`} />
                  </div>
                </Card>
                <ChartCard
                  title="จากยอดขาย เหลือเป็นเงินจริงได้อย่างไร"
                  description="แตะหรือชี้ที่แต่ละแถวเพื่อดูว่ามาจากไหน"
                  legend={<Legend items={[{ label: "ยอดรวม", color: "var(--series-1)" }, { label: "รายการที่หักออก", color: "var(--series-neg)" }]} />}
                  chart={<Waterfall steps={r.waterfall} format={(v) => formatBaht(v, { compact: true })} />}
                  table={<DataTable columns={[{ label: "รายการ" }, { label: "บาท", align: "right" }, { label: "% ยอดขาย", align: "right" }]} rows={r.waterfall.map((s) => [s.label, formatBaht(s.value), pct(s.pctOfSales, 1)])} />}
                />
              </div>
            </Section>
          )}

          <Section q={showProfit ? "คำถามที่ 2" : "คำถามที่ 1"} title="ขายผ่านช่องทางไหน และช่องทางไหนเหลือเงินจริง">
            {range.days > 1 && (
              <ChartCard
                title="ยอดขายรายวัน"
                description={showProfit ? "เส้นล่างคือส่วนที่เหลือหลังหักต้นทุนวัตถุดิบ GP และค่าธรรมเนียม" : undefined}
                legend={<Legend items={[{ label: "ยอดขายสุทธิ", color: "var(--series-1)", shape: "line" }, ...(showProfit ? [{ label: "กำไรขั้นต้น", color: "var(--series-2)", shape: "line" as const }] : [])]} />}
                chart={
                  <TrendChart
                    label={`ยอดขายรายวัน ${rangeLabel}`}
                    data={r.days.map((d) => ({ date: d.date, sales: d.netSales, keep: d.contribution }))}
                    series={[{ key: "sales", label: "ยอดขาย", color: "var(--series-1)" }, ...(showProfit ? [{ key: "keep", label: "กำไรขั้นต้น", color: "var(--series-2)" }] : [])]}
                    format={(v) => formatBaht(v, { compact: true })}
                  />
                }
                table={<DataTable columns={[{ label: "วันที่" }, { label: "ยอดขายสุทธิ", align: "right" }, ...(showProfit ? [{ label: "กำไรขั้นต้น", align: "right" as const }] : []), { label: "บิล", align: "right" }]} rows={r.days.map((d) => [formatThaiDate(d.date, false), formatBaht(d.netSales), ...(showProfit ? [formatBaht(d.contribution)] : []), d.orders])} />}
              />
            )}
            <div className="grid gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
              <ChartCard
                title="แต่ละช่องทาง เหลือเงินกี่เปอร์เซ็นต์"
                description="แท่งเต็มคือยอดขายของช่องทางนั้น แบ่งเป็นส่วนที่เหลือ ต้นทุนวัตถุดิบ และค่า GP/ธรรมเนียม"
                legend={<Legend items={CHANNEL_SEGMENTS.map((s) => ({ label: s.label, color: s.color }))} />}
                chart={<ChannelMix rows={channels} format={(v) => formatBaht(v, { compact: true })} />}
                table={<DataTable columns={[{ label: "ช่องทาง" }, { label: "บิล", align: "right" }, { label: "ยอดขาย", align: "right" }, { label: "ต้นทุน", align: "right" }, { label: "GP+ค่าธรรมเนียม", align: "right" }, { label: "เหลือ", align: "right" }]} rows={channels.map((c) => [c.name, c.orders, formatBaht(c.netSales), formatBaht(c.cost), formatBaht(c.fees), `${formatBaht(c.contribution)} (${pct(c.contribution / (c.netSales || 1))})`])} />}
              />
              <Card className="space-y-4 p-5">
                <p className="flex items-center gap-2 font-semibold text-ink">
                  <Lightbulb className="h-5 w-5 text-accent" aria-hidden="true" /> สิ่งที่ระบบสังเกตเห็น
                </p>
                <ul className="space-y-3 text-[15px] leading-relaxed text-ink-2">
                  {bestCh.length >= 2 && (
                    <li>
                      ขายผ่าน <strong className="text-ink">{bestCh[0]!.name}</strong> 100 บาท เหลือ <strong className="text-ink">{Math.round((bestCh[0]!.contribution / (bestCh[0]!.netSales || 1)) * 100)} บาท</strong> แต่ผ่าน <strong className="text-ink">{bestCh[bestCh.length - 1]!.name}</strong> เหลือเพียง <strong className="text-ink">{Math.round((bestCh[bestCh.length - 1]!.contribution / (bestCh[bestCh.length - 1]!.netSales || 1)) * 100)} บาท</strong>
                    </li>
                  )}
                  {r.totals.commission > 0 && (
                    <li>
                      ช่วงนี้จ่ายค่า GP ไป <strong className="text-ink">{money(r.totals.commission)}</strong> — ลองชวนลูกค้าประจำสั่งผ่าน LINE ของร้านหรือรับเองที่ร้าน เพื่อเก็บส่วนต่างนี้ไว้
                    </li>
                  )}
                  {r.items[0] && (
                    <li>
                      เมนูขายดีอันดับ 1 คือ <strong className="text-ink">{menuName(r.items[0].menuItemId)?.emoji} {r.items[0].name}</strong> ({r.items[0].qty.toLocaleString("th-TH")} จาน)
                    </li>
                  )}
                  {byClass("plowhorse").length > 0 && (
                    <li>
                      <strong className="text-ink">{byClass("plowhorse").slice(0, 2).map((i) => i.name).join(" และ ")}</strong> ขายดีแต่กำไรต่อจานต่ำ — ขึ้นราคา 5–10 บาทจะเพิ่มกำไรได้ทันที
                    </li>
                  )}
                </ul>
              </Card>
            </div>
          </Section>

          <Section q={showProfit ? "คำถามที่ 3" : "คำถามที่ 2"} title="อะไรขายดี และอะไรทำกำไร">
            <div className="grid gap-4 lg:grid-cols-2">
              <ChartCard
                title="เมนูขายดี 8 อันดับ"
                description="เรียงตามยอดขาย"
                chart={
                  <RankBars
                    format={(v) => formatBaht(v, { compact: true })}
                    rows={r.items.slice(0, 8).map((i) => ({
                      id: i.menuItemId,
                      label: `${menuName(i.menuItemId)?.emoji ?? ""} ${i.name}`,
                      value: i.sales,
                      detail: `${i.qty.toLocaleString("th-TH")} จาน${showProfit ? ` · กำไร ${formatBaht(i.contributionPerItem)}/จาน` : ""}`,
                      tip: (
                        <>
                          <p className="font-semibold">{i.name}</p>
                          <p className="text-xs text-ink-3">{pct(i.mixPct, 1)} ของจำนวนจานที่ขาย</p>
                        </>
                      ),
                    }))}
                  />
                }
                table={<DataTable columns={[{ label: "เมนู" }, { label: "จาน", align: "right" }, { label: "ยอดขาย", align: "right" }, ...(showProfit ? [{ label: "กำไร/จาน", align: "right" as const }] : [])]} rows={r.items.map((i) => [i.name, i.qty, formatBaht(i.sales), ...(showProfit ? [formatBaht(i.contributionPerItem)] : [])])} />}
              />
              {showProfit && (
                <ChartCard
                  title="แผนภาพเมนู"
                  description="ขายบ่อยแค่ไหน × กำไรต่อจานเท่าไร — เส้นประคือค่าเฉลี่ยของร้าน"
                  chart={<MenuMatrix items={r.items} format={(v) => formatBaht(v)} />}
                  table={<DataTable columns={[{ label: "เมนู" }, { label: "กลุ่ม" }, { label: "สัดส่วนการขาย", align: "right" }, { label: "กำไร/จาน", align: "right" }]} rows={r.items.map((i) => [i.name, `${MENU_CLASS_COPY[i.class].emoji} ${MENU_CLASS_COPY[i.class].th}`, pct(i.mixPct, 1), formatBaht(i.contributionPerItem)])} />}
                />
              )}
            </div>
            {showProfit && (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {(["star", "plowhorse", "puzzle", "dog"] as MenuClass[]).map((cls, i) => {
                  const list = byClass(cls);
                  return (
                    <motion.div key={cls} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
                      <Card className="h-full p-4">
                        <p className="font-semibold text-ink">
                          <span aria-hidden="true">{MENU_CLASS_COPY[cls].emoji}</span> {MENU_CLASS_COPY[cls].th} <span className="font-normal text-ink-3">({list.length})</span>
                        </p>
                        <p className="mt-1 text-sm text-ink-3">{MENU_CLASS_COPY[cls].advice}</p>
                        <ul className="mt-3 space-y-1 text-sm text-ink-2">
                          {list.slice(0, 5).map((it) => (
                            <li key={it.menuItemId} className="flex justify-between gap-2">
                              <span className="truncate">{it.name}</span>
                              <span className="shrink-0 tabular text-ink-3">{formatBaht(it.contributionPerItem)}</span>
                            </li>
                          ))}
                          {list.length === 0 && <li className="text-ink-3">—</li>}
                        </ul>
                      </Card>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </Section>

          <Section q={showProfit ? "คำถามที่ 4" : "คำถามที่ 3"} title="ขายที่ไหน และขายดีช่วงไหน">
            <div className={cn("grid gap-4", !bid && r.branches.length > 1 && "lg:grid-cols-2")}>
              {!bid && r.branches.length > 1 && (
                <ChartCard
                  title="เทียบสาขา"
                  description="ยอดขายสุทธิ และสัดส่วนที่เหลือหลังหักต้นทุนขาย"
                  chart={<RankBars format={(v) => formatBaht(v, { compact: true })} rows={r.branches.map((b) => ({ id: b.id, label: b.name, value: b.netSales, detail: `${b.orders.toLocaleString("th-TH")} บิล · เฉลี่ย ${money(Math.round(b.netSales / (b.orders || 1)))}/บิล${showProfit ? ` · เหลือ ${pct(b.contribution / (b.netSales || 1))}` : ""}` }))} />}
                  table={<DataTable columns={[{ label: "สาขา" }, { label: "บิล", align: "right" }, { label: "ยอดขาย", align: "right" }, ...(showProfit ? [{ label: "เหลือ", align: "right" as const }] : [])]} rows={r.branches.map((b) => [b.name, b.orders, formatBaht(b.netSales), ...(showProfit ? [formatBaht(b.contribution)] : [])])} />}
                />
              )}
              <ChartCard
                title="จำนวนบิลตามช่วงเวลา"
                description="ใช้วางกะพนักงานและเตรียมของให้ทันช่วงพีก"
                chart={<HourColumns hours={r.hours} />}
                table={<DataTable columns={[{ label: "เวลา" }, { label: "บิล", align: "right" }]} rows={r.hours.map((n, h) => [n, h] as const).filter(([n]) => n > 0).map(([n, h]) => [`${h}:00–${h}:59`, n])} />}
              />
            </div>
          </Section>
        </>
      )}
    </div>
  );
}
