"use client";

import { elapsedSeconds, type Satang } from "@sabai/domain";
import { Clock, Users } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState, Keypad } from "@/components/ui/feedback";
import { Dialog } from "@/components/ui/overlay";
import { Callout, Input, Segmented } from "@/components/ui/primitives";
import { useAction, useNow } from "@/hooks/use-sabai";
import { cn } from "@/lib/cn";
import { applyDiscount, closeShift, expectedCash, openShift, openShiftOf, voidItem, voidOrder } from "@/lib/demo/engine";
import { formatBaht } from "@/lib/demo/selectors";
import { useSabai } from "@/lib/demo/store";
import type { Order } from "@/lib/demo/types";

// ---------------------------------------------------------------------------
// Reason picker (shared by discount / void) — chips first, typing optional
// ---------------------------------------------------------------------------
function ReasonPicker({ reasons, value, onChange }: { reasons: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-2">
      <p className="text-[15px] font-semibold text-ink">เหตุผล</p>
      <div className="flex flex-wrap gap-2">
        {reasons.map((r) => (
          <button key={r} type="button" onClick={() => onChange(r)} aria-pressed={value === r} className={cn("h-11 rounded-2xl border px-4 text-[15px] font-medium transition-colors", value === r ? "border-brand bg-brand-soft text-brand-soft-ink" : "border-line text-ink-2 hover:border-line-strong")}>
            {r}
          </button>
        ))}
      </div>
      <Input value={reasons.includes(value) ? "" : value} onChange={(e) => onChange(e.target.value)} placeholder="หรือพิมพ์เหตุผลอื่น" aria-label="เหตุผลอื่น" />
    </div>
  );
}

export function DiscountDialog({ order, open, onClose }: { order: Order | null; open: boolean; onClose: () => void }) {
  const { exec, pending } = useAction();
  const [type, setType] = useState<"percent" | "amount">("percent");
  const [value, setValue] = useState("10");
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (open) {
      setType("percent");
      setValue("10");
      setReason("");
    }
  }, [open]);
  if (!order) return null;
  const items = order.totals.itemsTotal;
  const v = Number(value) || 0;
  const discount = type === "percent" ? Math.round((items * Math.min(v, 100)) / 100) : Math.min(Math.round(v * 100), items);
  const apply = async () => {
    const res = await exec((d, c, approver) => applyDiscount(d, c, order.id, type, type === "percent" ? v : Math.round(v * 100), reason, approver), {
      approval: { permission: "pos.discount", title: `ส่วนลด ${type === "percent" ? `${v}%` : formatBaht(v * 100)} บิล #${order.orderNo}`, detail: `เหตุผล: ${reason || "-"}` },
      success: "ใส่ส่วนลดแล้ว",
      successDetail: `ลด ${formatBaht(discount)}`,
    });
    if (res.ok) onClose();
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="ให้ส่วนลด"
      description={`บิล #${order.orderNo} · ยอดอาหาร ${formatBaht(items)}`}
      footer={
        <Button size="lg" onClick={apply} loading={pending} disabled={!reason.trim() || v <= 0}>
          ลด {formatBaht(discount)}
        </Button>
      }
    >
      <div className="space-y-5 pb-2">
        <Segmented label="ประเภทส่วนลด" value={type} onChange={(t) => { setType(t); setValue(t === "percent" ? "10" : "20"); }} className="w-full" options={[{ value: "percent", label: "เปอร์เซ็นต์ (%)" }, { value: "amount", label: "จำนวนเงิน (฿)" }]} />
        <div className="flex flex-wrap gap-2">
          {(type === "percent" ? ["5", "10", "15", "20", "50"] : ["10", "20", "50", "100"]).map((p) => (
            <button key={p} type="button" onClick={() => setValue(p)} aria-pressed={value === p} className={cn("h-12 min-w-16 rounded-2xl border px-4 text-lg font-semibold tabular", value === p ? "border-brand bg-brand-soft text-brand-soft-ink" : "border-line text-ink hover:border-line-strong")}>
              {type === "percent" ? `${p}%` : `฿${p}`}
            </button>
          ))}
          <Input className="h-12 w-28 text-lg" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ""))} aria-label="กำหนดเอง" />
        </div>
        <ReasonPicker reasons={["ลูกค้าประจำ", "โปรโมชัน", "ชดเชยรอนาน", "พนักงาน"]} value={reason} onChange={setReason} />
        <p className="text-sm text-ink-3">ส่วนลดเกินวงเงินของคุณ ระบบจะขอให้ผู้จัดการใส่ PIN อนุมัติ — ไม่ต้องเดินไปตาม</p>
      </div>
    </Dialog>
  );
}

