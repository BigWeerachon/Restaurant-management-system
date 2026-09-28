"use client";

import { formatQty, type StockReason } from "@sabai/domain";
import { AlertTriangle, CheckCircle2, ClipboardCheck, OctagonAlert, PackagePlus, Plus, Trash2, TrendingDown } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { PageHeader } from "@/components/app/page-header";
import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { TabPanel, Tabs } from "@/components/ui/overlay";
import { Badge, Card, SearchInput, Segmented } from "@/components/ui/primitives";
import { useAccess } from "@/hooks/use-sabai";
import { actorName } from "@/lib/demo/engine";
import { formatBaht, stockRows, type StockRow } from "@/lib/demo/selectors";
import { useSabai } from "@/lib/demo/store";

const STATUS = {
  negative: { label: "ติดลบ", tone: "danger" as const, icon: OctagonAlert, hint: "ขายเกินกว่าที่รับเข้า — อาจลืมบันทึกรับของ" },
  out: { label: "หมด", tone: "danger" as const, icon: OctagonAlert, hint: "" },
  low: { label: "ใกล้หมด", tone: "warning" as const, icon: AlertTriangle, hint: "" },
  ok: { label: "ปกติ", tone: "success" as const, icon: CheckCircle2, hint: "" },
};

const REASON: Record<StockReason, string> = {
  opening: "ยอดยกมา",
  purchase: "รับของเข้า",
  sale: "ขาย (ตัดตามสูตร)",
  sale_void: "คืนเข้าสต็อก",
  waste: "ของเสีย",
  count_adjust: "ปรับตามที่นับ",
  transfer_out: "โอนออก",
  transfer_in: "รับโอน",
  production_out: "ใช้ผลิต",
  production_in: "ผลิตได้",
  return_to_supplier: "คืนผู้ขาย",
  manual_adjust: "ปรับยอด",
};

function StockList({ rows, showValue }: { rows: StockRow[]; showValue: boolean }) {
  return (
    <ul className="divide-y divide-line">
      {rows.map((r, i) => {
        const st = STATUS[r.status];
        const Ico = st.icon;
        return (
          <motion.li key={r.ingredient.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(i * 0.01, 0.2) }} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 sm:flex-nowrap">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-surface-2 text-2xl" aria-hidden="true">
              {r.ingredient.emoji}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-ink">{r.ingredient.name}</p>
              <p className="truncate text-sm text-ink-3">
                {r.ingredient.category}
                {r.ingredient.zone ? ` · ${r.ingredient.zone}` : ""}
              </p>
            </div>
            <div className="w-28 text-right">
              <p className="text-[17px] font-semibold tabular text-ink">{formatQty(r.qty, r.ingredient.baseUnit, r.ingredient.displayUnit)}</p>
              {r.daysLeft !== null && r.qty > 0 && <p className="text-xs text-ink-3">พอใช้อีก ~{r.daysLeft < 1 ? "<1" : Math.round(r.daysLeft)} วัน</p>}
            </div>
            <div className="w-24">
              <Badge tone={st.tone} icon={<Ico className="h-3.5 w-3.5" aria-hidden="true" />}>
                {st.label}
              </Badge>
            </div>
            <div className="w-36 text-sm">
              {r.suggestion ? (
                <Link href="/purchasing" className="inline-flex items-center gap-1 font-medium text-brand hover:underline">
                  <TrendingDown className="h-4 w-4" aria-hidden="true" /> ควรสั่ง {r.suggestion.packs} {r.ingredient.pack?.name.split(" ")[0] ?? "หน่วย"}
                </Link>
              ) : r.onOrder > 0 ? (
                <span className="text-ink-3">สั่งไว้แล้ว {formatQty(r.onOrder, r.ingredient.baseUnit, r.ingredient.displayUnit)}</span>
              ) : (
                <span className="text-ink-3">—</span>
              )}
            </div>
            {showValue && <div className="hidden w-24 text-right text-sm tabular text-ink-2 md:block">{formatBaht(Math.round(r.value * 100))}</div>}
          </motion.li>
        );
      })}
    </ul>
  );
}

