"use client";

import { calculateOrderTotals, effectiveVatRate } from "@sabai/domain";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ConnectionBanner, QueueBanner } from "@/components/app/connection-badge";
import { Gate, RouteGuard } from "@/components/app/gate";
import { LoadBanner } from "@/components/app/load-banner";
import { CartPanel } from "@/components/pos/cart-panel";
import { CategoryChips, CategoryRail } from "@/components/pos/category-nav";
import { ManageItemDialog } from "@/components/pos/manage-item-dialog";
import { MenuGrid } from "@/components/pos/menu-grid";
import { ModifierSheet, defaultOptions, needsSheet } from "@/components/pos/modifier-sheet";
import { PaymentDialog } from "@/components/pos/payment-dialog";
import { PosHeader } from "@/components/pos/pos-header";
import { DiscountDialog, OpenOrdersDialog, OpenShiftDialog, CloseShiftDialog, TablePicker, VoidDialog } from "@/components/pos/pos-dialogs";
import { usePos } from "@/components/pos/pos-store";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { Dialog } from "@/components/ui/overlay";
import { SearchInput } from "@/components/ui/primitives";
import { useAccess } from "@/hooks/use-sabai";
import { useDsAction, useLoad } from "@/hooks/use-data-source";
import { newClientId } from "@/lib/data-source/ids";
import { modifierPrice, openShiftOf, priceFor } from "@/lib/demo/engine";
import { formatBaht } from "@/lib/demo/selectors";
import { useSabai } from "@/lib/demo/store";
import type { MenuItem, Order } from "@/lib/demo/types";

