"use client";

import { formatThaiDate, percentChange, quickActionsFor, urgency, elapsedSeconds } from "@sabai/domain";
import { ArrowRight, BellRing, ChefHat, CircleAlert, Flame, PartyPopper, TrendingDown, TrendingUp } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { LoadBanner } from "@/components/app/load-banner";
import { PageHeader } from "@/components/app/page-header";
import { Sparkline } from "@/components/charts/sparkline";
import { LinkButton } from "@/components/ui/button";
import { AnimatedNumber, EmptyState, ProgressRing } from "@/components/ui/feedback";
import { Icon } from "@/components/ui/icon";
import { Avatar, Badge, Card, CardHeader } from "@/components/ui/primitives";
import { useLoad, useTodayStats } from "@/hooks/use-data-source";
import { useAccess, useBusinessDate, useNow } from "@/hooks/use-sabai";
import { cn } from "@/lib/cn";
import { actorName } from "@/lib/demo/engine";
import { alerts, formatBaht, onboarding } from "@/lib/demo/selectors";
import { useSabai } from "@/lib/demo/store";

/** What the tiles hold until the first answer arrives (they show a dash, not these zeros). */
const EMPTY_STATS = { today: "", sales: 0, orders: 0, avgTicket: 0, keep: 0, keepPct: 0, lastWeekSales: 0, lastWeekOrders: 0, spark: [] as number[], open: 0 };

function greeting(h: number) {
  if (h < 11) return "สวัสดีตอนเช้า";
  if (h < 14) return "สวัสดีตอนเที่ยง";
  if (h < 18) return "สวัสดีตอนบ่าย";
  return "สวัสดีตอนเย็น";
}

function Delta({ current, previous, label }: { current: number; previous: number; label: string }) {
  const pc = percentChange(current, previous);
  if (pc === null || previous === 0) return <span className="text-xs text-ink-3">{label}</span>;
  const up = pc >= 0;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium", up ? "text-success" : "text-danger")}>
      {up ? <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" /> : <TrendingDown className="h-3.5 w-3.5" aria-hidden="true" />}
      {up ? "+" : ""}
      {(pc * 100).toFixed(0)}% <span className="font-normal text-ink-3">{label}</span>
    </span>
  );
}

