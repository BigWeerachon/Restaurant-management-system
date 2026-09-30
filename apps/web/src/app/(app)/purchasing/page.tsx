"use client";

import { formatQty, formatThaiDate } from "@sabai/domain";
import { Check, Copy, MessageCircle, Minus, PackageCheck, Plus, Truck } from "lucide-react";
import { motion } from "motion/react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { LoadBanner } from "@/components/app/load-banner";
import { PageHeader } from "@/components/app/page-header";
import { Button, LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { Dialog, TabPanel, Tabs } from "@/components/ui/overlay";
import { Badge, Card, CardHeader } from "@/components/ui/primitives";
import { useDsAction, useLoad } from "@/hooks/use-data-source";
import { useAccess } from "@/hooks/use-sabai";
import { formatBaht, stockRows } from "@/lib/demo/selectors";
import { useSabai } from "@/lib/demo/store";
import type { PurchaseOrder } from "@/lib/demo/types";

const PO_STATUS: Record<PurchaseOrder["status"], { label: string; tone: "neutral" | "info" | "brand" | "warning" | "success" | "danger" }> = {
  draft: { label: "รออนุมัติ", tone: "warning" },
  approved: { label: "อนุมัติแล้ว", tone: "info" },
  sent: { label: "ส่งให้ผู้ขายแล้ว", tone: "brand" },
  partially_received: { label: "รับของบางส่วน", tone: "warning" },
  received: { label: "รับครบแล้ว", tone: "success" },
  cancelled: { label: "ยกเลิก", tone: "neutral" },
};

export default function PurchasingPage() {
  const db = useSabai((s) => s.db);
  const { branch, can } = useAccess();
  const { exec, pending } = useDsAction();
  const load = useLoad(["stock", "purchasing"]);
  const [tab, setTab] = useState("suggest");
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [lineMsg, setLineMsg] = useState<PurchaseOrder | null>(null);

  const suggestions = useMemo(() => stockRows(db, branch.id).filter((r) => r.suggestion), [db, branch.id]);
  const groups = useMemo(() => {
    const m = new Map<string, typeof suggestions>();
    for (const s of suggestions) {
      const sup = s.ingredient.pack?.supplierId ?? "none";
      m.set(sup, [...(m.get(sup) ?? []), s]);
    }
    return [...m.entries()];
  }, [suggestions]);
  const pos = db.purchaseOrders.filter((p) => p.branchId === branch.id);

  const message = (po: PurchaseOrder) => {
    const sup = db.suppliers.find((s) => s.id === po.supplierId);
    return [
      `สวัสดีค่ะ ${sup?.name ?? ""}`,
      `${db.tenant.name} (${branch.name}) ขอสั่งของ เลขที่ ${po.poNo}`,
      ...po.lines.map((l, i) => `${i + 1}. ${db.ingredients.find((x) => x.id === l.ingredientId)?.name} ${l.packName} × ${l.qtyPacks}`),
      `ส่งภายใน ${po.expectedDate ? formatThaiDate(po.expectedDate, false) : "เร็วที่สุด"} ที่ ${branch.address ?? branch.name}`,
      "ขอบคุณค่ะ 🙏",
    ].join("\n");
  };

  return (
    <>
      <PageHeader title="สั่งซื้อ" description="ระบบดูของที่ใกล้หมด คิดจำนวนเป็นแพ็กให้ และหักของที่สั่งไปแล้ว — แค่ตรวจแล้วกดสั่ง" actions={can("inventory.receive") && <LinkButton href="/inventory/receive" variant="secondary" icon={<PackageCheck className="h-4 w-4" />}>รับของเข้า</LinkButton>} />
      <LoadBanner state={load} className="mb-4" />
      <Tabs value={tab} onValueChange={setTab} tabs={[{ value: "suggest", label: "ควรสั่ง", count: suggestions.length }, { value: "pos", label: "ใบสั่งซื้อ", count: pos.filter((p) => !["received", "cancelled"].includes(p.status)).length }, { value: "suppliers", label: "ผู้ขาย" }]}>
        <TabPanel value="suggest" className="space-y-4 pt-4">
          {groups.length === 0 ? (
            <Card>
              <EmptyState emoji="🧺" title="ยังไม่มีของที่ต้องสั่ง" description="เมื่อวัตถุดิบเหลือต่ำกว่าจุดเตือน ระบบจะคำนวณจำนวนที่ควรสั่งมาให้ที่นี่ ตั้งจุดเตือนได้ตอนเพิ่มวัตถุดิบ" />
            </Card>
          ) : (
            groups.map(([supId, rows], gi) => {
              const sup = db.suppliers.find((s) => s.id === supId);
              const total = rows.reduce((s, r) => s + (overrides[r.ingredient.id] ?? r.suggestion!.packs) * (r.ingredient.pack?.price ?? 0), 0);
              return (
                <motion.div key={supId} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: gi * 0.05 }}>
                  <Card>
                    <CardHeader
                      icon={<Truck className="h-5 w-5" />}
                      title={sup?.name ?? "ยังไม่ระบุผู้ขาย"}
                      description={sup ? `ส่งภายใน ${sup.leadTimeDays} วัน · ${sup.paymentTermsDays ? `เครดิต ${sup.paymentTermsDays} วัน` : "จ่ายเงินสด"}` : "ซื้อจากตลาด หรือกำหนดผู้ขายตอนรับของครั้งถัดไป"}
                      action={
                        sup && can("purchasing.manage") ? (
                          <Button
                            loading={pending}
                            onClick={async () => {
                              const r = await exec((ds) => ds.createPurchaseOrder(sup.id, rows.map((x) => ({ ingredientId: x.ingredient.id, qtyPacks: overrides[x.ingredient.id] ?? x.suggestion!.packs }))), { success: "สร้างใบสั่งซื้อแล้ว" });
                              if (r.ok) {
                                setTab("pos");
                                if (r.value.status === "approved") setLineMsg(r.value);
                              }
                            }}
                          >
                            สั่งซื้อ {formatBaht(total, { compact: true })}
                          </Button>
                        ) : undefined
                      }
                    />
                    <ul className="divide-y divide-line px-2 pb-2 pt-3">
                      {rows.map((r) => {
                        const packs = overrides[r.ingredient.id] ?? r.suggestion!.packs;
                        return (
                          <li key={r.ingredient.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                            <span className="text-2xl" aria-hidden="true">
                              {r.ingredient.emoji}
                            </span>
                            <span className="min-w-40 flex-1">
                              <span className="block font-medium text-ink">{r.ingredient.name}</span>
                              <span className="text-sm text-ink-3">
                                เหลือ {formatQty(r.qty, r.ingredient.baseUnit, r.ingredient.displayUnit)}
                                {r.daysLeft !== null && ` · พอใช้ ~${Math.max(0, Math.round(r.daysLeft))} วัน`}
                              </span>
                            </span>
                            <span className="flex items-center rounded-xl bg-surface-2" role="group" aria-label={`จำนวน ${r.ingredient.name}`}>
                              <button className="grid h-10 w-10 place-items-center rounded-xl hover:bg-surface-3" onClick={() => setOverrides((o) => ({ ...o, [r.ingredient.id]: Math.max(0, packs - 1) }))} aria-label="ลด">
                                <Minus className="h-4 w-4" />
                              </button>
                              <span className="w-8 text-center font-semibold tabular">{packs}</span>
                              <button className="grid h-10 w-10 place-items-center rounded-xl hover:bg-surface-3" onClick={() => setOverrides((o) => ({ ...o, [r.ingredient.id]: packs + 1 }))} aria-label="เพิ่ม">
                                <Plus className="h-4 w-4" />
                              </button>
                            </span>
                            <span className="w-28 text-sm text-ink-3">{r.ingredient.pack?.name ?? "หน่วย"}</span>
                            <span className="w-20 text-right text-sm tabular text-ink-2">{formatBaht(packs * (r.ingredient.pack?.price ?? 0), { compact: true })}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </Card>
                </motion.div>
              );
            })
          )}
        </TabPanel>

        <TabPanel value="pos" className="pt-4">
          <Card className="overflow-hidden">
            {pos.length === 0 ? (
              <EmptyState compact emoji="📄" title="ยังไม่มีใบสั่งซื้อ" description="สร้างจากแท็บ “ควรสั่ง” ได้ในคลิกเดียว" />
            ) : (
              <ul className="divide-y divide-line">
                {pos.map((p) => {
                  const st = PO_STATUS[p.status];
                  return (
                    <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                      <span className="min-w-48 flex-1">
                        <span className="block font-semibold text-ink">
                          {p.poNo} · {db.suppliers.find((s) => s.id === p.supplierId)?.name}
                        </span>
                        <span className="text-sm text-ink-3">
                          {p.lines.length} รายการ · ส่งภายใน {p.expectedDate ? formatThaiDate(p.expectedDate, false) : "-"}
                        </span>
                      </span>
                      <Badge tone={st.tone} dot>
                        {st.label}
                      </Badge>
                      <span className="w-24 text-right font-semibold tabular">{formatBaht(p.total)}</span>
                      <span className="flex gap-2">
                        {p.status === "draft" && can("purchasing.approve") && (
                          <Button size="sm" icon={<Check className="h-4 w-4" />} onClick={() => exec((ds) => ds.setPurchaseOrderStatus(p.id, "approved"), { success: "อนุมัติแล้ว" })}>
                            อนุมัติ
                          </Button>
                        )}
                        {p.status === "approved" && (
                          <Button size="sm" variant="secondary" icon={<MessageCircle className="h-4 w-4" />} onClick={() => setLineMsg(p)}>
                            ส่งทาง LINE
                          </Button>
                        )}
                        {["approved", "sent", "partially_received"].includes(p.status) && can("inventory.receive") && (
                          <LinkButton href="/inventory/receive" size="sm" variant="secondary">
                            รับของ
                          </LinkButton>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </TabPanel>

        <TabPanel value="suppliers" className="pt-4">
          {db.suppliers.length === 0 ? (
            <Card>
              <EmptyState compact emoji="🚚" title="ยังไม่มีผู้ขาย" description="ผู้ขายจะถูกเพิ่มให้อัตโนมัติเมื่อรับของครั้งแรก" />
            </Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {db.suppliers.map((s) => (
                <Card key={s.id} className="p-4">
                  <p className="font-semibold text-ink">{s.name}</p>
                  <p className="text-sm text-ink-3">{s.paymentTermsDays ? `เครดิต ${s.paymentTermsDays} วัน` : "จ่ายเงินสด"} · ส่งภายใน {s.leadTimeDays} วัน</p>
                  {(s.phone || s.lineId) && <p className="mt-2 text-sm text-ink-2">{[s.phone, s.lineId && `LINE ${s.lineId}`].filter(Boolean).join(" · ")}</p>}
                  <p className="mt-2 text-xs text-ink-3">{db.ingredients.filter((i) => i.pack?.supplierId === s.id).length} รายการที่ซื้อประจำ</p>
                </Card>
              ))}
            </div>
          )}
        </TabPanel>
      </Tabs>

      <Dialog open={!!lineMsg} onOpenChange={(v) => !v && setLineMsg(null)} title="ส่งใบสั่งซื้อทาง LINE" description="คัดลอกข้อความไปวางในแชตกับผู้ขาย แล้วกดยืนยันว่าส่งแล้ว" footer={lineMsg && (
        <>
          <Button
            variant="secondary"
            icon={<Copy className="h-4 w-4" />}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(message(lineMsg));
                toast.success("คัดลอกข้อความแล้ว", { description: "เปิด LINE แล้ววางในแชตกับผู้ขายได้เลย" });
              } catch {
                toast.info("คัดลอกไม่ได้ในเบราว์เซอร์นี้", { description: "เลือกข้อความแล้วกดคัดลอกเองได้" });
              }
            }}
          >
            คัดลอกข้อความ
          </Button>
          <Button
            onClick={async () => {
              const r = await exec((ds) => ds.setPurchaseOrderStatus(lineMsg.id, "sent"), { success: "บันทึกว่าส่งแล้ว" });
              if (r.ok) setLineMsg(null);
            }}
          >
            ส่งแล้ว
          </Button>
        </>
      )}>
        {lineMsg && <pre className="whitespace-pre-wrap rounded-2xl bg-surface-2 p-4 font-sans text-[15px] text-ink">{message(lineMsg)}</pre>}
      </Dialog>
    </>
  );
}
