"use client";

import { applyRate, divRound } from "@sabai/domain";
import { ArrowLeft, Bike, Save } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/app/page-header";
import { CostMeter, HealthBadge, HEALTH, RecipeEditor, SuggestedPrice, fromRecipe, toRecipe, useCosting, type EditableLine } from "@/components/app/recipe-editor";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { Card, CardHeader, Input } from "@/components/ui/primitives";
import { useAccess, useAction } from "@/hooks/use-sabai";
import { priceFor, updateMenuItem } from "@/lib/demo/engine";
import { formatBaht } from "@/lib/demo/selectors";
import { useSabai } from "@/lib/demo/store";

export default function MenuItemPage() {
  const { id } = useParams<{ id: string }>();
  const db = useSabai((s) => s.db);
  const { can } = useAccess();
  const { exec, pending } = useAction();
  const item = db.menuItems.find((m) => m.id === id);
  const [lines, setLines] = useState<EditableLine[]>([]);
  const [price, setPrice] = useState("");
  useEffect(() => {
    if (item) {
      setLines(fromRecipe(db, item.recipe));
      setPrice(String(item.price / 100));
    }
  }, [item?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const costing = useCosting(db, lines, Number(price) || 0);
  if (!item) return <EmptyState emoji="🔍" title="ไม่พบเมนูนี้" description="อาจถูกลบไปแล้ว" action={<Link href="/menu" className="font-medium text-brand">กลับไปหน้าเมนู</Link>} />;

  const showCost = can("costs.view");
  const dirty = Number(price) * 100 !== item.price || JSON.stringify(toRecipe(lines)) !== JSON.stringify(item.recipe ?? { yieldQty: 1, lines: [] });
  const cat = db.menuCategories.find((c) => c.id === item.categoryId);
  const h = HEALTH[costing.health];

  const save = () =>
    exec(
      (d, c) =>
        updateMenuItem(d, c, item.id, {
          ...(can("menu.manage") ? { price: Math.round(Number(price) * 100) } : {}),
          ...(can("recipes.manage") ? { recipe: lines.length ? toRecipe(lines) : undefined } : {}),
        }),
      { success: "บันทึกแล้ว", successDetail: "ราคาใหม่มีผลกับบิลถัดไปทุกเครื่อง" },
    );

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/menu" className="inline-flex items-center gap-1 hover:text-ink"><ArrowLeft className="h-4 w-4" /> เมนู</Link>}
        title={
          <span className="flex items-center gap-3">
            <span className="text-4xl" aria-hidden="true">
              {item.emoji}
            </span>
            {item.name}
          </span>
        }
        description={`${cat?.name ?? ""} · ${item.route === "bar" ? "ทำที่บาร์" : "ทำที่ครัว"}`}
        actions={(can("menu.manage") || can("recipes.manage")) && <Button icon={<Save className="h-4 w-4" />} disabled={!dirty} loading={pending} onClick={save}>บันทึกการเปลี่ยนแปลง</Button>}
      />
      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader title="สูตรต่อ 1 จาน/แก้ว" description={can("recipes.manage") ? "แก้ปริมาณแล้วดูต้นทุนเปลี่ยนทันที" : "ดูสูตรเพื่อทำให้ได้มาตรฐานเดียวกันทุกครั้ง"} />
          <div className="p-5">
            {can("recipes.manage") ? (
              <RecipeEditor db={db} lines={lines} onChange={setLines} showCost={showCost} />
            ) : (
              <ul className="divide-y divide-line">
                {lines.map((l) => {
                  const ing = db.ingredients.find((i) => i.id === l.ingredientId)!;
                  return (
                    <li key={l.ingredientId} className="flex items-center gap-3 py-2.5 text-[15px]">
                      <span aria-hidden="true">{ing.emoji}</span>
                      <span className="flex-1 text-ink">{ing.name}</span>
                      <span className="font-semibold tabular text-ink">
                        {l.amount} {l.unit === "g" ? "กรัม" : l.unit === "ml" ? "มล." : "ชิ้น"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            {showCost && costing.breakdown.lines.length > 0 && (
              <div className="mt-6">
                <p className="mb-3 text-sm font-medium text-ink-3">อะไรทำให้จานนี้แพง</p>
                <ul className="space-y-2">
                  {costing.breakdown.lines.slice(0, 6).map((l, i) => (
                    <li key={l.ingredientId} className="grid grid-cols-[8rem_1fr_4.5rem] items-center gap-3 text-sm">
                      <span className="truncate text-ink-2">{l.name}</span>
                      <span className="h-3 overflow-hidden rounded-full bg-surface-3">
                        <motion.span className="block h-full rounded-full bg-series-1" initial={{ width: 0 }} animate={{ width: `${l.share * 100}%` }} transition={{ delay: i * 0.05, type: "spring", stiffness: 120, damping: 20 }} />
                      </span>
                      <span className="text-right tabular text-ink">{formatBaht(Math.round(l.cost * 100))}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Card>

        <div className="space-y-6">
          <Card className="p-5">
            <p className="text-sm font-medium text-ink-3">ราคาขาย</p>
            {can("menu.manage") ? (
              <Input className="mt-2 h-14 text-2xl font-bold" inputMode="decimal" aria-label="ราคาขาย" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ""))} prefix="฿" />
            ) : (
              <p className="text-3xl font-bold text-ink">{formatBaht(item.price)}</p>
            )}
            {showCost && (
              <div className="mt-5 space-y-4">
                <div className="flex items-baseline justify-between">
                  <span className="text-ink-3">ต้นทุนต่อจาน</span>
                  <span className="text-2xl font-bold tabular text-ink">{formatBaht(Math.round(costing.breakdown.cost * 100))}</span>
                </div>
                {lines.length > 0 ? (
                  <>
                    <CostMeter pct={costing.pct} health={costing.health} />
                    <div className="flex items-center gap-2">
                      <HealthBadge health={costing.health} />
                      <span className="text-sm text-ink-3">{h.advice}</span>
                    </div>
                    {can("menu.manage") && <SuggestedPrice price={Number(price)} suggested={costing.suggested} onUse={(p) => setPrice(String(p))} />}
                  </>
                ) : (
                  <p className="text-sm text-ink-3">ใส่สูตรเพื่อดูต้นทุนและกำไรต่อจาน</p>
                )}
              </div>
            )}
          </Card>

          {showCost && lines.length > 0 && (
            <Card>
              <CardHeader title="เหลือจริงต่อจาน แยกตามช่องทาง" description="หลังหัก VAT ต้นทุนวัตถุดิบ และค่า GP" icon={<Bike className="h-5 w-5" />} />
              <ul className="space-y-2 p-5 pt-4">
                {db.channels
                  .filter((c) => c.active)
                  .map((c) => {
                    const p = priceFor({ price: Math.round(Number(price || 0) * 100) }, c);
                    const vat = db.tenant.vatRegistered ? divRound(p * 700, 10700) : 0;
                    const gp = applyRate(p, c.commissionRate);
                    const keep = p - vat - gp - Math.round(costing.breakdown.cost * 100);
                    return (
                      <li key={c.id} className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-3 py-2.5 text-sm">
                        <span className="flex items-center gap-2 text-ink">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} aria-hidden="true" />
                          {c.name}
                          <span className="text-ink-3">ขาย {formatBaht(p, { compact: true })}</span>
                        </span>
                        <span className={keep < 0 ? "font-semibold tabular text-danger" : "font-semibold tabular text-ink"}>เหลือ {formatBaht(keep)}</span>
                      </li>
                    );
                  })}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