export function VoidDialog({ order, itemId, open, onClose }: { order: Order | null; itemId?: string; open: boolean; onClose: () => void }) {
  const { exec, pending } = useAction();
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (open) setReason("");
  }, [open]);
  if (!order) return null;
  const item = order.items.find((i) => i.id === itemId);
  const sent = item ? item.status !== "pending" : order.items.some((i) => i.status !== "pending" && i.status !== "voided");
  const run = async () => {
    const res = await exec(
      (d, c, approver) => (item ? voidItem(d, c, order.id, item.id, reason, approver) : voidOrder(d, c, order.id, reason, approver)),
      {
        approval: { permission: "pos.void", title: item ? `ยกเลิก “${item.name}” บิล #${order.orderNo}` : `ยกเลิกทั้งบิล #${order.orderNo}`, detail: `ครัวได้รับออเดอร์แล้ว · เหตุผล: ${reason}` },
        success: item ? `ยกเลิก “${item.name}” แล้ว` : "ยกเลิกบิลแล้ว",
        successDetail: sent ? "จอครัวแสดงว่ายกเลิกให้แล้ว" : undefined,
      },
    );
    if (res.ok) onClose();
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={item ? `ยกเลิก “${item.name}”?` : `ยกเลิกทั้งบิล #${order.orderNo}?`}
      description={sent ? "ครัวรับออเดอร์ไปแล้ว — ต้องให้ผู้จัดการอนุมัติ และจอครัวจะขึ้นว่ายกเลิก" : "ยังไม่ได้ส่งเข้าครัว ยกเลิกได้เลย"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            ไม่ยกเลิก
          </Button>
          <Button variant="danger" onClick={run} loading={pending} disabled={!reason.trim()}>
            ยืนยันยกเลิก
          </Button>
        </>
      }
    >
      <div className="pb-2">
        <ReasonPicker reasons={["ลูกค้าเปลี่ยนใจ", "สั่งผิด", "รอนานเกินไป", "ของหมด"]} value={reason} onChange={setReason} />
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Shifts
// ---------------------------------------------------------------------------
export function OpenShiftDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const db = useSabai((s) => s.db);
  const branchId = useSabai((s) => s.session.branchId) ?? "";
  const { exec, pending } = useAction();
  const last = db.shifts.filter((s) => s.branchId === branchId && s.status === "closed").at(-1);
  const [amount, setAmount] = useState("");
  useEffect(() => {
    if (open) setAmount(String((last?.countedCash ?? 200000) / 100));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async () => {
    const res = await exec((d, c) => openShift(d, c, Math.round(Number(amount || 0) * 100)), { success: "เปิดกะแล้ว ขายได้เลย" });
    if (res.ok) onClose();
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title="เปิดกะ" description="นับเงินทอนในลิ้นชักก่อนเริ่มขาย" size="sm" footer={<Button size="lg" block onClick={run} loading={pending}>เปิดกะด้วยเงินทอน {formatBaht(Math.round(Number(amount || 0) * 100))}</Button>}>
      <div className="space-y-4 pb-2">
        <div className="rounded-2xl bg-surface-2 p-4 text-center">
          <p className="text-sm text-ink-3">เงินทอนตั้งต้น</p>
          <p className="text-4xl font-bold tabular text-ink">{formatBaht(Math.round(Number(amount || 0) * 100))}</p>
          {last && <p className="mt-1 text-xs text-ink-3">ค่าเริ่มต้นจากเงินที่นับได้ตอนปิดกะครั้งก่อน</p>}
        </div>
        <Keypad onKey={(k) => setAmount((v) => (v.length > 6 ? v : v === "0" ? k : v + k))} onBackspace={() => setAmount((v) => v.slice(0, -1))} onClear={() => setAmount("")} />
      </div>
    </Dialog>
  );
}

const NOTES = [1000, 500, 100, 50, 20, 10, 5, 2, 1];

export function CloseShiftDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const db = useSabai((s) => s.db);
  const branchId = useSabai((s) => s.session.branchId) ?? "";
  const shift = openShiftOf(db, branchId);
  const { exec, pending } = useAction();
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [result, setResult] = useState<{ expected: Satang; counted: Satang; variance: Satang } | null>(null);
  useEffect(() => {
    if (open) {
      setCounts({});
      setResult(null);
    }
  }, [open]);
  const counted = NOTES.reduce((s, n) => s + n * 100 * (counts[n] ?? 0), 0);
  const run = async () => {
    const res = await exec((d, c) => closeShift(d, c, counted));
    if (res.ok) setResult(res.value);
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={result ? "ปิดกะเรียบร้อย" : "ปิดกะและนับเงินสด"} description={result ? undefined : "นับตามชนิดธนบัตร/เหรียญ ระบบรวมยอดให้ — ไม่ต้องใช้เครื่องคิดเลข"} size="md" footer={result ? <Button size="lg" onClick={onClose}>เสร็จสิ้น</Button> : <Button size="lg" onClick={run} loading={pending} disabled={!shift}>ปิดกะ · นับได้ {formatBaht(counted)}</Button>}>
      {result ? (
        <div className="space-y-3 pb-2 text-center">
          <p className={cn("text-4xl font-bold", result.variance === 0 ? "text-success" : result.variance < 0 ? "text-danger" : "text-warning")}>
            {result.variance === 0 ? "เงินตรงพอดี 🎉" : result.variance < 0 ? `ขาด ${formatBaht(-result.variance)}` : `เกิน ${formatBaht(result.variance)}`}
          </p>
          <p className="text-sm text-ink-3">
            ควรมี {formatBaht(result.expected)} · นับได้ {formatBaht(result.counted)}
          </p>
          {result.variance !== 0 && <Callout tone="warning">ระบบบันทึกส่วนต่างให้ผู้จัดการเห็นในหน้าปิดยอดแล้ว</Callout>}
        </div>
      ) : !shift ? (
        <EmptyState compact emoji="🗝️" title="ยังไม่มีกะที่เปิดอยู่" />
      ) : (
        <div className="grid gap-2 pb-2 sm:grid-cols-3">
          {NOTES.map((n) => (
            <div key={n} className="flex items-center justify-between rounded-2xl border border-line p-2 pl-3">
              <span className="font-semibold tabular text-ink">฿{n}</span>
              <div className="flex items-center gap-1">
                <button type="button" aria-label={`ลด ฿${n}`} onClick={() => setCounts((c) => ({ ...c, [n]: Math.max(0, (c[n] ?? 0) - 1) }))} className="h-10 w-10 rounded-xl bg-surface-2 text-lg hover:bg-surface-3">
                  −
                </button>
                <input aria-label={`จำนวน ฿${n}`} inputMode="numeric" value={counts[n] ?? 0} onChange={(e) => setCounts((c) => ({ ...c, [n]: Math.max(0, Number(e.target.value.replace(/\D/g, "")) || 0) }))} className="h-10 w-12 rounded-xl border border-line bg-surface text-center tabular" />
                <button type="button" aria-label={`เพิ่ม ฿${n}`} onClick={() => setCounts((c) => ({ ...c, [n]: (c[n] ?? 0) + 1 }))} className="h-10 w-10 rounded-xl bg-surface-2 text-lg hover:bg-surface-3">
                  +
                </button>
              </div>
            </div>
          ))}
          <p className="col-span-full pt-1 text-center text-xs text-ink-3">กะนี้ควรมีเงินสด {formatBaht(expectedCash(db, shift.id))} — ระบบบอกหลังนับเสร็จ เพื่อให้นับตามจริง</p>
        </div>
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Open bills & tables
// ---------------------------------------------------------------------------
export function OpenOrdersDialog({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (o: Order) => void }) {
  const db = useSabai((s) => s.db);
  const branchId = useSabai((s) => s.session.branchId) ?? "";
  const now = useNow(15_000);
  const orders = db.orders.filter((o) => o.branchId === branchId && o.status === "open").sort((a, b) => a.openedAt.localeCompare(b.openedAt));
  const branch = db.branches.find((b) => b.id === branchId);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title="บิลที่ยังเปิดอยู่" description="แตะเพื่อเพิ่มรายการหรือเก็บเงิน" size="lg">
      {orders.length === 0 ? (
        <EmptyState compact emoji="🧾" title="ไม่มีบิลค้าง" description="บิลที่ส่งเข้าครัวแต่ยังไม่ชำระจะอยู่ที่นี่" />
      ) : (
        <ul className="grid gap-2 pb-2 sm:grid-cols-2">
          {orders.map((o) => {
            const table = branch?.tables.find((t) => t.id === o.tableId);
            const ch = db.channels.find((c) => c.id === o.channelId);
            return (
              <li key={o.id}>
                <motion.button whileTap={{ scale: 0.98 }} onClick={() => onPick(o)} className="flex w-full items-center gap-3 rounded-2xl border border-line p-3 text-left hover:border-brand">
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-brand-soft text-lg font-bold text-brand-soft-ink">{table?.name ?? "#"}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-ink">
                      บิล #{o.orderNo} · {ch?.short}
                    </span>
                    <span className="flex items-center gap-1 text-sm text-ink-3">
                      <Clock className="h-3.5 w-3.5" aria-hidden="true" /> เปิดมา {Math.floor(elapsedSeconds(o.openedAt, now.getTime()) / 60)} นาที · {o.items.filter((i) => i.status !== "voided").length} รายการ
                    </span>
                  </span>
                  <span className="text-lg font-semibold tabular text-ink">{formatBaht(o.totals.total)}</span>
                </motion.button>
              </li>
            );
          })}
        </ul>
      )}
    </Dialog>
  );
}

export function TablePicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (tableId: string | undefined, guests: number) => void }) {
  const db = useSabai((s) => s.db);
  const branchId = useSabai((s) => s.session.branchId) ?? "";
  const branch = db.branches.find((b) => b.id === branchId);
  const [guests, setGuests] = useState(2);
  const busy = useMemo(() => new Map(db.orders.filter((o) => o.status === "open" && o.branchId === branchId && o.tableId).map((o) => [o.tableId!, o])), [db.orders, branchId]);
  const zones = [...new Set(branch?.tables.map((t) => t.zone))];
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title="เลือกโต๊ะ" description="โต๊ะที่มีบิลค้างจะแสดงยอดไว้ แตะเพื่อสั่งเพิ่ม" size="lg">
      <div className="space-y-5 pb-2">
        <div className="flex items-center gap-3">
          <Users className="h-5 w-5 text-ink-3" aria-hidden="true" />
          <span className="text-sm text-ink-2">จำนวนลูกค้า</span>
          <Segmented label="จำนวนลูกค้า" size="sm" value={String(guests)} onChange={(v) => setGuests(Number(v))} options={["1", "2", "3", "4", "5", "6"].map((v) => ({ value: v, label: v }))} />
        </div>
        {(branch?.tables.length ?? 0) === 0 && <EmptyState compact emoji="🪑" title="ยังไม่ได้ตั้งโต๊ะ" description="เพิ่มโต๊ะได้ที่ ตั้งค่า → สาขา หรือขายแบบไม่ระบุโต๊ะไปก่อน" />}
        {zones.map((z) => (
          <div key={z}>
            <p className="mb-2 text-sm font-medium text-ink-3">{z}</p>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
              {branch?.tables
                .filter((t) => t.zone === z)
                .map((t) => {
                  const o = busy.get(t.id);
                  return (
                    <motion.button key={t.id} whileTap={{ scale: 0.95 }} onClick={() => onPick(t.id, guests)} className={cn("flex h-20 flex-col items-center justify-center rounded-2xl border-2 text-lg font-bold", o ? "border-accent bg-accent-soft text-accent-ink" : "border-line bg-surface text-ink hover:border-brand")}>
                      {t.name}
                      <span className="text-xs font-medium">{o ? formatBaht(o.totals.total, { compact: true }) : `${t.seats} ที่นั่ง`}</span>
                    </motion.button>
                  );
                })}
            </div>
          </div>
        ))}
        <Button variant="secondary" block onClick={() => onPick(undefined, guests)}>
          ไม่ระบุโต๊ะ
        </Button>
      </div>
    </Dialog>
  );
}
