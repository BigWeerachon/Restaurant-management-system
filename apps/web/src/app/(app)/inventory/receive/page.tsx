"use client";

import { formatQty } from "@sabai/domain";
import { ArrowLeft, ArrowRight, Camera, Minus, Plus, Store, Trash2, TrendingUp, Truck } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { LoadBanner } from "@/components/app/load-banner";
import { PageHeader } from "@/components/app/page-header";
import { Button, LinkButton } from "@/components/ui/button";
import { EmptyState, Stepper, SuccessCheck } from "@/components/ui/feedback";
import { Badge, Callout, Card, Input, SearchInput } from "@/components/ui/primitives";
import { useDsAction, useLoad } from "@/hooks/use-data-source";
import { useAccess } from "@/hooks/use-sabai";
import { cn } from "@/lib/cn";
import { formatBaht } from "@/lib/demo/selectors";
import { useSabai } from "@/lib/demo/store";

interface Line {
  ingredientId: string;
  packName: string;
  packQty: number;
  qtyPacks: number;
  price: string;
}

export default function ReceivePage() {
  const db = useSabai((s) => s.db);
  const { branch } = useAccess();
  const { exec, pending } = useDsAction();
  const load = useLoad(["stock", "purchasing"]);
  const [step, setStep] = useState(0);
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [poId, setPoId] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<"cash_paid" | "transfer_paid" | "credit">("cash_paid");
  const [photo, setPhoto] = useState<string | null>(null);
  const [result, setResult] = useState<{ grNo: string; total: number; priceAlerts: { ingredientId: string; pct: number }[] } | null>(null);

  const supplier = db.suppliers.find((s) => s.id === supplierId);
  const openPos = db.purchaseOrders.filter((p) => p.branchId === branch.id && ["approved", "sent", "partially_received"].includes(p.status));
  const suggested = useMemo(() => db.ingredients.filter((i) => i.trackStock && (!supplierId || i.pack?.supplierId === supplierId)), [db.ingredients, supplierId]);
  const searchable = db.ingredients.filter((i) => i.trackStock && !lines.some((l) => l.ingredientId === i.id) && (!q || i.name.includes(q)));

  const addLine = (id: string) => {
    const ing = db.ingredients.find((i) => i.id === id)!;
    setLines((ls) => [...ls, { ingredientId: id, packName: ing.pack?.name ?? `1 ${ing.baseUnit}`, packQty: ing.pack?.qty ?? 1, qtyPacks: 1, price: ing.pack ? String(ing.pack.price / 100) : "" }]);
    setQ("");
  };
  const usePo = (id: string) => {
    const po = db.purchaseOrders.find((p) => p.id === id)!;
    setPoId(id);
    setSupplierId(po.supplierId);
    setMode("credit");
    setLines(po.lines.map((l) => ({ ingredientId: l.ingredientId, packName: l.packName, packQty: l.packQty, qtyPacks: l.qtyPacks - l.receivedPacks, price: String(l.unitPrice / 100) })));
    setStep(1);
  };
  const total = lines.reduce((s, l) => s + Math.round(l.qtyPacks * Number(l.price || 0) * 100), 0);

  const save = async () => {
    const r = await exec((ds) =>
      ds.receiveGoods({
        supplierId: supplierId ?? undefined,
        poId: poId ?? undefined,
        paymentMode: mode,
        lines: lines.map((l) => ({ ingredientId: l.ingredientId, packName: l.packName, packQty: l.packQty, qtyPacks: l.qtyPacks, unitPrice: Math.round(Number(l.price || 0) * 100) })),
      }),
    );
    if (r.ok) setResult(r.value);
  };

  if (result) {
    return (
      <div className="mx-auto max-w-xl">
        <Card className="flex flex-col items-center gap-3 p-8 text-center">
          <SuccessCheck />
          <h1 className="text-2xl font-bold text-ink">รับของเรียบร้อย</h1>
          <p className="text-ink-3">
            {result.grNo} · {formatBaht(result.total)} · สต็อกอัปเดตแล้ว{mode === "credit" ? " · ตั้งบิลค้างจ่ายให้แล้ว" : ""}
          </p>
          {result.priceAlerts.length > 0 && (
            <Callout tone="warning" title="ราคาวัตถุดิบขึ้น" className="w-full text-left">
              {result.priceAlerts.map((a) => `${db.ingredients.find((i) => i.id === a.ingredientId)?.name} +${a.pct}%`).join(", ")} — ต้นทุนเมนูที่ใช้วัตถุดิบนี้อัปเดตให้แล้ว
            </Callout>
          )}
          <div className="mt-2 flex gap-2">
            <LinkButton href="/inventory">ดูสต็อก</LinkButton>
            <Button
              variant="secondary"
              onClick={() => {
                setResult(null);
                setStep(0);
                setLines([]);
                setSupplierId(null);
                setPoId(null);
                setPhoto(null);
              }}
            >
              รับของอีกรายการ
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader eyebrow={<Link href="/inventory" className="inline-flex items-center gap-1 hover:text-ink"><ArrowLeft className="h-4 w-4" /> สต็อก</Link>} title="รับของเข้า" description="3 ขั้นตอน: ซื้อจากใคร → ได้อะไรมาบ้าง → จ่ายเงินยังไง ระบบจำขนาดแพ็กและราคาครั้งก่อนให้" />
      <LoadBanner state={load} className="mb-4" />
      <Stepper steps={["ซื้อจากใคร", "รายการที่ได้รับ", "การจ่ายเงิน"]} current={step} className="mb-6" />

      <AnimatePresence mode="wait">
        {step === 0 && (
          <motion.div key="s0" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} className="space-y-5">
            {openPos.length > 0 && (
              <Card className="p-4">
                <p className="mb-3 font-semibold text-ink">รับของตามใบสั่งซื้อ</p>
                <ul className="space-y-2">
                  {openPos.map((p) => (
                    <li key={p.id}>
                      <button onClick={() => usePo(p.id)} className="flex w-full items-center gap-3 rounded-2xl border border-line p-3 text-left hover:border-brand">
                        <Truck className="h-6 w-6 text-brand" aria-hidden="true" />
                        <span className="flex-1">
                          <span className="block font-medium text-ink">
                            {p.poNo} · {db.suppliers.find((s) => s.id === p.supplierId)?.name}
                          </span>
                          <span className="text-sm text-ink-3">{p.lines.length} รายการ · {formatBaht(p.total)}</span>
                        </span>
                        <ArrowRight className="h-4 w-4 text-ink-3" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={() => {
                  setSupplierId(null);
                  setMode("cash_paid");
                  setStep(1);
                }}
                className="flex items-center gap-3 rounded-2xl border-2 border-dashed border-line-strong bg-surface p-4 text-left hover:border-brand"
              >
                <Store className="h-8 w-8 text-accent-ink" aria-hidden="true" />
                <span>
                  <span className="block font-semibold text-ink">ซื้อจากตลาด / ร้านทั่วไป</span>
                  <span className="text-sm text-ink-3">จ่ายเงินสดแล้ว ไม่ต้องระบุผู้ขาย</span>
                </span>
              </motion.button>
              {db.suppliers.map((s) => (
                <motion.button
                  key={s.id}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => {
                    setSupplierId(s.id);
                    setMode(s.paymentTermsDays > 0 ? "credit" : "cash_paid");
                    setStep(1);
                  }}
                  className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-4 text-left shadow-xs hover:border-brand"
                >
                  <Truck className="h-8 w-8 text-ink-3" aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-ink">{s.name}</span>
                    <span className="text-sm text-ink-3">{s.paymentTermsDays > 0 ? `เครดิต ${s.paymentTermsDays} วัน` : "จ่ายเงินสด"}</span>
                  </span>
                </motion.button>
              ))}
            </div>
          </motion.div>
        )}

        {step === 1 && (
          <motion.div key="s1" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} className="space-y-4">
            <Card className="p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <p className="font-semibold text-ink">{supplier ? supplier.name : "ซื้อจากตลาด"}</p>
                <label className="ml-auto inline-flex h-11 cursor-pointer items-center gap-2 rounded-xl border border-line px-4 text-sm font-medium text-ink-2 hover:bg-surface-2">
                  <Camera className="h-4 w-4" aria-hidden="true" />
                  {photo ? "เปลี่ยนรูปบิล" : "ถ่ายรูปบิล"}
                  <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => e.target.files?.[0] && setPhoto(URL.createObjectURL(e.target.files[0]))} />
                </label>
                {photo && <img src={photo} alt="รูปบิล" className="h-11 w-11 rounded-lg object-cover ring-1 ring-line" />}
              </div>
              {suggested.length > 0 && lines.length === 0 && (
                <div className="mt-3">
                  <p className="mb-2 text-sm text-ink-3">ซื้อจาก{supplier ? "ผู้ขายรายนี้" : "ที่นี่"}บ่อย</p>
                  <div className="flex flex-wrap gap-2">
                    {suggested.slice(0, 10).map((i) => (
                      <button key={i.id} onClick={() => addLine(i.id)} className="h-10 rounded-full border border-line px-3 text-sm text-ink hover:border-brand">
                        {i.emoji} {i.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </Card>

            <Card className="overflow-hidden">
              {lines.length === 0 ? (
                <EmptyState compact emoji="🧺" title="ยังไม่มีรายการ" description="ค้นหาวัตถุดิบด้านล่าง หรือแตะรายการที่ซื้อบ่อยด้านบน" />
              ) : (
                <ul className="divide-y divide-line">
                  <AnimatePresence initial={false}>
                    {lines.map((l, idx) => {
                      const ing = db.ingredients.find((i) => i.id === l.ingredientId)!;
                      const lastPrice = ing.pack?.price ? ing.pack.price / 100 : null;
                      const up = lastPrice && Number(l.price) > lastPrice * 1.05 ? Math.round((Number(l.price) / lastPrice - 1) * 100) : 0;
                      const set = (patch: Partial<Line>) => setLines((ls) => ls.map((x, i) => (i === idx ? { ...x, ...patch } : x)));
                      return (
                        <motion.li key={l.ingredientId} layout initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="flex flex-wrap items-center gap-3 p-4">
                          <span className="text-3xl" aria-hidden="true">
                            {ing.emoji}
                          </span>
                          <div className="min-w-40 flex-1">
                            <p className="font-medium text-ink">{ing.name}</p>
                            <p className="text-sm text-ink-3">
                              {l.packName} · รวม {formatQty(l.qtyPacks * l.packQty, ing.baseUnit, ing.displayUnit)}
                            </p>
                          </div>
                          <div className="flex items-center rounded-xl bg-surface-2" role="group" aria-label={`จำนวน ${ing.name}`}>
                            <button className="grid h-11 w-11 place-items-center rounded-xl hover:bg-surface-3" onClick={() => set({ qtyPacks: Math.max(1, l.qtyPacks - 1) })} aria-label="ลด">
                              <Minus className="h-4 w-4" />
                            </button>
                            <span className="w-10 text-center font-semibold tabular">{l.qtyPacks}</span>
                            <button className="grid h-11 w-11 place-items-center rounded-xl hover:bg-surface-3" onClick={() => set({ qtyPacks: l.qtyPacks + 1 })} aria-label="เพิ่ม">
                              <Plus className="h-4 w-4" />
                            </button>
                          </div>
                          <div className="w-36">
                            <Input inputMode="decimal" aria-label={`ราคาต่อ${l.packName}`} value={l.price} onChange={(e) => set({ price: e.target.value.replace(/[^\d.]/g, "") })} prefix="฿" suffix="/แพ็ก" />
                          </div>
                          <div className="w-24 text-right font-semibold tabular text-ink">{formatBaht(Math.round(l.qtyPacks * Number(l.price || 0) * 100))}</div>
                          <button onClick={() => setLines((ls) => ls.filter((_, i) => i !== idx))} className="grid h-11 w-11 place-items-center rounded-xl text-ink-3 hover:bg-surface-2 hover:text-danger" aria-label={`ลบ ${ing.name}`}>
                            <Trash2 className="h-4 w-4" />
                          </button>
                          {up > 0 && (
                            <p className="w-full">
                              <Badge tone="warning" icon={<TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />}>
                                แพงขึ้น {up}% จากครั้งก่อน (฿{lastPrice})
                              </Badge>
                            </p>
                          )}
                        </motion.li>
                      );
                    })}
                  </AnimatePresence>
                </ul>
              )}
              <div className="border-t border-line p-4">
                <SearchInput value={q} onChange={setQ} placeholder="+ เพิ่มวัตถุดิบ (พิมพ์ชื่อ)" />
                {q && (
                  <ul className="mt-2 max-h-56 overflow-y-auto rounded-xl border border-line">
                    {searchable.slice(0, 8).map((i) => (
                      <li key={i.id}>
                        <button onClick={() => addLine(i.id)} className="flex h-12 w-full items-center gap-3 px-3 text-left hover:bg-surface-2">
                          <span aria-hidden="true">{i.emoji}</span> {i.name}
                        </button>
                      </li>
                    ))}
                    {searchable.length === 0 && (
                      <li className="p-3 text-sm text-ink-3">
                        ไม่พบ “{q}” — <Link href="/inventory/new" className="font-medium text-brand">เพิ่มเป็นวัตถุดิบใหม่</Link>
                      </li>
                    )}
                  </ul>
                )}
              </div>
            </Card>
            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep(0)} icon={<ArrowLeft className="h-4 w-4" />}>
                ย้อนกลับ
              </Button>
              <Button size="lg" disabled={lines.length === 0 || lines.some((l) => !l.price)} onClick={() => setStep(2)} iconRight={<ArrowRight className="h-4 w-4" />}>
                ต่อไป · {formatBaht(total)}
              </Button>
            </div>
          </motion.div>
        )}

        {step === 2 && (
          <motion.div key="s2" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} className="space-y-4">
            <Card className="p-5">
              <p className="mb-3 font-semibold text-ink">จ่ายเงินยังไง</p>
              <div role="radiogroup" aria-label="การจ่ายเงิน" className="grid gap-2 sm:grid-cols-3">
                {([
                  ["cash_paid", "จ่ายเงินสดแล้ว", "หักจากเงินสดในร้าน"],
                  ["transfer_paid", "โอนจ่ายแล้ว", "หักจากบัญชีธนาคาร"],
                  ["credit", "ค้างจ่าย (เครดิต)", supplier ? `ครบกำหนดใน ${supplier.paymentTermsDays} วัน` : "ต้องเลือกผู้ขายก่อน"],
                ] as const).map(([v, label, hint]) => (
                  <button key={v} role="radio" aria-checked={mode === v} disabled={v === "credit" && !supplier} onClick={() => setMode(v)} className={cn("rounded-2xl border-2 p-4 text-left disabled:opacity-40", mode === v ? "border-brand bg-brand-soft" : "border-line hover:border-line-strong")}>
                    <span className="block font-semibold text-ink">{label}</span>
                    <span className="text-sm text-ink-3">{hint}</span>
                  </button>
                ))}
              </div>
            </Card>
            <Card className="p-5">
              <dl className="space-y-2 text-[15px]">
                <div className="flex justify-between">
                  <dt className="text-ink-3">ผู้ขาย</dt>
                  <dd className="text-ink">{supplier?.name ?? "ตลาด / ร้านทั่วไป"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-3">จำนวนรายการ</dt>
                  <dd className="text-ink">{lines.length} รายการ</dd>
                </div>
                <div className="flex items-baseline justify-between border-t border-line pt-3">
                  <dt className="font-semibold text-ink">ยอดรวม</dt>
                  <dd className="text-2xl font-bold tabular text-ink">{formatBaht(total)}</dd>
                </div>
              </dl>
            </Card>
            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep(1)} icon={<ArrowLeft className="h-4 w-4" />}>
                ย้อนกลับ
              </Button>
              <Button size="lg" loading={pending} onClick={save}>
                ยืนยันรับของ
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
