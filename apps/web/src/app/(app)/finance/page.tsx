"use client";

import { addDays, formatThaiDate, suggestMatches } from "@sabai/domain";
import { ArrowRight, Banknote, Check, CircleHelp, Landmark, Link2, Moon, Plus, Upload } from "lucide-react";
import { motion } from "motion/react";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { LoadBanner } from "@/components/app/load-banner";
import { PageHeader } from "@/components/app/page-header";
import { Button, LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { Dialog, TabPanel, Tabs } from "@/components/ui/overlay";
import { Badge, Callout, Card, CardHeader, Field, Input, Segmented } from "@/components/ui/primitives";
import { useDsAction, useLoad } from "@/hooks/use-data-source";
import { useAccess, useBusinessDate, useHistory } from "@/hooks/use-sabai";
import { cn } from "@/lib/cn";
import { expectedCash, openShiftOf } from "@/lib/demo/engine";
import { formatBaht } from "@/lib/demo/selectors";
import { useSabai } from "@/lib/demo/store";
import type { Expense } from "@/lib/demo/types";

const MONTHLY: Expense["category"][] = ["rent", "salaries", "utilities"];
const CATEGORIES: { value: Expense["category"]; label: string; emoji: string }[] = [
  { value: "rent", label: "ค่าเช่า", emoji: "🏠" },
  { value: "salaries", label: "ค่าแรง", emoji: "👥" },
  { value: "utilities", label: "น้ำ ไฟ แก๊ส", emoji: "💡" },
  { value: "marketing", label: "การตลาด", emoji: "📣" },
  { value: "supplies", label: "ของใช้", emoji: "🧻" },
  { value: "repairs", label: "ซ่อมบำรุง", emoji: "🔧" },
  { value: "other", label: "อื่นๆ", emoji: "📎" },
];

function TodaySummary() {
  const db = useSabai((s) => s.db);
  const { branch, can } = useAccess();
  const date = useBusinessDate();
  const orders = db.orders.filter((o) => o.branchId === branch.id && o.businessDate === date && o.status === "paid");
  const byMethod = new Map<string, number>();
  const byChannel = new Map<string, { total: number; n: number }>();
  for (const o of orders) {
    for (const p of o.payments) byMethod.set(p.methodId, (byMethod.get(p.methodId) ?? 0) + (p.kind === "payment" ? p.amount : -p.amount));
    const c = byChannel.get(o.channelId) ?? { total: 0, n: 0 };
    byChannel.set(o.channelId, { total: c.total + o.totals.total, n: c.n + 1 });
  }
  const shift = openShiftOf(db, branch.id);
  const closed = db.dayCloses.find((d) => d.branchId === branch.id && d.businessDate === date);
  const total = orders.reduce((s, o) => s + o.totals.total, 0);
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="p-5 lg:col-span-1">
        <p className="text-sm text-ink-3">ยอดขายวันนี้ ({formatThaiDate(date)})</p>
        <p className="mt-1 text-3xl font-bold tabular text-ink">{formatBaht(total)}</p>
        <p className="text-sm text-ink-3">{orders.length} บิล · VAT {formatBaht(orders.reduce((s, o) => s + o.totals.vatAmount, 0))}</p>
        {shift && (
          <div className="mt-4 rounded-2xl bg-surface-2 p-3 text-sm">
            <p className="flex items-center gap-2 text-ink-2">
              <Banknote className="h-4 w-4" aria-hidden="true" /> เงินสดที่ควรมีในลิ้นชักตอนนี้
            </p>
            <p className="text-xl font-semibold tabular text-ink">{formatBaht(shift.expectedCash ?? expectedCash(db, shift.id))}</p>
          </div>
        )}
        {closed ? (
          <Callout tone="success" className="mt-4" title="ปิดยอดวันนี้แล้ว">
            รายการใหม่จะไปอยู่ในวันถัดไปอัตโนมัติ
          </Callout>
        ) : (
          can("finance.close_day") && (
            <LinkButton href="/finance/close" block className="mt-4" icon={<Moon className="h-4 w-4" />}>
              ปิดยอดวันนี้
            </LinkButton>
          )
        )}
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader title="แยกตามช่องทางขาย และวิธีรับเงิน" description="ยอดเดลิเวอรีจะโอนเข้าบัญชีตามรอบของแต่ละแพลตฟอร์ม" />
        <div className="grid gap-6 p-5 sm:grid-cols-2">
          <ul className="space-y-2">
            {[...byChannel].map(([id, v]) => {
              const c = db.channels.find((x) => x.id === id);
              return (
                <li key={id} className="flex items-center justify-between gap-2 text-[15px]">
                  <span className="flex items-center gap-2 text-ink-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: c?.color }} aria-hidden="true" />
                    {c?.name} <span className="text-sm text-ink-3">({v.n})</span>
                  </span>
                  <span className="font-medium tabular text-ink">{formatBaht(v.total)}</span>
                </li>
              );
            })}
            {byChannel.size === 0 && <li className="text-sm text-ink-3">ยังไม่มีการขาย</li>}
          </ul>
          <ul className="space-y-2">
            {[...byMethod].map(([id, v]) => (
              <li key={id} className="flex items-center justify-between gap-2 text-[15px]">
                <span className="text-ink-2">{db.paymentMethods.find((m) => m.id === id)?.name}</span>
                <span className="font-medium tabular text-ink">{formatBaht(v)}</span>
              </li>
            ))}
          </ul>
        </div>
      </Card>
    </div>
  );
}

