"use client";

import type { calculateOrderTotals } from "@sabai/domain";
import { BadgePercent, Ban, ChefHat, Minus, Plus, Trash2, Wallet, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { usePos, type CartLine } from "@/components/pos/pos-store";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/primitives";
import { useAccess } from "@/hooks/use-sabai";
import { cn } from "@/lib/cn";
import { formatBaht } from "@/lib/demo/selectors";
import { useSabai } from "@/lib/demo/store";
import type { Channel, MenuItem, Order } from "@/lib/demo/types";

/** A line still on this device, with its prices worked out. */
export interface DraftLine {
  line: CartLine;
  mi: MenuItem;
  mods: { id: string; name: string; priceDelta: number }[];
  unit: number;
  modsTotal: number;
}

/** The bill: lines already sent to the kitchen, lines still on this device, totals and the send/pay buttons. */
export function CartPanel({
  existing,
  channel,
  table,
  count,
  draftLines,
  totals,
  sending,
  onNewBill,
  onVoid,
  onEditLine,
  onDiscount,
  onSend,
  onPay,
}: {
  existing?: Order;
  channel?: Channel;
  table?: { name: string };
  count: number;
  draftLines: DraftLine[];
  totals: ReturnType<typeof calculateOrderTotals>;
  sending: boolean;
  onNewBill: () => void;
  onVoid: (itemId?: string) => void;
  onEditLine: (lineId: string, item: MenuItem) => void;
  onDiscount: () => void;
  onSend: () => void;
  onPay: () => void;
}) {
  const pos = usePos();
  const { can } = useAccess();
  const pricesIncludeVat = useSabai((s) => s.db.tenant.pricesIncludeVat);

  return (
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
          <Button variant="ghost" size="icon" aria-label="เริ่มบิลใหม่" onClick={onNewBill}>
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
                <motion.li
                  key={i.id}
                  layout
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  className={cn("flex items-start gap-2 rounded-xl px-2 py-2", i.status === "voided" && "opacity-50")}
                >
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
                      {i.status === "voided" ? (
                        <Badge tone="danger">ยกเลิก</Badge>
                      ) : i.status === "ready" ? (
                        <Badge tone="success">พร้อมเสิร์ฟ</Badge>
                      ) : (
                        <Badge tone="info" icon={<ChefHat className="h-3 w-3" />}>
                          ส่งครัวแล้ว
                        </Badge>
                      )}
                    </p>
                  </div>
                  <span className="text-[15px] tabular text-ink-2">{formatBaht(i.qty * (i.unitPrice + i.modifiers.reduce((s, m) => s + m.priceDelta, 0)))}</span>
                  {i.status !== "voided" && (
                    <button onClick={() => onVoid(i.id)} className="grid h-11 w-11 place-items-center rounded-lg text-ink-3 hover:bg-surface-2 hover:text-danger" aria-label={`ยกเลิก ${i.name}`}>
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
                  animate={{ opacity: 1, x: 0, backgroundColor: "transparent" }}
                  exit={{ opacity: 0, x: -24, height: 0, marginTop: 0 }}
                  transition={{ type: "spring", stiffness: 500, damping: 38 }}
                  className="flex items-center gap-2 rounded-xl px-2 py-2"
                >
                  <span className="text-xl" aria-hidden="true">
                    {mi.emoji}
                  </span>
                  <button type="button" className="min-w-0 flex-1 rounded-lg text-left hover:bg-surface-2" onClick={() => onEditLine(line.id, mi)} aria-label={`แก้ไขตัวเลือก ${mi.name}`}>
                    <p className="truncate text-[15px] font-medium text-ink">{mi.name}</p>
                    <p className="truncate text-[13px] text-ink-3">
                      {[...mods.map((m) => m.name), line.note].filter(Boolean).join(" · ") || (mi.modifierGroupIds.length ? "แตะเพื่อเพิ่มตัวเลือก/หมายเหตุ" : "แตะเพื่อเพิ่มหมายเหตุ")}
                    </p>
                    <p className="text-[13px] tabular text-ink-3">{formatBaht((unit + modsTotal) * line.qty)}</p>
                  </button>
                  <div className="flex items-center rounded-xl bg-surface-2" role="group" aria-label={`จำนวน ${mi.name}`}>
                    <button className="grid h-11 w-11 place-items-center rounded-xl hover:bg-surface-3" onClick={() => pos.inc(line.id, -1)} aria-label={line.qty === 1 ? `ลบ ${mi.name}` : `ลดจำนวน ${mi.name}`}>
                      {line.qty === 1 ? <Trash2 className="h-4 w-4 text-danger" /> : <Minus className="h-4 w-4" />}
                    </button>
                    <motion.span key={line.qty} initial={{ scale: 1.4 }} animate={{ scale: 1 }} className="w-7 text-center font-semibold tabular" aria-live="polite">
                      {line.qty}
                    </motion.span>
                    <button className="grid h-11 w-11 place-items-center rounded-xl hover:bg-surface-3" onClick={() => pos.inc(line.id, 1)} aria-label={`เพิ่มจำนวน ${mi.name}`}>
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
              <dt>{pricesIncludeVat ? "รวม VAT 7% แล้ว" : "VAT 7%"}</dt>
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
              <Button variant="secondary" size="sm" className="flex-1" icon={<BadgePercent className="h-4 w-4" />} onClick={onDiscount}>
                ส่วนลด
              </Button>
            )}
            <Button variant="secondary" size="sm" className="flex-1" icon={<Ban className="h-4 w-4" />} onClick={() => onVoid()}>
              ยกเลิกบิล
            </Button>
          </div>
        )}
        <div className="flex gap-2">
          {(channel?.kind === "dine_in" || !can("pos.pay")) && (
            <Button variant={can("pos.pay") ? "secondary" : "primary"} size="xl" className="flex-1" disabled={pos.lines.length === 0} loading={sending} onClick={onSend} icon={<ChefHat className="h-5 w-5" />}>
              ส่งครัว
            </Button>
          )}
          {can("pos.pay") && (
            <Button size="xl" className="flex-[1.4]" disabled={count === 0} onClick={onPay} icon={<Wallet className="h-5 w-5" />}>
              ชำระเงิน
            </Button>
          )}
        </div>
        {!can("pos.pay") && <p className="text-center text-xs text-ink-3">ส่งครัวแล้ว แคชเชียร์จะเป็นคนเก็บเงิน</p>}
      </div>
    </div>
  );
}
