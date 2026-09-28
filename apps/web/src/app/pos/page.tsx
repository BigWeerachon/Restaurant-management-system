"use client";

import { calculateOrderTotals } from "@sabai/domain";
import { ArrowLeft, BadgePercent, Ban, ChefHat, ClipboardList, Lock, MessageSquareText, Minus, MoreVertical, Plus, ShoppingBag, Trash2, UserRoundCog, Utensils, Wallet, X } from "lucide-react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Gate, RouteGuard } from "@/components/app/gate";
import { DiscountDialog, OpenOrdersDialog, OpenShiftDialog, CloseShiftDialog, TablePicker, VoidDialog } from "@/components/pos/pos-dialogs";
import { ModifierSheet, defaultOptions, needsSheet } from "@/components/pos/modifier-sheet";
import { PaymentDialog } from "@/components/pos/payment-dialog";
import { usePos } from "@/components/pos/pos-store";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { Dialog } from "@/components/ui/overlay";
import { Avatar, Badge, SearchInput } from "@/components/ui/primitives";
import { useAccess, useAction, useUi } from "@/hooks/use-sabai";
import { cn } from "@/lib/cn";
import { modifierPrice, newId, openShiftOf, priceFor, setSoldOut, submitOrder } from "@/lib/demo/engine";
import { formatBaht } from "@/lib/demo/selectors";
import { useSabai } from "@/lib/demo/store";
import type { MenuItem, Order } from "@/lib/demo/types";

const CHANNEL_ICON: Record<string, typeof Utensils> = { dine_in: Utensils, takeaway: ShoppingBag };