function InventoryInner() {
  const db = useSabai((s) => s.db);
  const { branch, can } = useAccess();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [filter, setFilter] = useState<"all" | "attention" | "ok">("all");
  const [tab, setTab] = useState("stock");
  const rows = useMemo(() => stockRows(db, branch.id), [db, branch.id]);
  const attention = rows.filter((r) => r.status !== "ok");
  const shown = rows.filter((r) => (filter === "all" ? true : filter === "attention" ? r.status !== "ok" : r.status === "ok") && (!q || r.ingredient.name.includes(q)));
  const totalValue = rows.reduce((s, r) => s + r.value, 0);
  const moves = db.movements.filter((m) => m.branchId === branch.id && m.reason !== "opening").slice(-60).reverse();

  return (
    <>
      <PageHeader
        title="สต็อก"
        description={`${branch.name} · ระบบตัดสต็อกตามสูตรทุกครั้งที่ขาย แค่บันทึกรับของ ของเสีย และนับเป็นระยะ`}
        actions={
          <>
            {can("inventory.waste") && (
              <LinkButton href="/inventory/waste" variant="secondary" icon={<Trash2 className="h-4 w-4" />}>
                ของเสีย
              </LinkButton>
            )}
            {can("inventory.count") && (
              <LinkButton href="/inventory/count" variant="secondary" icon={<ClipboardCheck className="h-4 w-4" />}>
                นับสต็อก
              </LinkButton>
            )}
            {can("inventory.receive") && (
              <LinkButton href="/inventory/receive" icon={<PackagePlus className="h-4 w-4" />}>
                รับของเข้า
              </LinkButton>
            )}
          </>
        }
      />

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            emoji="🥕"
            title="ยังไม่มีวัตถุดิบในร้าน"
            description="เริ่มจากของที่ใช้บ่อยที่สุด 5 อย่างก็พอ เช่น ข้าว ไข่ นม — ที่เหลือค่อยเพิ่มตอนรับของเข้า ระบบจะจำราคาและขนาดแพ็กให้"
            action={can("inventory.manage") ? <LinkButton href="/inventory/new" icon={<Plus className="h-4 w-4" />}>เพิ่มวัตถุดิบแรก</LinkButton> : undefined}
          />
        </Card>
      ) : (
        <Tabs
          value={tab}
          onValueChange={setTab}
          tabs={[
            { value: "stock", label: "คงเหลือ", count: attention.length },
            { value: "moves", label: "ความเคลื่อนไหว" },
          ]}
        >
          <TabPanel value="stock" className="pt-4">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Segmented
                label="กรองสถานะ"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: "all", label: `ทั้งหมด ${rows.length}` },
                  { value: "attention", label: `ต้องดูแล ${attention.length}` },
                  { value: "ok", label: `ปกติ ${rows.length - attention.length}` },
                ]}
              />
              <SearchInput value={q} onChange={setQ} placeholder="ค้นหาวัตถุดิบ" className="sm:max-w-xs sm:flex-1" />
              <div className="flex items-center gap-3 sm:ml-auto">
                {can("costs.view") && <span className="text-sm text-ink-3">มูลค่าสต็อก <strong className="tabular text-ink">{formatBaht(Math.round(totalValue * 100), { compact: true })}</strong></span>}
                {can("inventory.manage") && (
                  <LinkButton href="/inventory/new" variant="secondary" size="sm" icon={<Plus className="h-4 w-4" />}>
                    เพิ่มวัตถุดิบ
                  </LinkButton>
                )}
              </div>
            </div>
            <Card className="overflow-hidden">
              {shown.length === 0 ? <EmptyState compact emoji="🔍" title="ไม่พบรายการ" description="ลองเปลี่ยนคำค้นหาหรือตัวกรอง" /> : <StockList rows={shown} showValue={can("costs.view")} />}
            </Card>
          </TabPanel>
          <TabPanel value="moves" className="pt-4">
            <Card className="overflow-hidden">
              {moves.length === 0 ? (
                <EmptyState compact emoji="📦" title="ยังไม่มีความเคลื่อนไหว" description="รับของ ขาย ของเสีย และการนับ จะขึ้นที่นี่ทั้งหมด" />
              ) : (
                <ul className="divide-y divide-line">
                  {moves.map((m) => {
                    const ing = db.ingredients.find((i) => i.id === m.ingredientId);
                    if (!ing) return null;
                    return (
                      <li key={m.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                        <span className="text-xl" aria-hidden="true">
                          {ing.emoji}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="font-medium text-ink">{ing.name}</span> <span className="text-ink-3">· {REASON[m.reason]}</span>
                          {m.note && <span className="text-ink-3"> · {m.note}</span>}
                        </span>
                        <span className="hidden text-ink-3 sm:inline">{actorName(db, m.by)}</span>
                        <span className="w-16 text-right text-ink-3">{new Date(m.at).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}</span>
                        <span className={m.qty < 0 ? "w-24 text-right font-medium tabular text-danger" : "w-24 text-right font-medium tabular text-success"}>
                          {m.qty > 0 ? "+" : "−"}
                          {formatQty(Math.abs(m.qty), ing.baseUnit, ing.displayUnit)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </TabPanel>
        </Tabs>
      )}
    </>
  );
}

export default function InventoryPage() {
  return (
    <Suspense>
      <InventoryInner />
    </Suspense>
  );
}
