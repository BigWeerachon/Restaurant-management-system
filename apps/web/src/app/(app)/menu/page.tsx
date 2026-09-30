"use client";

import { foodCostPct, marginHealth } from "@sabai/domain";
import { AlertTriangle, ChefHat, Plus } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { LoadBanner } from "@/components/app/load-banner";
import { PageHeader } from "@/components/app/page-header";
import { HealthBadge } from "@/components/app/recipe-editor";
import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { Switch } from "@/components/ui/overlay";
import { Badge, Card, SearchInput, Segmented } from "@/components/ui/primitives";
import { useDsAction, useLoad } from "@/hooks/use-data-source";
import { useAccess } from "@/hooks/use-sabai";
import { cn } from "@/lib/cn";
import { menuItemCostOf } from "@/lib/demo/menu";
import { formatBaht } from "@/lib/demo/selectors";
import { useSabai } from "@/lib/demo/store";

function MenuInner() {
  const db = useSabai((s) => s.db);
  const { branch, can } = useAccess();
  const { exec } = useDsAction();
  const load = useLoad(["bootstrap", "availability"]);
  const params = useSearchParams();
  const [cat, setCat] = useState("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"name" | "cost">(params.get("sort") === "cost" ? "cost" : "name");
  const showCost = can("costs.view");
  const vat = db.tenant.vatRegistered ? db.tenant.vatRate : 0;

  const rows = useMemo(
    () =>
      db.menuItems
        .filter((m) => (cat === "all" || m.categoryId === cat) && (!q || m.name.includes(q)))
        .map((m) => {
          const cost = menuItemCostOf(db, m);
          const pct = foodCostPct(cost, m.price / 100, vat, db.tenant.pricesIncludeVat);
          return { m, cost, pct, health: marginHealth(pct) };
        })
        .sort((a, b) => (sort === "cost" ? b.pct - a.pct : a.m.name.localeCompare(b.m.name, "th"))),
    [db, cat, q, sort, vat],
  );
  const noRecipe = db.menuItems.filter((m) => !m.recipe?.lines.length).length;
  const avg = rows.filter((r) => r.m.recipe).reduce((s, r, _, a) => s + r.pct / a.length, 0);

  return (
    <>
      <PageHeader
        title="เมนูและสูตร"
        description="ใส่สูตรแล้วระบบจะตัดสต็อกให้เองทุกครั้งที่ขาย และบอกต้นทุน-กำไรต่อจานทันที"
        actions={can("menu.manage") && <LinkButton href="/menu/new" icon={<Plus className="h-4 w-4" />}>เพิ่มเมนู</LinkButton>}
      />
      <LoadBanner state={load} className="mb-4" />
      {db.menuItems.length === 0 ? (
        <Card>
          <EmptyState emoji="📋" title="ยังไม่มีเมนู" description="เพิ่มเมนูแรกด้วยชื่อ ราคา และรูปไอคอน — จะใส่สูตรตอนนี้หรือทีหลังก็ได้" action={can("menu.manage") ? <LinkButton href="/menu/new" icon={<Plus className="h-4 w-4" />}>เพิ่มเมนูแรก</LinkButton> : undefined} />
        </Card>
      ) : (
        <>
          {showCost && (
            <div className="mb-4 grid gap-3 sm:grid-cols-3">
              <Card className="p-4">
                <p className="text-sm text-ink-3">ต้นทุนเฉลี่ยต่อราคาขาย</p>
                <p className="text-2xl font-bold text-ink">{(avg * 100).toFixed(1)}%</p>
              </Card>
              <Card className="p-4">
                <p className="text-sm text-ink-3">เมนูที่ต้นทุนควรดู</p>
                <p className="text-2xl font-bold text-ink">{rows.filter((r) => r.health === "watch" || r.health === "high").length} เมนู</p>
              </Card>
              <Card className={cn("p-4", noRecipe > 0 && "border-warning-fill/40")}>
                <p className="text-sm text-ink-3">ยังไม่มีสูตร (ตัดสต็อกไม่ได้)</p>
                <p className="text-2xl font-bold text-ink">{noRecipe} เมนู</p>
              </Card>
            </div>
          )}
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
              {[{ id: "all", name: "ทั้งหมด", emoji: "🍽️" }, ...db.menuCategories].map((c) => (
                <button key={c.id} onClick={() => setCat(c.id)} aria-pressed={cat === c.id} className={cn("h-10 shrink-0 rounded-full border px-3.5 text-sm font-medium", cat === c.id ? "border-brand bg-brand-soft text-brand-soft-ink" : "border-line text-ink-2 hover:border-line-strong")}>
                  {c.emoji} {c.name}
                </button>
              ))}
            </div>
            <SearchInput value={q} onChange={setQ} placeholder="ค้นหาเมนู" className="lg:ml-auto lg:w-64" />
            {showCost && <Segmented label="เรียงตาม" value={sort} onChange={setSort} options={[{ value: "name", label: "ชื่อ" }, { value: "cost", label: "ต้นทุนสูงสุด" }]} />}
          </div>
          <Card className="overflow-hidden">
            <ul className="divide-y divide-line">
              {rows.map(({ m, cost, pct, health }, i) => (
                <motion.li key={m.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(i * 0.015, 0.25) }} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                  <Link href={`/menu/${m.id}`} className="-m-1 flex min-w-0 flex-1 items-center gap-3 rounded-xl p-1 hover:bg-surface-2">
                    <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-surface-2 text-3xl" aria-hidden="true">
                      {m.emoji}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-ink">{m.name}</span>
                      <span className="flex items-center gap-2 text-sm text-ink-3">
                        {db.menuCategories.find((c) => c.id === m.categoryId)?.name}
                        <span className="inline-flex items-center gap-1"><ChefHat className="h-3.5 w-3.5" aria-hidden="true" /> {m.route === "bar" ? "บาร์" : "ครัว"}</span>
                      </span>
                    </span>
                  </Link>
                  <span className="w-20 text-right font-semibold tabular text-ink">{formatBaht(m.price, { compact: true })}</span>
                  {showCost && (
                    <span className="w-24 text-right text-sm tabular text-ink-2">
                      {m.recipe ? (
                        <>
                          ทุน {formatBaht(Math.round(cost * 100))}
                          <span className="block text-xs text-ink-3">{(pct * 100).toFixed(0)}%</span>
                        </>
                      ) : (
                        "—"
                      )}
                    </span>
                  )}
                  <span className="w-36">
                    {!m.recipe ? (
                      <Badge tone="warning" icon={<AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />}>
                        ยังไม่มีสูตร
                      </Badge>
                    ) : showCost ? (
                      <HealthBadge health={health} />
                    ) : (
                      <Badge tone="neutral">มีสูตรแล้ว</Badge>
                    )}
                  </span>
                  {can("menu.availability") && (
                    <span className="w-40">
                      <Switch checked={!m.soldOut[branch.id]} onCheckedChange={(v) => void exec((ds) => ds.setSoldOut(m.id, !v), { success: v ? `เปิดขาย ${m.name}` : `ปิดขาย ${m.name} (หมด)` })} label={m.soldOut[branch.id] ? "หมด" : "มีขาย"} />
                    </span>
                  )}
                </motion.li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </>
  );
}

export default function MenuPage() {
  return (
    <Suspense>
      <MenuInner />
    </Suspense>
  );
}