function PosScreen() {
  const db = useSabai((s) => s.db);
  const { member, branch, can, nav } = useAccess();
  const pos = usePos();
  const { exec, pending } = useAction();
  const openSwitch = useUi((s) => s.setSwitchUserOpen);

  const [category, setCategory] = useState<string>("all");
  const [q, setQ] = useState("");
  const [sheetItem, setSheetItem] = useState<MenuItem | null>(null);
  const [editLine, setEditLine] = useState<string | null>(null);
  const [payOrder, setPayOrder] = useState<Order | null>(null);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [voidTarget, setVoidTarget] = useState<{ itemId?: string } | null>(null);
  const [openShiftOpen, setOpenShiftOpen] = useState(false);
  const [closeShiftOpen, setCloseShiftOpen] = useState(false);
  const [ordersOpen, setOrdersOpen] = useState(false);
  const [tablesOpen, setTablesOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [manage, setManage] = useState<MenuItem | null>(null);

  const channels = db.channels.filter((c) => c.active);
  const channel = channels.find((c) => c.id === pos.channelId) ?? channels[0];
  const shift = openShiftOf(db, branch.id);
  const existing = pos.orderId ? db.orders.find((o) => o.id === pos.orderId && o.status === "open") : undefined;
  const openCount = db.orders.filter((o) => o.branchId === branch.id && o.status === "open").length;
  const table = branch.tables.find((t) => t.id === (existing?.tableId ?? pos.tableId));

  const bestIds = useMemo(() => [...db.menuItems].sort((a, b) => b.weight - a.weight).slice(0, 8).map((m) => m.id), [db.menuItems]);
  const items = db.menuItems.filter(
    (m) => m.active && (category === "all" ? true : category === "best" ? bestIds.includes(m.id) : m.categoryId === category) && (!q || m.name.includes(q) || m.nameEn?.toLowerCase().includes(q.toLowerCase())),
  );

  // Live totals for sent items + lines still on this device (same maths as the server).
  const draftLines = pos.lines.map((l) => {
    const mi = db.menuItems.find((m) => m.id === l.menuItemId)!;
    const mods = l.modifierOptionIds.map((id) => ({ id, ...modifierPrice(db, id)! }));
    return { line: l, mi, mods, unit: priceFor(mi, channel), modsTotal: mods.reduce((s, m) => s + m.priceDelta, 0) };
  });
  const totals = calculateOrderTotals({
    lines: [
      ...(existing?.items ?? []).map((i) => ({ qty: i.qty, unitPrice: i.unitPrice, modifiersTotal: i.modifiers.reduce((s, m) => s + m.priceDelta, 0), voided: i.status === "voided" })),
      ...draftLines.map((d) => ({ qty: d.line.qty, unitPrice: d.unit, modifiersTotal: d.modsTotal })),
    ],
    discount: existing?.discount ? { type: existing.discount.type, value: existing.discount.value } : null,
    serviceChargeRate: channel?.appliesServiceCharge ? branch.serviceChargeRate : 0,
    vatRate: db.tenant.vatRegistered ? db.tenant.vatRate : 0,
    pricesIncludeVat: db.tenant.pricesIncludeVat,
  });
  const count = pos.lines.reduce((s, l) => s + l.qty, 0) + (existing?.items.filter((i) => i.status !== "voided").reduce((s, i) => s + i.qty, 0) ?? 0);

  const tap = (m: MenuItem) => {
    if (m.soldOut[branch.id]) {
      toast.info(`${m.name} หมดแล้ว`, { description: "ลองแนะนำเมนูอื่นให้ลูกค้า" });
      return;
    }
    const required = m.modifierGroupIds.some((gid) => (db.modifierGroups.find((g) => g.id === gid)?.min ?? 0) > 0);
    // Required choices (e.g. sweetness) open the sheet with sensible defaults
    // pre-selected; everything else is added in one tap and can be edited in the bill.
    if (required && needsSheet(m, db.modifierGroups)) {
      setSheetItem(m);
      return;
    }
    pos.add({ menuItemId: m.id, qty: 1, modifierOptionIds: defaultOptions(m, db.modifierGroups) });
  };

  const send = async (thenPay: boolean) => {
    if (!channel) return null;
    if (pos.lines.length === 0 && existing) return existing;
    const orderId = existing?.id ?? newId("ord");
    const res = await exec(
      (d, c) =>
        submitOrder(d, c, {
          id: orderId,
          channelId: channel.id,
          tableId: pos.tableId,
          guestCount: pos.guestCount,
          items: pos.lines.map((l) => ({ id: l.id, menuItemId: l.menuItemId, qty: l.qty, note: l.note, modifierOptionIds: l.modifierOptionIds })),
        }),
      { success: thenPay ? undefined : "ส่งเข้าครัวแล้ว", successDetail: thenPay ? undefined : "ออเดอร์ขึ้นจอครัวเรียบร้อย", latencyMs: 150 },
    );
    if (!res.ok) return null;
    if (thenPay) {
      pos.resume(res.value.id, res.value.channelId, res.value.tableId);
    } else {
      pos.clear();
    }
    return res.value;
  };

  const startPay = async () => {
    if (!shift && can("pos.pay")) {
      const cashOnly = db.paymentMethods.filter((m) => m.active && m.kind !== "platform").every((m) => m.kind === "cash");
      if (cashOnly || channel?.kind !== "delivery_platform") {
        setOpenShiftOpen(true);
        toast.info("เปิดกะก่อนรับเงินนะ", { description: "นับเงินทอนตั้งต้น ใช้เวลาไม่ถึง 10 วินาที" });
        return;
      }
    }
    const o = await send(true);
    if (o) {
      setCartOpen(false);
      setPayOrder(useSabai.getState().db.orders.find((x) => x.id === o.id) ?? o);
    }
  };

  const hasHome = nav.primary.some((n) => n.key !== "pos");

  const cart = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-ink">{existing ? `บิล #${existing.orderNo}` : "บิลใหม่"}</p>
          <p className="truncate text-sm text-ink-3">
            {channel?.name}
            {table ? ` · โต๊ะ ${table.name}` : ""}
            {pos.guestCount ? ` · ${pos.guestCount} คน` : ""}
          </p>
        </div>
        {(existing || pos.lines.length > 0) && (
          <Button variant="ghost" size="icon" aria-label="เริ่มบิลใหม่" onClick={() => pos.clear()}>
            <X className="h-5 w-5" />
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 scrollbar-thin">
        {count === 0 ? (
          <EmptyState compact emoji="🧾" title="ยังไม่มีรายการ" description="แตะเมนูทางซ้ายเพื่อเพิ่มลงบิล แตะซ้ำเพื่อเพิ่มจำนวน" />
        ) : (
          <ul className="space-y-1.5">
            <AnimatePresence initial={false}>
              {existing?.items.map((i) => (
                <motion.li key={i.id} layout initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, height: 0 }} className={cn("flex items-start gap-2 rounded-xl px-2 py-2", i.status === "voided" && "opacity-50")}>
                  <span className="mt-0.5 text-xl" aria-hidden="true">
                    {i.emoji}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-[15px] font-medium text-ink", i.status === "voided" && "line-through")}>
                      {i.qty > 1 && <span className="tabular">{i.qty}× </span>}
                      {i.name}
                    </p>
                    {i.modifiers.length > 0 && <p className="text-[13px] text-ink-3">{i.modifiers.map((m) => m.name).join(" · ")}</p>}
                    <p className="mt-0.5">
                      {i.status === "voided" ? <Badge tone="danger">ยกเลิก</Badge> : i.status === "ready" ? <Badge tone="success">พร้อมเสิร์ฟ</Badge> : <Badge tone="info" icon={<ChefHat className="h-3 w-3" />}>ส่งครัวแล้ว</Badge>}
                    </p>
                  </div>
                  <span className="text-[15px] tabular text-ink-2">{formatBaht(i.qty * (i.unitPrice + i.modifiers.reduce((s, m) => s + m.priceDelta, 0)))}</span>
                  {i.status !== "voided" && (
                    <button onClick={() => setVoidTarget({ itemId: i.id })} className="grid h-9 w-9 place-items-center rounded-lg text-ink-3 hover:bg-surface-2 hover:text-danger" aria-label={`ยกเลิก ${i.name}`}>
                      <Ban className="h-4 w-4" />
                    </button>
                  )}
                </motion.li>
              ))}
              {draftLines.map(({ line, mi, mods, unit, modsTotal }) => (
                <motion.li
                  key={line.id}
                  layout
                  initial={{ opacity: 0, x: 24, backgroundColor: "var(--brand-soft)" }}
                  animate={{ opacity: 1, x: 0, backgroundColor: "rgba(0,0,0,0)" }}
                  exit={{ opacity: 0, x: -24, height: 0, marginTop: 0 }}
                  transition={{ type: "spring", stiffness: 500, damping: 38 }}
                  className="flex items-center gap-2 rounded-xl px-2 py-2"
                >
                  <span className="text-xl" aria-hidden="true">
                    {mi.emoji}
                  </span>
                  <button
                    type="button"
                    className="min-w-0 flex-1 rounded-lg text-left hover:bg-surface-2"
                    onClick={() => {
                      setEditLine(line.id);
                      setSheetItem(mi);
                    }}
                    aria-label={`แก้ไขตัวเลือก ${mi.name}`}
                  >
                    <p className="truncate text-[15px] font-medium text-ink">{mi.name}</p>
                    <p className="truncate text-[13px] text-ink-3">{[...mods.map((m) => m.name), line.note].filter(Boolean).join(" · ") || (mi.modifierGroupIds.length ? "แตะเพื่อเพิ่มตัวเลือก/หมายเหตุ" : "แตะเพื่อเพิ่มหมายเหตุ")}</p>
                    <p className="text-[13px] tabular text-ink-3">{formatBaht((unit + modsTotal) * line.qty)}</p>
                  </button>
                  <div className="flex items-center rounded-xl bg-surface-2" role="group" aria-label={`จำนวน ${mi.name}`}>
                    <button className="grid h-10 w-10 place-items-center rounded-xl hover:bg-surface-3" onClick={() => pos.inc(line.id, -1)} aria-label={line.qty === 1 ? `ลบ ${mi.name}` : `ลดจำนวน ${mi.name}`}>
                      {line.qty === 1 ? <Trash2 className="h-4 w-4 text-danger" /> : <Minus className="h-4 w-4" />}
                    </button>
                    <motion.span key={line.qty} initial={{ scale: 1.4 }} animate={{ scale: 1 }} className="w-7 text-center font-semibold tabular" aria-live="polite">
                      {line.qty}
                    </motion.span>
                    <button className="grid h-10 w-10 place-items-center rounded-xl hover:bg-surface-3" onClick={() => pos.inc(line.id, 1)} aria-label={`เพิ่มจำนวน ${mi.name}`}>
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>

      <div className="space-y-3 border-t border-line p-4">
        <dl className="space-y-1 text-sm">
          <div className="flex justify-between text-ink-3">
            <dt>รวม {count} รายการ</dt>
            <dd className="tabular">{formatBaht(totals.itemsTotal)}</dd>
          </div>
          {totals.discountTotal > 0 && (
            <div className="flex justify-between text-success">
              <dt>ส่วนลด ({existing?.discount?.reason})</dt>
              <dd className="tabular">-{formatBaht(totals.discountTotal)}</dd>
            </div>
          )}
          {totals.serviceCharge > 0 && (
            <div className="flex justify-between text-ink-3">
              <dt>ค่าบริการ</dt>
              <dd className="tabular">{formatBaht(totals.serviceCharge)}</dd>
            </div>
          )}
          {totals.vatAmount > 0 && (
            <div className="flex justify-between text-ink-3">
              <dt>{db.tenant.pricesIncludeVat ? "รวม VAT 7% แล้ว" : "VAT 7%"}</dt>
              <dd className="tabular">{formatBaht(totals.vatAmount)}</dd>
            </div>
          )}
          <div className="flex items-baseline justify-between pt-1">
            <dt className="text-base font-semibold text-ink">ยอดสุทธิ</dt>
            <dd className="text-3xl font-bold tracking-tight tabular text-ink">
              <motion.span key={totals.total} initial={{ opacity: 0.4, y: -4 }} animate={{ opacity: 1, y: 0 }}>
                {formatBaht(totals.total)}
              </motion.span>
            </dd>
          </div>
        </dl>
        {existing && (
          <div className="flex gap-2">
            {can("pos.pay") && (
              <Button variant="secondary" size="sm" className="flex-1" icon={<BadgePercent className="h-4 w-4" />} onClick={() => setDiscountOpen(true)}>
                ส่วนลด
              </Button>
            )}
            <Button variant="secondary" size="sm" className="flex-1" icon={<Ban className="h-4 w-4" />} onClick={() => setVoidTarget({})}>
              ยกเลิกบิล
            </Button>
          </div>
        )}
        <div className="flex gap-2">
          {(channel?.kind === "dine_in" || !can("pos.pay")) && (
            <Button variant={can("pos.pay") ? "secondary" : "primary"} size="xl" className="flex-1" disabled={pos.lines.length === 0} loading={pending && !payOrder} onClick={() => send(false)} icon={<ChefHat className="h-5 w-5" />}>
              ส่งครัว
            </Button>
          )}
          {can("pos.pay") && (
            <Button size="xl" className="flex-[1.4]" disabled={count === 0} onClick={startPay} icon={<Wallet className="h-5 w-5" />}>
              ชำระเงิน
            </Button>
          )}
        </div>
        {!can("pos.pay") && <p className="text-center text-xs text-ink-3">ส่งครัวแล้ว แคชเชียร์จะเป็นคนเก็บเงิน</p>}
      </div>
    </div>
  );

  return (
    <div className="glass-field flex h-dvh flex-col bg-bg">
      {/* Top bar */}
      <header className="flex h-16 shrink-0 items-center gap-2 border-b border-[var(--glass-border)] bg-[var(--glass-bg-strong)] px-3 backdrop-blur-xl backdrop-saturate-150 sm:gap-3 sm:px-4">
        {hasHome ? (
          <Link href={nav.primary.find((n) => n.key !== "pos")?.href ?? "/"} className="grid h-11 w-11 place-items-center rounded-xl text-ink-2 hover:bg-surface-2" aria-label="กลับหน้าหลัก">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        ) : null}
        <div role="radiogroup" aria-label="ช่องทางขาย" className="no-scrollbar flex min-w-0 flex-1 gap-1.5 overflow-x-auto">
          {channels.map((c) => {
            const Ico = CHANNEL_ICON[c.kind];
            const on = c.id === channel?.id;
            return (
              <button
                key={c.id}
                role="radio"
                aria-checked={on}
                disabled={!!existing && !on}
                onClick={() => pos.setChannel(c.id)}
                className={cn("flex h-11 shrink-0 items-center gap-2 rounded-xl border px-3.5 text-[15px] font-medium transition-colors disabled:opacity-40", on ? "border-transparent bg-ink text-ink-inverse" : "border-line bg-surface text-ink-2 hover:border-line-strong")}
              >
                {Ico ? <Ico className="h-4 w-4" aria-hidden="true" /> : <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} aria-hidden="true" />}
                {c.short}
              </button>
            );
          })}
        </div>
        {channel?.kind === "dine_in" && !existing && (
          <Button variant="secondary" onClick={() => setTablesOpen(true)} className="shrink-0">
            {table ? `โต๊ะ ${table.name}` : "เลือกโต๊ะ"}
          </Button>
        )}
        <Button variant="secondary" onClick={() => setOrdersOpen(true)} className="relative shrink-0" icon={<ClipboardList className="h-5 w-5" />}>
          <span className="sr-only md:not-sr-only">บิลค้าง</span>
          {openCount > 0 && (
            <span className="grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1 text-xs font-bold text-[#2b1b00]">
              {openCount}
              <span className="sr-only"> บิล</span>
            </span>
          )}
        </Button>
        {can("pos.pay") && (
          <button onClick={() => (shift ? setCloseShiftOpen(true) : setOpenShiftOpen(true))} className={cn("hidden h-11 shrink-0 items-center gap-2 rounded-xl px-3 text-sm font-medium lg:flex", shift ? "bg-success-soft text-success" : "bg-warning-soft text-warning")}>
            {shift ? <span className="h-2 w-2 rounded-full bg-success" aria-hidden="true" /> : <Lock className="h-4 w-4" aria-hidden="true" />}
            {shift ? "กะเปิดอยู่" : "ยังไม่เปิดกะ"}
          </button>
        )}
        <button onClick={() => openSwitch(true)} className="flex h-11 shrink-0 items-center gap-2 rounded-xl px-1.5 hover:bg-surface-2" aria-label={`ผู้ใช้ ${member?.name} แตะเพื่อสลับผู้ใช้`}>
          <Avatar name={member?.name ?? "?"} color={member?.color} size={34} />
          <UserRoundCog className="hidden h-4 w-4 text-ink-3 sm:block" aria-hidden="true" />
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Categories */}
        <nav aria-label="หมวดเมนู" className="hidden w-[118px] shrink-0 flex-col gap-1 overflow-y-auto border-r border-[var(--glass-border)] bg-[var(--glass-bg)] p-2 backdrop-blur-xl backdrop-saturate-150 scrollbar-thin md:flex">
          <LayoutGroup id="cats">
            {[{ id: "all", name: "ทั้งหมด", emoji: "🍽️" }, { id: "best", name: "ขายดี", emoji: "⭐" }, ...db.menuCategories].map((c) => {
              const on = category === c.id;
              return (
                <button key={c.id} onClick={() => setCategory(c.id)} aria-pressed={on} className={cn("relative flex flex-col items-center gap-1 rounded-2xl px-1 py-3 text-center text-[13px] font-medium leading-tight", on ? "text-ink" : "text-ink-3 hover:bg-surface-2")}>
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

        {/* Menu */}
        <section aria-label="เมนู" className="flex min-w-0 flex-1 flex-col">
          <div className="flex gap-2 p-3 pb-2">
            <SearchInput value={q} onChange={setQ} placeholder="ค้นหาเมนู" className="flex-1" />
          </div>
          <div className="no-scrollbar flex gap-1.5 overflow-x-auto px-3 pb-2 md:hidden">
            {[{ id: "all", name: "ทั้งหมด", emoji: "🍽️" }, { id: "best", name: "ขายดี", emoji: "⭐" }, ...db.menuCategories].map((c) => (
              <button key={c.id} onClick={() => setCategory(c.id)} aria-pressed={category === c.id} className={cn("h-10 shrink-0 rounded-full border px-3 text-sm font-medium", category === c.id ? "border-brand bg-brand-soft text-brand-soft-ink" : "border-line text-ink-2")}>
                {c.emoji} {c.name}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-28 scrollbar-thin md:pb-4">
            {db.menuItems.length === 0 ? (
              <EmptyState emoji="📋" title="ยังไม่มีเมนูให้ขาย" description="เพิ่มเมนูแรกก่อน ใช้เวลาไม่ถึง 2 นาที — ชื่อ ราคา แค่นั้นก็ขายได้" action={can("menu.manage") ? <Link href="/menu/new" className="inline-flex h-11 items-center rounded-xl bg-brand px-4 font-medium text-brand-ink">เพิ่มเมนูแรก</Link> : undefined} />
            ) : items.length === 0 ? (
              <EmptyState compact emoji="🔍" title="ไม่พบเมนูนี้" description="ลองพิมพ์คำอื่น หรือเลือกหมวดทั้งหมด" />
            ) : (
              <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                {items.map((m, i) => {
                  const cat = db.menuCategories.find((c) => c.id === m.categoryId);
                  const out = !!m.soldOut[branch.id];
                  const inCart = pos.lines.filter((l) => l.menuItemId === m.id).reduce((s, l) => s + l.qty, 0);
                  return (
                    <motion.li key={m.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.015, 0.2) }} className="relative">
                      <motion.button
                        whileTap={{ scale: 0.95 }}
                        onClick={() => tap(m)}
                        className={cn("glass-soft group relative flex h-full w-full flex-col overflow-hidden rounded-2xl text-left transition-[box-shadow,border-color]", out ? "opacity-55" : "hover:border-brand/50 hover:shadow-md", inCart && "border-brand ring-2 ring-brand/25")}
                      >
                        <span
                          className="grid h-24 place-items-center text-5xl sm:h-28"
                          style={{
                            background: `radial-gradient(circle at 50% 32%, color-mix(in srgb, white 18%, transparent), transparent 70%), color-mix(in oklab, ${cat?.color ?? "#13784f"} var(--cat-tint), var(--tile-surface))`,
                          }}
                          aria-hidden="true"
                        >
                          <motion.span whileHover={{ scale: 1.08, rotate: -3 }}>{m.emoji}</motion.span>
                        </span>
                        <span className="flex flex-1 flex-col gap-0.5 p-3">
                          <span className="line-clamp-2 text-[15px] font-semibold leading-snug text-ink">{m.name}</span>
                          <span className="mt-auto text-[15px] font-semibold tabular text-ink-2">{formatBaht(priceFor(m, channel), { compact: true })}</span>
                        </span>
                        {out && <span className="absolute left-2 top-2 rounded-full bg-ink px-2 py-0.5 text-xs font-semibold text-ink-inverse">หมด</span>}
                        {!out && m.tags?.[0] && <span className="absolute left-2 top-2 rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-[#2b1b00] shadow-sm">{m.tags[0]}</span>}
                        <AnimatePresence>
                          {inCart > 0 && (
                            <motion.span key={inCart} initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} className="absolute right-2 top-2 grid h-7 min-w-7 place-items-center rounded-full bg-brand px-1.5 text-sm font-bold text-brand-ink shadow-md">
                              <span className="sr-only">ในบิลแล้ว </span>
                              {inCart}
                            </motion.span>
                          )}
                        </AnimatePresence>
                      </motion.button>
                      {can("menu.availability") && (
                        <button onClick={() => setManage(m)} className="absolute bottom-2 right-2 grid h-9 w-9 place-items-center rounded-lg text-ink-3 hover:bg-surface-2 hover:text-ink" aria-label={`ตั้งค่า ${m.name}`}>
                          <MoreVertical className="h-4 w-4" />
                        </button>
                      )}
                    </motion.li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        {/* Cart (desktop/tablet) */}
        <aside aria-label="บิล" className="hidden w-[380px] shrink-0 border-l border-[var(--glass-border)] bg-[var(--glass-bg-strong)] backdrop-blur-xl backdrop-saturate-150 lg:block">
          {cart}
        </aside>
      </div>

      {/* Cart bar (phones & small tablets) */}
      <div className="safe-bottom fixed inset-x-0 bottom-0 z-20 border-t border-[var(--glass-border)] bg-[var(--glass-bg-strong)] p-3 backdrop-blur-xl backdrop-saturate-150 lg:hidden">
        <Button size="xl" block onClick={() => setCartOpen(true)} disabled={count === 0} className="justify-between">
          <span className="flex items-center gap-2">
            <span className="grid h-7 min-w-7 place-items-center rounded-full bg-brand-ink/20 px-1.5 text-sm">{count}</span> ดูบิล
          </span>
          <span className="tabular">{formatBaht(totals.total)}</span>
        </Button>
      </div>
      <Dialog open={cartOpen} onOpenChange={setCartOpen} title="บิล" size="md">
        <div className="-mx-6 -mb-4 h-[70dvh]">{cart}</div>
      </Dialog>

      <ModifierSheet
        item={sheetItem}
        groups={db.modifierGroups}
        channel={channel}
        initial={editLine ? pos.lines.find((l) => l.id === editLine) : undefined}
        onClose={() => {
          setSheetItem(null);
          setEditLine(null);
        }}
        onAdd={(line) => {
          if (editLine) pos.remove(editLine);
          pos.add(line);
          setSheetItem(null);
          setEditLine(null);
        }}
      />
      <PaymentDialog
        order={payOrder}
        open={!!payOrder}
        onClose={() => {
          setPayOrder(null);
          const still = useSabai.getState().db.orders.find((o) => o.id === payOrder?.id);
          if (still?.status === "paid") pos.clear();
        }}
        onPaid={() => undefined}
      />
      <DiscountDialog order={existing ?? null} open={discountOpen} onClose={() => setDiscountOpen(false)} />
      <VoidDialog
        order={existing ?? null}
        itemId={voidTarget?.itemId}
        open={!!voidTarget}
        onClose={() => {
          setVoidTarget(null);
          const o = useSabai.getState().db.orders.find((x) => x.id === existing?.id);
          if (o?.status === "voided") pos.clear();
        }}
      />
      <OpenShiftDialog open={openShiftOpen} onClose={() => setOpenShiftOpen(false)} />
      <CloseShiftDialog open={closeShiftOpen} onClose={() => setCloseShiftOpen(false)} />
      <OpenOrdersDialog
        open={ordersOpen}
        onClose={() => setOrdersOpen(false)}
        onPick={(o) => {
          pos.resume(o.id, o.channelId, o.tableId);
          setOrdersOpen(false);
        }}
      />
      <TablePicker
        open={tablesOpen}
        onClose={() => setTablesOpen(false)}
        onPick={(tableId, guests) => {
          const busy = db.orders.find((o) => o.status === "open" && o.tableId === tableId && tableId);
          if (busy) pos.resume(busy.id, busy.channelId, busy.tableId);
          else pos.setTable(tableId, guests);
          setTablesOpen(false);
        }}
      />
      <Dialog open={!!manage} onOpenChange={(o) => !o && setManage(null)} title={manage?.name ?? ""} description="จัดการเมนูนี้ที่สาขา" size="sm">
        {manage && (
          <div className="space-y-2 pb-3">
            <Button
              block
              size="lg"
              variant={manage.soldOut[branch.id] ? "primary" : "secondary"}
              onClick={async () => {
                const next = !manage.soldOut[branch.id];
                const r = await exec((d, c) => setSoldOut(d, c, manage.id, next), { success: next ? `ปิดขาย “${manage.name}” แล้ว` : `เปิดขาย “${manage.name}” อีกครั้ง`, successDetail: next ? "ทุกเครื่องในสาขาจะเห็นว่าหมด" : undefined });
                if (r.ok) setManage(null);
              }}
            >
              {manage.soldOut[branch.id] ? "เปิดขายอีกครั้ง" : "ของหมด — ปิดขายชั่วคราว"}
            </Button>
            {can("menu.manage") && (
              <Link href={`/menu/${manage.id}`} className="flex h-12 items-center justify-center gap-2 rounded-xl text-[15px] font-medium text-ink-2 hover:bg-surface-2">
                <MessageSquareText className="h-4 w-4" aria-hidden="true" /> ดูสูตรและต้นทุน
              </Link>
            )}
          </div>
        )}
      </Dialog>
    </div>
  );
}

export default function PosPage() {
  return (
    <Gate>
      <RouteGuard>
        <PosScreen />
      </RouteGuard>
    </Gate>
  );
}