export default function TodayPage() {
  const db = useSabai((s) => s.db);
  const { member, branch, can, access } = useAccess();
  const now = useNow(30_000);
  const date = useBusinessDate();
  // The alerts below are worked out from what the shop holds, so the home page asks for everything they read
  // (the loader skips whatever this person may not see).
  const load = useLoad(["orders", "tickets", "stock", "purchasing", "finance", "reports", "onboarding"]);
  const query = useTodayStats(branch.id, now);
  const stats = query.data ?? EMPTY_STATS;
  const ready = !!query.data;
  const todo = alerts(db, branch.id, date, now);
  const setup = onboarding(db);
  const tickets = db.tickets.filter((t) => t.branchId === branch.id && (t.status === "new" || t.status === "in_progress"));
  const late = tickets.filter((t) => {
    const st = db.stations.find((s) => s.id === t.stationId);
    return urgency(elapsedSeconds(t.firedAt, now.getTime()), { warnAfterSec: st?.warnAfterSec ?? 300, lateAfterSec: st?.lateAfterSec ?? 600 }) === "late";
  });
  const actions = quickActionsFor(access);
  const feed = db.activity.filter((a) => !a.branchId || a.branchId === branch.id).slice(0, 7);
  const noSales = ready && stats.orders === 0 && db.mode === "fresh";

  return (
    <>
      <PageHeader
        eyebrow={`${formatThaiDate(date)} · ${branch.name}`}
        title={`${greeting(now.getHours())} ${member?.name ?? ""}`}
        description={noSales ? "วันนี้ยังไม่มียอดขาย เริ่มจากตั้งค่าร้านให้พร้อมแล้วขายบิลแรกกัน" : "ภาพรวมของวันนี้แบบเข้าใจง่าย ตัวเลขอัปเดตทุกครั้งที่มีการขาย"}
        actions={can("pos.order") && <LinkButton href="/pos" icon={<Icon name="store" className="h-5 w-5" />}>เปิดหน้าขาย</LinkButton>}
      />

      {!setup.isComplete && can("settings.manage") && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="mb-6 overflow-hidden">
            <div className="flex flex-col gap-5 bg-grain p-5 sm:flex-row sm:items-center sm:p-6">
              <ProgressRing value={setup.percent} size={84} stroke={8} label="ความคืบหน้าการตั้งค่าร้าน">
                <span className="text-lg font-bold text-ink">{setup.percent}%</span>
              </ProgressRing>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink-3">
                  ตั้งค่าร้านแล้ว {setup.completed} จาก {setup.total} ขั้น · เหลืออีกประมาณ {setup.minutesLeft} นาที
                </p>
                <h2 className="mt-0.5 text-xl font-semibold text-ink">ขั้นต่อไป: {setup.next?.title}</h2>
                <p className="mt-1 text-[15px] text-ink-2">{setup.next?.why}</p>
              </div>
              <div className="flex gap-2">
                <LinkButton href={setup.next?.href ?? "/setup"} size="lg" iconRight={<ArrowRight className="h-4 w-4" />}>
                  {setup.next?.cta}
                </LinkButton>
                <LinkButton href="/setup" size="lg" variant="secondary">
                  ดูทั้งหมด
                </LinkButton>
              </div>
            </div>
          </Card>
        </motion.div>
      )}

      <LoadBanner state={{ loading: load.loading || query.loading, error: load.error ?? query.error, reload: async () => { await Promise.all([load.reload(), query.reload()]); } }} className="mb-4" />

      {/* KPI tiles */}
      <section aria-label="ตัวเลขวันนี้" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: "ยอดขายวันนี้",
            value: ready ? <AnimatedNumber value={stats.sales} format={(v) => formatBaht(v, { compact: true })} /> : "—",
            foot: <Delta current={stats.sales} previous={stats.lastWeekSales} label="เทียบสัปดาห์ก่อน ณ เวลานี้" />,
            chart: stats.spark.length > 2 ? <Sparkline values={stats.spark} label="ยอดขาย 14 วันล่าสุด" /> : null,
          },
          {
            label: "จำนวนบิล",
            value: ready ? <AnimatedNumber value={stats.orders} format={(v) => v.toLocaleString("th-TH")} /> : "—",
            foot: <span className="text-xs text-ink-3">เฉลี่ย {formatBaht(stats.avgTicket, { compact: true })} ต่อบิล</span>,
          },
          ...(can("reports.profit")
            ? [
                {
                  label: "เหลือจริงจากการขายวันนี้",
                  value: ready ? <AnimatedNumber value={stats.keep} format={(v) => formatBaht(v, { compact: true })} /> : "—",
                  foot: <span className="text-xs text-ink-3">หลังหักต้นทุนวัตถุดิบ ค่า GP ค่าธรรมเนียม · {(stats.keepPct * 100).toFixed(0)}% ของยอดขาย</span>,
                },
              ]
            : []),
          {
            label: "บิลที่ยังเปิดอยู่",
            value: ready ? <AnimatedNumber value={stats.open} format={(v) => v.toLocaleString("th-TH")} /> : "—",
            foot: <Link href="/orders?status=open" className="text-xs font-medium text-brand hover:underline">ดูบิลที่เปิดอยู่ →</Link>,
          },
        ].map((k, i) => (
          <motion.div key={k.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
            <Card className="flex h-full flex-col gap-2 p-5">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium text-ink-3">{k.label}</p>
                {"chart" in k && k.chart}
              </div>
              <p className="text-[30px] font-bold leading-none tracking-tight text-ink">{k.value}</p>
              <div className="mt-auto">{k.foot}</div>
            </Card>
          </motion.div>
        ))}
      </section>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.35fr_1fr]">
        <div className="space-y-6">
          <Card as="section" aria-labelledby="todo">
            <CardHeader title={<span id="todo">สิ่งที่ควรทำตอนนี้</span>} description="เรียงจากเรื่องที่สำคัญที่สุด" icon={<BellRing className="h-5 w-5" />} />
            <div className="p-3 pt-3">
              {todo.length === 0 ? (
                <EmptyState compact emoji="🎉" title="ทุกอย่างเรียบร้อย" description="ไม่มีเรื่องที่ต้องจัดการตอนนี้ ขอให้ขายดีนะ" />
              ) : (
                <ul className="divide-y divide-line">
                  {todo.map((a, i) => (
                    <motion.li key={a.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }} className="flex items-center gap-3 px-2 py-3">
                      <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl", a.tone === "bad" ? "bg-danger-soft text-danger" : a.tone === "warn" ? "bg-warning-soft text-warning" : "bg-info-soft text-info")}>
                        <CircleAlert className="h-5 w-5" aria-hidden="true" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-ink">{a.title}</p>
                        <p className="truncate text-sm text-ink-3">{a.detail}</p>
                      </div>
                      <LinkButton href={a.href} size="sm" variant="secondary">
                        {a.cta}
                      </LinkButton>
                    </motion.li>
                  ))}
                </ul>
              )}
            </div>
          </Card>

          {actions.length > 0 && (
            <section aria-labelledby="quick">
              <h2 id="quick" className="mb-3 text-[17px] font-semibold text-ink">
                งานประจำวัน
              </h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {actions.map((a, i) => (
                  <motion.div key={a.key} initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.05 + i * 0.03 }}>
                    <Link href={a.href} className="group flex h-full flex-col gap-2 rounded-2xl border border-line bg-surface p-4 shadow-xs transition-[box-shadow,transform,border-color] hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-md">
                      <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-soft text-brand-soft-ink transition-transform group-hover:scale-105">
                        <Icon name={a.icon} className="h-5 w-5" />
                      </span>
                      <span className="font-semibold text-ink">{a.th}</span>
                      <span className="text-[13px] text-ink-3">{a.hint}</span>
                    </Link>
                  </motion.div>
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="space-y-6">
          {can("kds.view") && (
            <Card as="section" className="p-5">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-surface-2 text-ink-2">
                  <ChefHat className="h-5 w-5" aria-hidden="true" />
                </span>
                <div className="flex-1">
                  <h2 className="font-semibold text-ink">ครัวตอนนี้</h2>
                  <p className="text-sm text-ink-3">
                    กำลังทำ {tickets.length} ออเดอร์
                    {late.length > 0 && <span className="text-danger"> · เกินเวลา {late.length}</span>}
                  </p>
                </div>
                {late.length > 0 && (
                  <Badge tone="danger" icon={<Flame className="h-3.5 w-3.5" aria-hidden="true" />}>
                    ต้องเร่ง
                  </Badge>
                )}
                <LinkButton href="/kds" size="sm" variant="secondary">
                  เปิดจอครัว
                </LinkButton>
              </div>
            </Card>
          )}

          <Card as="section" aria-labelledby="feed">
            <CardHeader title={<span id="feed">ความเคลื่อนไหวล่าสุด</span>} description="ใครทำอะไร เมื่อไร — ยกเลิก ส่วนลด รับของ ของเสีย" />
            {feed.length === 0 ? (
              <EmptyState compact emoji="🗒️" title="ยังไม่มีความเคลื่อนไหว" description="ทุกการเปลี่ยนแปลงสำคัญจะขึ้นที่นี่ เจ้าของร้านตรวจย้อนหลังได้เสมอ" />
            ) : (
              <ol className="space-y-1 p-3">
                {feed.map((e) => (
                  <li key={e.id} className="flex gap-3 rounded-xl px-2 py-2">
                    <Avatar name={actorName(db, e.actorId)} color={db.members.find((m) => m.id === e.actorId)?.color} size={30} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-ink">{e.text}</p>
                      <p className="text-xs text-ink-3">
                        {new Date(e.at).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })} น.
                      </p>
                    </div>
                    {e.tone === "bad" && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-danger-fill" role="img" aria-label="สำคัญ" />}
                    {e.tone === "warn" && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-warning-fill" role="img" aria-label="ควรดู" />}
                  </li>
                ))}
              </ol>
            )}
          </Card>

          {noSales && (
            <Card className="p-2">
              <EmptyState compact emoji={<PartyPopper className="h-8 w-8 text-accent-ink" aria-hidden="true" />} title="พร้อมขายบิลแรกแล้วหรือยัง?" description="เพิ่มเมนูอย่างน้อย 1 รายการ แล้วลองขายดู ออเดอร์จะเด้งขึ้นจอครัวทันที" action={<LinkButton href="/menu/new">เพิ่มเมนูแรก</LinkButton>} />
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
