"use client";

import { allDayCounts, elapsedSeconds, formatElapsed, URGENCY_COPY, urgency, type Urgency } from "@sabai/domain";
import { AlertTriangle, ArrowLeft, Bell, BellOff, Bike, Check, ChefHat, Clock, Flame, History, ShoppingBag, Trash2, Undo2, Utensils } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Gate, RouteGuard } from "@/components/app/gate";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { Dialog } from "@/components/ui/overlay";
import { Avatar, Segmented } from "@/components/ui/primitives";
import { useAccess, useAction, useNow, useUi } from "@/hooks/use-sabai";
import { cn } from "@/lib/cn";
import { setSoldOut, setTicketStatus, toggleTicketItem } from "@/lib/demo/engine";
import { useSabai } from "@/lib/demo/store";
import type { Ticket } from "@/lib/demo/types";

const CHANNEL_ICON = { dine_in: Utensils, takeaway: ShoppingBag, delivery_platform: Bike, own_delivery: Bike };
const URGENCY_ICON: Record<Urgency, typeof Clock> = { ok: Clock, warn: AlertTriangle, late: Flame };

function chime() {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
    o.start();
    o.stop(ctx.currentTime + 0.5);
  } catch {}
}

function TicketCard({ t, now, index, onBump, onStart, onToggle, isNew, showStation }: { t: Ticket; now: number; index: number; onBump: () => void; onStart: () => void; onToggle: (orderItemId: string) => void; isNew: boolean; showStation: boolean }) {
  const db = useSabai((s) => s.db);
  const station = db.stations.find((s) => s.id === t.stationId);
  const sec = elapsedSeconds(t.firedAt, now);
  const u = urgency(sec, { warnAfterSec: station?.warnAfterSec ?? 300, lateAfterSec: station?.lateAfterSec ?? 600 });
  const UIcon = URGENCY_ICON[u];
  const CIcon = CHANNEL_ICON[t.channelKind] ?? Utensils;
  const active = t.items.filter((i) => i.status !== "voided");
  const doneCount = active.filter((i) => i.status === "done").length;

  return (
    <motion.article
      layout
      initial={{ opacity: 0, scale: 0.92, y: 16 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9, x: 80, transition: { duration: 0.25 } }}
      transition={{ type: "spring", stiffness: 380, damping: 32 }}
      aria-label={`ออเดอร์ ${t.ticketNo} ${URGENCY_COPY[u].th} ${formatElapsed(sec)}`}
      className={cn(
        "relative flex flex-col overflow-hidden rounded-3xl border-2 bg-surface shadow-md",
        u === "late" ? "border-danger-fill" : u === "warn" ? "border-warning-fill" : "border-line-strong",
        isNew && "ring-4 ring-accent/60",
      )}
    >
      {u === "late" && <motion.span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-3xl ring-4 ring-danger-fill/40" animate={{ opacity: [0.2, 0.9, 0.2] }} transition={{ duration: 1.6, repeat: Infinity }} />}
      <header className={cn("flex items-center gap-3 px-4 py-3", u === "late" ? "bg-danger-soft" : u === "warn" ? "bg-warning-soft" : "bg-surface-2")}>
        <span className="grid h-7 min-w-7 place-items-center rounded-lg bg-surface-3 px-1.5 text-sm font-bold text-ink-2" title="กดปุ่มตัวเลขนี้บนคีย์บอร์ด/บัมพ์บาร์เพื่อส่ง">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-2xl font-bold leading-none tracking-tight text-ink">#{t.ticketNo}</p>
          <p className="mt-1 flex items-center gap-1.5 truncate text-sm text-ink-2">
            <CIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
            {t.channelName}
            {t.tableName && <span className="font-semibold text-ink"> · โต๊ะ {t.tableName}</span>}
            {showStation && station && <span className="rounded-md bg-surface-3 px-1.5 text-xs font-medium text-ink-2">{station.name}</span>}
          </p>
        </div>
        <div className={cn("flex flex-col items-end", u === "late" ? "text-danger" : u === "warn" ? "text-warning" : "text-ink-2")}>
          <span className="flex items-center gap-1 text-2xl font-bold tabular">
            <UIcon className="h-5 w-5" aria-hidden="true" />
            {formatElapsed(sec)}
          </span>
          <span className="text-xs font-semibold">{URGENCY_COPY[u].th}</span>
        </div>
      </header>

      <ul className="flex-1 space-y-1 p-3">
        {t.items.map((i) => {
          const voided = i.status === "voided";
          const done = i.status === "done";
          return (
            <li key={i.orderItemId}>
              <button
                type="button"
                disabled={voided}
                onClick={() => onToggle(i.orderItemId)}
                aria-pressed={done}
                className={cn("flex w-full items-start gap-3 rounded-2xl px-2 py-2 text-left transition-colors", voided ? "bg-danger-soft" : "hover:bg-surface-2")}
              >
                <span className={cn("grid h-9 min-w-9 place-items-center rounded-xl text-xl font-bold tabular", done ? "bg-success-soft text-success" : "bg-surface-3 text-ink")}>
                  {done ? <Check className="h-5 w-5" aria-hidden="true" /> : i.qty}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn("block text-xl font-semibold leading-snug", voided ? "text-danger line-through" : done ? "text-ink-3 line-through" : "text-ink")}>{i.name}</span>
                  {voided && <span className="mt-0.5 inline-block rounded-md bg-danger-fill px-1.5 text-sm font-bold text-white">ยกเลิกแล้ว — ไม่ต้องทำ</span>}
                  {i.modifiers && !voided && <span className="block text-base font-medium text-accent">{i.modifiers}</span>}
                  {i.note && !voided && (
                    <span className="mt-1 inline-flex items-center gap-1 rounded-lg bg-warning-soft px-2 py-0.5 text-base font-semibold text-warning">
                      <AlertTriangle className="h-4 w-4" aria-hidden="true" /> {i.note}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <footer className="border-t border-line p-3">
        {t.status === "new" ? (
          <Button size="xl" variant="secondary" block onClick={onStart} icon={<ChefHat className="h-5 w-5" />}>
            เริ่มทำ
          </Button>
        ) : (
          <Button size="xl" block onClick={onBump} icon={<Check className="h-6 w-6" />}>
            เสร็จแล้ว {active.length > 1 && <span className="text-base font-normal opacity-80">({doneCount}/{active.length})</span>}
          </Button>
        )}
      </footer>
    </motion.article>
  );
}

function KdsScreen() {
  const db = useSabai((s) => s.db);
  const { branch, member, can, nav } = useAccess();
  const { exec } = useAction();
  const now = useNow(1000).getTime();
  const openSwitch = useUi((s) => s.setSwitchUserOpen);
  const [station, setStation] = useState<string>("all");
  const [sound, setSound] = useState(true);
  const [recallOpen, setRecallOpen] = useState(false);
  const [soldOutOpen, setSoldOutOpen] = useState(false);
  const seen = useRef<Set<string>>(new Set());
  const [fresh, setFresh] = useState<Set<string>>(new Set());

  const stations = db.stations.filter((s) => s.branchId === branch.id);
  const tickets = useMemo(
    () =>
      db.tickets
        .filter((t) => t.branchId === branch.id && (t.status === "new" || t.status === "in_progress") && (station === "all" || t.stationId === station))
        .sort((a, b) => a.firedAt.localeCompare(b.firedAt)),
    [db.tickets, branch.id, station],
  );
  const recent = db.tickets.filter((t) => t.branchId === branch.id && t.status === "ready" && t.readyAt && now - Date.parse(t.readyAt) < 15 * 60_000).sort((a, b) => (b.readyAt ?? "").localeCompare(a.readyAt ?? "")).slice(0, 8);
  const counts = allDayCounts(tickets.flatMap((t) => t.items.map((i) => ({ name: i.name, qty: i.qty, done: i.status === "done", voided: i.status === "voided" }))));
  const late = tickets.filter((t) => {
    const st = db.stations.find((s) => s.id === t.stationId);
    return urgency(elapsedSeconds(t.firedAt, now), { warnAfterSec: st?.warnAfterSec ?? 300, lateAfterSec: st?.lateAfterSec ?? 600 }) === "late";
  }).length;

  // Highlight and (optionally) chime for tickets that arrive while the screen is open.
  useEffect(() => {
    const incoming = tickets.filter((t) => !seen.current.has(t.id));
    if (seen.current.size > 0 && incoming.length > 0) {
      if (sound) chime();
      setFresh((f) => new Set([...f, ...incoming.map((t) => t.id)]));
      setTimeout(() => setFresh((f) => new Set([...f].filter((id) => !incoming.some((t) => t.id === id)))), 4000);
    }
    tickets.forEach((t) => seen.current.add(t.id));
  }, [tickets, sound]);

  const bump = useCallback(
    async (t: Ticket) => {
      const r = await exec((d, c) => setTicketStatus(d, c, t.id, "ready"));
      if (r.ok) {
        toast.success(`#${t.ticketNo} เสร็จแล้ว`, {
          description: t.tableName ? `เสิร์ฟโต๊ะ ${t.tableName}` : `${t.channelName} · รอลูกค้า/ไรเดอร์`,
          action: { label: "เรียกคืน", onClick: () => void exec((d, c) => setTicketStatus(d, c, t.id, "in_progress")) },
        });
      }
    },
    [exec],
  );

  // Bump bar / keyboard: 1–9 finishes the Nth ticket, R recalls the last one.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey) return;
      const n = Number(e.key);
      if (n >= 1 && n <= 9 && tickets[n - 1]) {
        const t = tickets[n - 1]!;
        if (t.status === "new") void exec((d, c) => setTicketStatus(d, c, t.id, "in_progress"));
        else void bump(t);
      }
      if (e.key.toLowerCase() === "r" && recent[0]) void exec((d, c) => setTicketStatus(d, c, recent[0]!.id, "in_progress"));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tickets, recent, bump, exec]);

  const clock = new Date(now).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
  const hasHome = nav.primary.some((n) => n.key !== "kds");

  return (
    <div className="kds flex h-dvh flex-col bg-bg text-ink">
      <header className="flex h-[72px] shrink-0 items-center gap-3 border-b border-line bg-surface px-4">
        {hasHome && (
          <Link href={nav.primary.find((n) => n.key !== "kds")?.href ?? "/"} className="grid h-12 w-12 place-items-center rounded-xl text-ink-2 hover:bg-surface-2" aria-label="กลับหน้าหลัก">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        )}
        <div className="flex items-center gap-2">
          <ChefHat className="h-7 w-7 text-brand" aria-hidden="true" />
          <h1 className="text-xl font-bold">จอครัว</h1>
        </div>
        <Segmented label="สถานี" value={station} onChange={setStation} size="lg" className="ml-2 hidden md:inline-flex" options={[{ value: "all", label: "ทั้งหมด" }, ...stations.map((s) => ({ value: s.id, label: s.name }))]} />
        <div className="ml-auto flex items-center gap-2">
          <div className="hidden items-center gap-4 rounded-2xl bg-surface-2 px-4 py-2 text-sm lg:flex" aria-live="polite">
            <span>
              รอทำ <strong className="text-lg tabular">{tickets.filter((t) => t.status === "new").length}</strong>
            </span>
            <span>
              กำลังทำ <strong className="text-lg tabular">{tickets.filter((t) => t.status === "in_progress").length}</strong>
            </span>
            <span className={late ? "text-danger" : ""}>
              เกินเวลา <strong className="text-lg tabular">{late}</strong>
            </span>
          </div>
          <Button variant="secondary" size="lg" onClick={() => setRecallOpen(true)} icon={<History className="h-5 w-5" />} aria-label="เรียกคืนออเดอร์ที่ส่งแล้ว">
            <span className="hidden sm:inline">เรียกคืน</span>
          </Button>
          {can("menu.availability") && (
            <Button variant="secondary" size="lg" onClick={() => setSoldOutOpen(true)}>
              ของหมด
            </Button>
          )}
          {can("inventory.waste") && (
            <Link href="/inventory/waste" className="hidden h-12 items-center gap-2 rounded-xl border border-line px-4 font-medium text-ink hover:bg-surface-2 sm:flex">
              <Trash2 className="h-5 w-5" aria-hidden="true" /> ของเสีย
            </Link>
          )}
          <Button variant="ghost" size="icon-lg" onClick={() => setSound((v) => !v)} aria-label={sound ? "ปิดเสียงแจ้งเตือน" : "เปิดเสียงแจ้งเตือน"} aria-pressed={sound}>
            {sound ? <Bell className="h-6 w-6" /> : <BellOff className="h-6 w-6" />}
          </Button>
          <span className="hidden text-2xl font-semibold tabular text-ink-2 xl:block">{clock}</span>
          <button onClick={() => openSwitch(true)} className="rounded-xl p-1 hover:bg-surface-2" aria-label={`ผู้ใช้ ${member?.name} แตะเพื่อสลับผู้ใช้`}>
            <Avatar name={member?.name ?? "?"} color={member?.color} size={40} />
          </button>
        </div>
      </header>

      {counts.length > 0 && (
        <div className="no-scrollbar flex shrink-0 items-center gap-2 overflow-x-auto border-b border-line bg-surface px-4 py-2 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" role="region" tabIndex={0} aria-label="รวมทุกออเดอร์ที่ต้องทำ">
          <span className="shrink-0 text-sm font-medium text-ink-3">รวมที่ต้องทำ</span>
          {counts.map((c) => (
            <span key={c.name} className="shrink-0 rounded-full bg-surface-2 px-3 py-1 text-[15px] text-ink">
              {c.name} <strong className="tabular">×{c.qty}</strong>
            </span>
          ))}
        </div>
      )}

      <main className="min-h-0 flex-1 overflow-y-auto p-4 scrollbar-thin">
        {tickets.length === 0 ? (
          <EmptyState emoji="👩‍🍳" title="ไม่มีออเดอร์ค้าง เยี่ยมมาก!" description="ออเดอร์ใหม่จะเด้งขึ้นที่นี่พร้อมเสียงเตือน เรียงจากเก่าไปใหม่ ใช้ปุ่มตัวเลข 1–9 หรือแตะ “เสร็จแล้ว” เพื่อส่ง" />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] items-start gap-4">
            <AnimatePresence mode="popLayout">
              {tickets.map((t, i) => (
                <TicketCard
                  key={t.id}
                  t={t}
                  now={now}
                  index={i}
                  isNew={fresh.has(t.id)}
                  showStation={station === "all"}
                  onBump={() => void bump(t)}
                  onStart={() => void exec((d, c) => setTicketStatus(d, c, t.id, "in_progress"))}
                  onToggle={(itemId) => void exec((d, c) => toggleTicketItem(d, c, t.id, itemId))}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </main>

      <Dialog open={recallOpen} onOpenChange={setRecallOpen} title="เรียกคืนออเดอร์" description="กดเสร็จผิด? แตะเพื่อดึงกลับขึ้นจอ (ย้อนหลัง 15 นาที)" size="md">
        {recent.length === 0 ? (
          <EmptyState compact emoji="↩️" title="ยังไม่มีออเดอร์ที่เพิ่งเสร็จ" />
        ) : (
          <ul className="space-y-2 pb-3">
            {recent.map((t) => (
              <li key={t.id} className="flex items-center gap-3 rounded-2xl border border-line p-3">
                <span className="text-xl font-bold">#{t.ticketNo}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-ink-2">{t.items.map((i) => `${i.qty}× ${i.name}`).join(", ")}</span>
                <Button
                  variant="secondary"
                  icon={<Undo2 className="h-4 w-4" />}
                  onClick={async () => {
                    const r = await exec((d, c) => setTicketStatus(d, c, t.id, "in_progress"), { success: `ดึง #${t.ticketNo} กลับขึ้นจอแล้ว` });
                    if (r.ok) setRecallOpen(false);
                  }}
                >
                  เรียกคืน
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Dialog>

      <Dialog open={soldOutOpen} onOpenChange={setSoldOutOpen} title="ของหมด" description="ปิดเมนูที่ทำไม่ได้แล้ว หน้าขายทุกเครื่องจะเห็นทันที" size="lg">
        <ul className="grid gap-2 pb-3 sm:grid-cols-2">
          {db.menuItems.map((m) => {
            const out = !!m.soldOut[branch.id];
            return (
              <li key={m.id}>
                <button onClick={() => void exec((d, c) => setSoldOut(d, c, m.id, !out), { success: out ? `เปิดขาย ${m.name}` : `ปิดขาย ${m.name}` })} aria-pressed={out} className={cn("flex h-14 w-full items-center gap-3 rounded-2xl border-2 px-3 text-left text-[15px] font-medium", out ? "border-danger-fill bg-danger-soft text-danger" : "border-line text-ink hover:border-line-strong")}>
                  <span className="text-2xl" aria-hidden="true">
                    {m.emoji}
                  </span>
                  <span className="flex-1">{m.name}</span>
                  <span className="text-sm">{out ? "หมด" : "มีขาย"}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </Dialog>
    </div>
  );
}

export default function KdsPage() {
  return (
    <Gate>
      <RouteGuard>
        <KdsScreen />
      </RouteGuard>
    </Gate>
  );
}