function PosScreen() {
  const db = useSabai((s) => s.db);
  const { branch, can } = useAccess();
  const pos = usePos();
  const { exec, pending } = useDsAction();
  const load = useLoad(["orders", "shifts", "availability"]);

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

  const bestIds = useMemo(
    () =>
      [...db.menuItems]
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 8)
        .map((m) => m.id),
    [db.menuItems],
  );
  const items = db.menuItems.filter(
    (m) => m.active && (category === "all" ? true : category === "best" ? bestIds.includes(m.id) : m.categoryId === category) && (!q || m.name.includes(q) || m.nameEn?.toLowerCase().includes(q.toLowerCase())),
  );

  // Live totals for sent items + lines still on this device (same maths as the server).
  const draftLines = pos.lines.map((l) => {
    const mi = db.menuItems.find((m) => m.id === l.menuItemId)!;
    const mods = l.modifierOptionIds.map((id) => ({ id, ...modifierPrice(db, id)! }));
    return {
      line: l,
      mi,
      mods,
      unit: priceFor(mi, channel),
      modsTotal: mods.reduce((s, m) => s + m.priceDelta, 0),
    };
  });
  const totals = calculateOrderTotals({
    lines: [
      ...(existing?.items ?? []).map((i) => ({
        qty: i.qty,
        unitPrice: i.unitPrice,
        modifiersTotal: i.modifiers.reduce((s, m) => s + m.priceDelta, 0),
        voided: i.status === "voided",
      })),
      ...draftLines.map((d) => ({
        qty: d.line.qty,
        unitPrice: d.unit,
        modifiersTotal: d.modsTotal,
      })),
    ],
    discount: existing?.discount ? { type: existing.discount.type, value: existing.discount.value } : null,
    serviceChargeRate: channel?.appliesServiceCharge ? branch.serviceChargeRate : 0,
    vatRate: effectiveVatRate(db.tenant),
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
    const orderId = existing?.id ?? newClientId("ord");
    const tableId = existing?.tableId ?? pos.tableId;
    const channelId = existing?.channelId ?? channel.id;
    const res = await exec(
      (ds) =>
        ds.submitOrder({
          id: orderId,
          channelId: channel.id,
          tableId: pos.tableId,
          guestCount: pos.guestCount,
          items: pos.lines.map((l) => ({
            id: l.id,
            menuItemId: l.menuItemId,
            qty: l.qty,
            note: l.note,
            modifierOptionIds: l.modifierOptionIds,
          })),
        }),
      {
        success: thenPay ? undefined : (r) => (r.queued ? "บันทึกออเดอร์ไว้ในเครื่องแล้ว" : "ส่งเข้าครัวแล้ว"),
        successDetail: thenPay ? undefined : (r) => (r.queued ? "ยังไม่ขึ้นจอครัว ระบบจะส่งให้เองเมื่อกลับมาออนไลน์" : "ออเดอร์ขึ้นจอครัวเรียบร้อย"),
      },
    );
    if (!res.ok) return null;
    if (thenPay) {
      pos.resume(orderId, channelId, tableId);
    } else {
      pos.clear();
    }
    // The saved order is in the store once the command has finished, in either mode.
    return useSabai.getState().db.orders.find((o) => o.id === orderId) ?? null;
  };

  const startPay = async () => {
    if (!shift && can("pos.pay")) {
      const cashOnly = db.paymentMethods.filter((m) => m.active && m.kind !== "platform").every((m) => m.kind === "cash");
      if (cashOnly || channel?.kind !== "delivery_platform") {
        setOpenShiftOpen(true);
        toast.info("เปิดกะก่อนรับเงินนะ", {
          description: "นับเงินทอนตั้งต้น ใช้เวลาไม่ถึง 10 วินาที",
        });
        return;
      }
    }
    const o = await send(true);
    if (o) {
      setCartOpen(false);
      setPayOrder(useSabai.getState().db.orders.find((x) => x.id === o.id) ?? o);
    }
  };
  const cart = (
    <CartPanel
      existing={existing}
      channel={channel}
      table={table}
      count={count}
      draftLines={draftLines}
      totals={totals}
      sending={pending && !payOrder}
      onNewBill={() => pos.clear()}
      onVoid={(itemId) => setVoidTarget({ itemId })}
      onEditLine={(lineId, item) => {
        setEditLine(lineId);
        setSheetItem(item);
      }}
      onDiscount={() => setDiscountOpen(true)}
      onSend={() => send(false)}
      onPay={startPay}
    />
  );

  return (
    <div className="glass-field flex h-dvh flex-col bg-bg">
      <PosHeader
        channels={channels}
        channel={channel}
        existing={existing}
        table={table}
        openCount={openCount}
        shiftOpen={!!shift}
        onTables={() => setTablesOpen(true)}
        onOrders={() => setOrdersOpen(true)}
        onShift={() => (shift ? setCloseShiftOpen(true) : setOpenShiftOpen(true))}
      />

      <LoadBanner state={load} className="mx-3 mt-2 shrink-0" />
      <ConnectionBanner className="mx-3 mt-2 shrink-0">ขายต่อได้ตามปกติ ระบบเก็บไว้ในเครื่องแล้วส่งให้เองเมื่อออนไลน์</ConnectionBanner>
      <QueueBanner className="mx-3 mt-2 shrink-0" />

      <div className="flex min-h-0 flex-1">
        <CategoryRail category={category} onChange={setCategory} />

        <main aria-label="เมนู" className="flex min-w-0 flex-1 flex-col">
          <div className="flex gap-2 p-3 pb-2">
            <SearchInput value={q} onChange={setQ} placeholder="ค้นหาเมนู" className="flex-1" />
          </div>
          <CategoryChips category={category} onChange={setCategory} />
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-28 scrollbar-thin md:pb-4">
            {db.menuItems.length === 0 ? (
              <EmptyState
                emoji="📋"
                title="ยังไม่มีเมนูให้ขาย"
                description="เพิ่มเมนูแรกก่อน ใช้เวลาไม่ถึง 2 นาที — ชื่อ ราคา แค่นั้นก็ขายได้"
                action={
                  can("menu.manage") ? (
                    <Link href="/menu/new" className="inline-flex h-11 items-center rounded-xl bg-brand px-4 font-medium text-brand-ink">
                      เพิ่มเมนูแรก
                    </Link>
                  ) : undefined
                }
              />
            ) : items.length === 0 ? (
              <EmptyState compact emoji="🔍" title="ไม่พบเมนูนี้" description="ลองพิมพ์คำอื่น หรือเลือกหมวดทั้งหมด" />
            ) : (
              <MenuGrid items={items} channel={channel} onTap={tap} onManage={setManage} />
            )}
          </div>
        </main>

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
      <ManageItemDialog item={manage} onClose={() => setManage(null)} />
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