function Reconcile() {
  const db = useSabai((s) => s.db);
  const { exec } = useDsAction();
  const lines = db.statementLines.filter((l) => l.status === "unmatched");
  const open = db.expected.filter((e) => e.status === "open");
  const suggestions = useMemo(
    () =>
      suggestMatches(
        lines.map((l) => ({ id: l.id, date: l.date, amount: l.amount, description: l.description })),
        open.map((e) => ({ id: e.id, label: e.label, expectedDate: e.expectedDate, amount: e.amount, sourceType: e.sourceType, payer: e.payer })),
      ),
    [lines, open],
  );
  const today = useBusinessDate();
  const overdue = open.filter((e) => e.expectedDate < today && !suggestions.some((s) => s.expectedIds.includes(e.id)));
  const matched = db.statementLines.filter((l) => l.status === "matched");

  return (
    <div className="space-y-5">
      <Callout tone="info" title="ทำงานยังไง">
        ระบบรู้ว่าเงินจากบัตร พร้อมเพย์ และแพลตฟอร์มเดลิเวอรีควรเข้าเมื่อไรและเท่าไร (หัก GP และค่าธรรมเนียมแล้ว) เมื่อนำเข้ารายการเดินบัญชี ระบบจะจับคู่ให้ — คุณแค่กดยืนยัน
      </Callout>
      {lines.length === 0 ? (
        <Card>
          <EmptyState compact emoji="🏦" title="ไม่มีรายการเงินเข้ารอตรวจ" description="นำเข้าไฟล์รายการเดินบัญชี (CSV) จากแอปธนาคาร ระบบจะจับคู่ให้อัตโนมัติ" action={<Button variant="secondary" icon={<Upload className="h-4 w-4" />}>นำเข้า CSV (เร็วๆ นี้)</Button>} />
        </Card>
      ) : (
        <ul className="space-y-3">
          {lines.map((l, i) => {
            const s = suggestions.find((x) => x.lineId === l.id);
            const exp = s ? open.filter((e) => s.expectedIds.includes(e.id)) : [];
            return (
              <motion.li key={l.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                <Card className="p-4">
                  <div className="grid items-center gap-4 md:grid-cols-[1fr_auto_1fr_auto]">
                    <div className="flex items-center gap-3">
                      <span className="grid h-11 w-11 place-items-center rounded-xl bg-surface-2 text-ink-2">
                        <Landmark className="h-5 w-5" aria-hidden="true" />
                      </span>
                      <div>
                        <p className="font-medium text-ink">{l.description}</p>
                        <p className="text-sm text-ink-3">
                          {formatThaiDate(l.date, false)} · <strong className="tabular text-ink">{formatBaht(l.amount)}</strong>
                        </p>
                      </div>
                    </div>
                    <Link2 className="hidden h-5 w-5 text-ink-3 md:block" aria-hidden="true" />
                    <div>
                      {s ? (
                        <>
                          <p className="text-sm font-medium text-ink">{exp.map((e) => e.label).join(" + ")}</p>
                          <p className="text-sm text-ink-3">
                            คาดไว้ {formatBaht(exp.reduce((a, e) => a + e.amount, 0))}
                            {s.variance !== 0 && <span className="text-warning"> · ส่วนต่าง {formatBaht(s.variance, { sign: true })}</span>}
                          </p>
                          {s.varianceHint && <p className="mt-1 text-xs text-ink-3">{s.varianceHint}</p>}
                        </>
                      ) : (
                        <p className="flex items-center gap-1.5 text-sm text-ink-3">
                          <CircleHelp className="h-4 w-4" aria-hidden="true" /> ไม่ตรงกับยอดขายใดๆ — อาจเป็นเงินโอนอื่น
                        </p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      {s ? (
                        <Button size="sm" icon={<Check className="h-4 w-4" />} onClick={() => exec((ds) => ds.matchStatementLine(l.id, s.expectedIds, s.varianceHint), { success: "กระทบยอดแล้ว", successDetail: s.variance ? `บันทึกส่วนต่าง ${formatBaht(s.variance)} ให้แล้ว` : "ยอดตรงพอดี" })}>
                          {s.reason === "exact" ? "ตรงกัน ยืนยัน" : "ยืนยัน"}
                        </Button>
                      ) : null}
                      <Button size="sm" variant="ghost" onClick={() => exec((ds) => ds.ignoreStatementLine(l.id), { success: "ข้ามรายการนี้แล้ว" })}>
                        ไม่เกี่ยวกับการขาย
                      </Button>
                    </div>
                  </div>
                  {s && (
                    <div className="mt-3 flex items-center gap-2">
                      <Badge tone={s.reason === "exact" ? "success" : s.reason === "combined" ? "info" : "warning"}>{s.reason === "exact" ? "ยอดตรงทุกบาท" : s.reason === "combined" ? "รวมหลายวันในการโอนเดียว" : "ยอดใกล้เคียง"}</Badge>
                      <span className="text-xs text-ink-3">ความมั่นใจ {Math.round(s.confidence * 100)}%</span>
                    </div>
                  )}
                </Card>
              </motion.li>
            );
          })}
        </ul>
      )}
      {overdue.length > 0 && (
        <Card>
          <CardHeader title="เงินที่ควรเข้าแล้วแต่ยังไม่เห็น" description="ติดตามกับธนาคารหรือแพลตฟอร์ม หากเกิน 2–3 วันทำการ" />
          <ul className="divide-y divide-line px-5 pb-3 pt-2">
            {overdue.slice(0, 8).map((e) => (
              <li key={e.id} className="flex items-center justify-between py-2 text-[15px]">
                <span className="text-ink">{e.label}</span>
                <span className="text-sm text-ink-3">ควรเข้า {formatThaiDate(e.expectedDate, false)}</span>
                <span className="font-medium tabular text-ink">{formatBaht(e.amount)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {matched.length > 0 && <p className="text-sm text-ink-3">กระทบยอดแล้ว {matched.length} รายการ</p>}
    </div>
  );
}

function Bills() {
  const db = useSabai((s) => s.db);
  const { can } = useAccess();
  const { exec, pending } = useDsAction();
  const today = useBusinessDate();
  const [paying, setPaying] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const bills = db.bills.filter((b) => b.status !== "paid").sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const bill = bills.find((b) => b.id === paying);
  return (
    <>
      <Card className="overflow-hidden">
        {bills.length === 0 ? (
          <EmptyState compact emoji="🎉" title="ไม่มีบิลค้างจ่าย" description="บิลจากการรับของแบบเครดิตจะมาอยู่ที่นี่ พร้อมวันครบกำหนด" />
        ) : (
          <ul className="divide-y divide-line">
            {bills.map((b) => {
              const overdue = b.dueDate < today;
              return (
                <li key={b.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="min-w-48 flex-1">
                    <span className="block font-medium text-ink">{db.suppliers.find((s) => s.id === b.supplierId)?.name ?? "ไม่ระบุผู้ขาย"}</span>
                    <span className="text-sm text-ink-3">
                      {b.billNo} · ครบกำหนด {formatThaiDate(b.dueDate, false)}
                    </span>
                  </span>
                  {overdue ? <Badge tone="danger" dot>เลยกำหนด</Badge> : <Badge tone="info" dot>รอจ่าย</Badge>}
                  <span className="w-28 text-right font-semibold tabular text-ink">{formatBaht(b.total - b.paid)}</span>
                  {can("finance.manage") && (
                    <Button
                      size="sm"
                      onClick={() => {
                        setPaying(b.id);
                        setAmount(String((b.total - b.paid) / 100));
                      }}
                    >
                      จ่าย
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <Dialog open={!!bill} onOpenChange={(v) => !v && setPaying(null)} title="จ่ายบิล" description={bill ? `${db.suppliers.find((s) => s.id === bill.supplierId)?.name ?? "ไม่ระบุผู้ขาย"} · ${bill.billNo}` : ""} size="sm" footer={
        <Button
          loading={pending}
          onClick={async () => {
            if (!bill) return;
            const r = await exec((ds) => ds.payBill(bill.id, Math.round(Number(amount) * 100)), { success: "บันทึกการจ่ายแล้ว" });
            if (r.ok) setPaying(null);
          }}
        >
          จ่าย {formatBaht(Math.round(Number(amount || 0) * 100))}
        </Button>
      }>
        <Field label="จำนวนเงิน" hint="จ่ายบางส่วนได้" htmlFor="amt">
          <Input id="amt" inputMode="decimal" prefix="฿" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} />
        </Field>
      </Dialog>
    </>
  );
}

function Expenses() {
  const db = useSabai((s) => s.db);
  const { branch, can } = useAccess();
  const history = useHistory();
  const date = useBusinessDate();
  const { exec, pending } = useDsAction();
  const [category, setCategory] = useState<Expense["category"]>("utilities");
  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");
  const [paidFrom, setPaidFrom] = useState<Expense["paidFrom"]>("bank");
  const [cover, setCover] = useState<"once" | "month">("month");
  const [error, setError] = useState<Record<string, string>>({});
  const pickCategory = (c: Expense["category"]) => {
    setCategory(c);
    // Smart default: rent, wages and utilities are monthly costs.
    setCover(MONTHLY.includes(c) ? "month" : "once");
  };
  const list = [...db.expenses, ...history.expenses].filter((e) => e.branchId === branch.id).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 15);
  const save = async () => {
    const e: Record<string, string> = {};
    if (!desc.trim()) e.desc = "บอกว่าจ่ายค่าอะไร";
    if (!(Number(amount) > 0)) e.amount = "ใส่จำนวนเงิน";
    setError(e);
    if (Object.keys(e).length) return;
    const monthStart = `${date.slice(0, 8)}01`;
    const period = cover === "month" ? { periodStart: monthStart, periodEnd: addDays(`${addDays(monthStart, 32).slice(0, 8)}01`, -1) } : {};
    const r = await exec((ds) => ds.addExpense({ branchId: branch.id, date, category, description: desc, amount: Math.round(Number(amount) * 100), paidFrom, ...period }), { success: "บันทึกค่าใช้จ่ายแล้ว", successDetail: "นับรวมในรายงานเงินเหลือจริงแล้ว" });
    if (r.ok) {
      setDesc("");
      setAmount("");
    }
  };
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
      {can("finance.manage") && (
        <Card className="space-y-4 p-5">
          <p className="font-semibold text-ink">บันทึกค่าใช้จ่าย</p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="หมวดค่าใช้จ่าย">
            {CATEGORIES.map((c) => (
              <button key={c.value} role="radio" aria-checked={category === c.value} onClick={() => pickCategory(c.value)} className={cn("h-10 rounded-full border px-3 text-sm", category === c.value ? "border-brand bg-brand-soft text-brand-soft-ink" : "border-line text-ink-2 hover:border-line-strong")}>
                {c.emoji} {c.label}
              </button>
            ))}
          </div>
          <Field label="จ่ายค่าอะไร" required error={error.desc} htmlFor="desc">
            <Input id="desc" value={desc} invalid={!!error.desc} onChange={(e) => setDesc(e.target.value)} placeholder="เช่น ค่าไฟเดือนกันยายน" />
          </Field>
          <Field label="จำนวนเงิน" required error={error.amount} htmlFor="xamt">
            <Input id="xamt" inputMode="decimal" prefix="฿" invalid={!!error.amount} value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} />
          </Field>
          <div>
            <Segmented label="ค่าใช้จ่ายนี้เป็นของ" value={cover} onChange={setCover} className="w-full" options={[{ value: "month", label: "ทั้งเดือนนี้" }, { value: "once", label: "วันนี้ครั้งเดียว" }]} />
            <p className="mt-1.5 text-xs text-ink-3">{cover === "month" ? "ระบบจะเฉลี่ยให้ทุกวันของเดือน กำไรรายวันและรายสัปดาห์จึงไม่เพี้ยนในวันที่จ่าย" : "นับเป็นค่าใช้จ่ายของวันนี้ทั้งหมด"}</p>
          </div>
          <Segmented label="จ่ายจาก" value={paidFrom} onChange={setPaidFrom} className="w-full" options={[{ value: "bank", label: "โอนจากบัญชี" }, { value: "cash_on_hand", label: "เงินสดในร้าน" }]} />
          <Button block loading={pending} onClick={save} icon={<Plus className="h-4 w-4" />}>
            บันทึก
          </Button>
        </Card>
      )}
      <Card className="overflow-hidden">
        <CardHeader title="ค่าใช้จ่ายล่าสุด" />
        <ul className="divide-y divide-line px-2 pb-2 pt-3">
          {list.map((e) => (
            <li key={e.id} className="flex items-center gap-3 px-3 py-2.5 text-[15px]">
              <span aria-hidden="true">{CATEGORIES.find((c) => c.value === e.category)?.emoji}</span>
              <span className="min-w-0 flex-1 truncate text-ink">{e.description}</span>
              <span className="text-sm text-ink-3">{formatThaiDate(e.date, false)}</span>
              <span className="w-24 text-right font-medium tabular text-ink">{formatBaht(e.amount, { compact: true })}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function FinanceInner() {
  const params = useSearchParams();
  const { can } = useAccess();
  const db = useSabai((s) => s.db);
  const load = useLoad(["orders", "shifts", "finance"]);
  const [tab, setTab] = useState(params.get("tab") ?? "today");
  const tabs = [
    { value: "today", label: "สรุปวันนี้" },
    ...(can("finance.reconcile") ? [{ value: "reconcile", label: "เงินที่ต้องเข้า", count: db.statementLines.filter((l) => l.status === "unmatched").length }] : []),
    ...(can("finance.view") ? [{ value: "bills", label: "บิลค้างจ่าย", count: db.bills.filter((b) => b.status !== "paid").length }] : []),
    ...(can("finance.view") ? [{ value: "expenses", label: "ค่าใช้จ่าย" }] : []),
  ];
  return (
    <>
      <PageHeader title="การเงิน" description="ยอดขาย เงินที่ต้องเข้าธนาคาร บิลที่ต้องจ่าย และค่าใช้จ่าย — ระบบลงบัญชีให้เองเบื้องหลัง" actions={can("reports.profit") && <LinkButton href="/reports" variant="secondary" iconRight={<ArrowRight className="h-4 w-4" />}>ดูเงินเหลือจริง</LinkButton>} />
      <LoadBanner state={load} className="mb-4" />
      <Tabs value={tab} onValueChange={setTab} tabs={tabs}>
        <TabPanel value="today" className="pt-4">
          <TodaySummary />
        </TabPanel>
        <TabPanel value="reconcile" className="pt-4">
          <Reconcile />
        </TabPanel>
        <TabPanel value="bills" className="pt-4">
          <Bills />
        </TabPanel>
        <TabPanel value="expenses" className="pt-4">
          <Expenses />
        </TabPanel>
      </Tabs>
    </>
  );
}

export default function FinancePage() {
  return (
    <Suspense>
      <FinanceInner />
    </Suspense>
  );
}
