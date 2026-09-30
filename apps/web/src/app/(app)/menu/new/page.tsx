"use client";

import { ArrowLeft, ArrowRight } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useState } from "react";
import { LoadBanner } from "@/components/app/load-banner";
import { PageHeader } from "@/components/app/page-header";
import { CostMeter, HealthBadge, RecipeEditor, SuggestedPrice, toRecipe, useCosting, type EditableLine } from "@/components/app/recipe-editor";
import { Button, LinkButton } from "@/components/ui/button";
import { Stepper, SuccessCheck } from "@/components/ui/feedback";
import { Callout, Card, Field, Input, Segmented } from "@/components/ui/primitives";
import { useDsAction, useLoad } from "@/hooks/use-data-source";
import { useAccess } from "@/hooks/use-sabai";
import { cn } from "@/lib/cn";
import { formatBaht } from "@/lib/demo/selectors";
import { useSabai } from "@/lib/demo/store";

const EMOJIS = ["🍛", "🍜", "🍚", "🍤", "🍳", "🥗", "🍲", "🥘", "🍝", "🍔", "🍕", "☕", "🧋", "🍵", "🥤", "🧃", "🍰", "🥐", "🍞", "🍨", "🍧", "🍹", "🥟", "🍢"];

export default function NewMenuPage() {
  const db = useSabai((s) => s.db);
  const { can } = useAccess();
  const { exec, pending } = useDsAction();
  const load = useLoad(["bootstrap"]);
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("🍛");
  const [categoryId, setCategoryId] = useState<string>(db.menuCategories[0]?.id ?? "");
  const [newCategory, setNewCategory] = useState("");
  const [price, setPrice] = useState("");
  const [route, setRoute] = useState<"kitchen" | "bar">("kitchen");
  const [lines, setLines] = useState<EditableLine[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<string | null>(null);
  const costing = useCosting(db, lines, Number(price) || 0);
  const showCost = can("costs.view");

  const validate = () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = "ตั้งชื่อเมนูก่อน เช่น “ข้าวผัดกระเพรา”";
    if (!(Number(price) > 0)) e.price = "ใส่ราคาขายเป็นตัวเลข เช่น 65";
    if (!categoryId && !newCategory.trim()) e.category = "เลือกหมวดหรือพิมพ์ชื่อหมวดใหม่";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const save = async () => {
    const r = await exec((ds) =>
      ds.addMenuItem({
        name,
        emoji,
        categoryId: categoryId || undefined,
        categoryName: newCategory || undefined,
        price: Math.round(Number(price) * 100),
        route,
        recipe: lines.length ? toRecipe(lines) : undefined,
      }),
    );
    if (r.ok) setSaved(r.value.name);
  };

  if (saved) {
    return (
      <div className="mx-auto max-w-xl">
        <Card className="flex flex-col items-center gap-3 p-8 text-center">
          <SuccessCheck />
          <h1 className="text-2xl font-bold text-ink">เพิ่ม “{saved}” แล้ว</h1>
          <p className="text-ink-3">ขึ้นในหน้าขายทุกเครื่องทันที{lines.length ? " และจะตัดสต็อกตามสูตรทุกครั้งที่ขาย" : ""}</p>
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            <Button
              onClick={() => {
                setSaved(null);
                setStep(0);
                setName("");
                setPrice("");
                setLines([]);
              }}
            >
              เพิ่มเมนูอีก
            </Button>
            <LinkButton href="/pos" variant="secondary">
              ลองขายเลย
            </LinkButton>
            <LinkButton href="/menu" variant="ghost">
              ดูเมนูทั้งหมด
            </LinkButton>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader eyebrow={<Link href="/menu" className="inline-flex items-center gap-1 hover:text-ink"><ArrowLeft className="h-4 w-4" /> เมนู</Link>} title="เพิ่มเมนูใหม่" description="ชื่อกับราคาก็ขายได้แล้ว — ใส่สูตรเพิ่มเพื่อให้ระบบตัดสต็อกและคิดกำไรให้" />
      <LoadBanner state={load} className="mb-4" />
      <Stepper steps={["ชื่อและราคา", "สูตร (ไม่บังคับ)", "ตรวจทาน"]} current={step} className="mb-6" />
      <Card className="p-5 sm:p-6">
        <AnimatePresence mode="wait">
          {step === 0 && (
            <motion.div key="0" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-5">
              <Field label="ชื่อเมนู" required error={errors.name} htmlFor="name">
                <Input id="name" autoFocus value={name} invalid={!!errors.name} onChange={(e) => setName(e.target.value)} placeholder="เช่น ข้าวผัดกระเพราหมูกรอบ" />
              </Field>
              <Field label="ไอคอนบนหน้าขาย" hint="พนักงานจำภาพได้เร็วกว่าตัวหนังสือ">
                <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="ไอคอน">
                  {EMOJIS.map((e) => (
                    <button key={e} type="button" role="radio" aria-checked={emoji === e} onClick={() => setEmoji(e)} className={cn("grid h-11 w-11 place-items-center rounded-xl text-2xl", emoji === e ? "bg-brand-soft ring-2 ring-brand" : "bg-surface-2 hover:bg-surface-3")}>
                      {e}
                    </button>
                  ))}
                </div>
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="ราคาขาย" required error={errors.price} htmlFor="price" hint={db.tenant.pricesIncludeVat && db.tenant.vatRegistered ? "ราคารวม VAT แล้ว" : undefined}>
                  <Input id="price" inputMode="decimal" value={price} invalid={!!errors.price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ""))} prefix="฿" placeholder="0" />
                </Field>
                <Field label="ทำที่ไหน" hint="ออเดอร์จะไปขึ้นจอของสถานีนี้">
                  <Segmented label="สถานี" value={route} onChange={setRoute} className="w-full" options={[{ value: "kitchen", label: "🍳 ครัว" }, { value: "bar", label: "🧋 บาร์" }]} />
                </Field>
              </div>
              <Field label="หมวด" required error={errors.category}>
                <div className="flex flex-wrap gap-2">
                  {db.menuCategories.map((c) => (
                    <button key={c.id} type="button" onClick={() => { setCategoryId(c.id); setNewCategory(""); }} aria-pressed={categoryId === c.id} className={cn("h-10 rounded-full border px-3 text-sm", categoryId === c.id ? "border-brand bg-brand-soft text-brand-soft-ink" : "border-line text-ink-2 hover:border-line-strong")}>
                      {c.emoji} {c.name}
                    </button>
                  ))}
                  <Input className="h-10 w-48" value={newCategory} onChange={(e) => { setNewCategory(e.target.value); setCategoryId(""); }} placeholder="+ หมวดใหม่" aria-label="หมวดใหม่" />
                </div>
              </Field>
            </motion.div>
          )}
          {step === 1 && (
            <motion.div key="1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
              <div>
                <p className="mb-3 font-semibold text-ink">ส่วนผสมต่อ 1 จาน/แก้ว</p>
                {db.ingredients.length === 0 ? (
                  <Callout tone="info" title="ยังไม่มีวัตถุดิบ" action={<LinkButton href="/inventory/new" size="sm" variant="secondary">เพิ่มวัตถุดิบ</LinkButton>}>
                    ข้ามขั้นนี้ไปก่อนได้ แล้วค่อยกลับมาใส่สูตรทีหลัง
                  </Callout>
                ) : (
                  <RecipeEditor db={db} lines={lines} onChange={setLines} showCost={showCost} />
                )}
              </div>
              {showCost && (
                <div className="space-y-4 rounded-2xl bg-surface-2 p-4">
                  <div>
                    <p className="text-sm text-ink-3">ต้นทุนต่อจาน</p>
                    <p className="text-3xl font-bold tabular text-ink">{formatBaht(Math.round(costing.breakdown.cost * 100))}</p>
                    <p className="text-sm text-ink-3">ขาย {formatBaht(Math.round(Number(price || 0) * 100))} → กำไรขั้นต้น {formatBaht(Math.round((Number(price || 0) / (db.tenant.vatRegistered && db.tenant.pricesIncludeVat ? 1 + db.tenant.vatRate : 1) - costing.breakdown.cost) * 100))}</p>
                  </div>
                  {lines.length > 0 && Number(price) > 0 && (
                    <>
                      <CostMeter pct={costing.pct} health={costing.health} />
                      <HealthBadge health={costing.health} />
                      <SuggestedPrice price={Number(price)} suggested={costing.suggested} onUse={(p) => setPrice(String(p))} />
                    </>
                  )}
                </div>
              )}
            </motion.div>
          )}
          {step === 2 && (
            <motion.div key="2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="flex flex-col items-center gap-4 py-4 text-center">
              <motion.div initial={{ scale: 0.8, rotate: -6 }} animate={{ scale: 1, rotate: 0 }} className="w-52 overflow-hidden rounded-3xl border border-line bg-surface shadow-md">
                <div className="grid h-32 place-items-center bg-brand-soft text-6xl" aria-hidden="true">
                  {emoji}
                </div>
                <div className="p-4 text-left">
                  <p className="font-semibold text-ink">{name}</p>
                  <p className="text-ink-2">{formatBaht(Math.round(Number(price || 0) * 100), { compact: true })}</p>
                </div>
              </motion.div>
              <p className="text-sm text-ink-3">หน้าตาบนหน้าขาย · {route === "bar" ? "ส่งไปบาร์" : "ส่งไปครัว"} · {lines.length ? `สูตร ${lines.length} ส่วนผสม` : "ยังไม่มีสูตร (เพิ่มทีหลังได้)"}</p>
            </motion.div>
          )}
        </AnimatePresence>
        <div className="mt-6 flex justify-between border-t border-line pt-4">
          {step > 0 ? (
            <Button variant="ghost" onClick={() => setStep((s) => s - 1)} icon={<ArrowLeft className="h-4 w-4" />}>
              ย้อนกลับ
            </Button>
          ) : (
            <span />
          )}
          {step < 2 ? (
            <div className="flex gap-2">
              {step === 1 && lines.length === 0 && (
                <Button variant="ghost" onClick={() => setStep(2)}>
                  ข้าม ใส่สูตรทีหลัง
                </Button>
              )}
              <Button onClick={() => (step === 0 ? validate() && setStep(1) : setStep(2))} iconRight={<ArrowRight className="h-4 w-4" />}>
                ต่อไป
              </Button>
            </div>
          ) : (
            <Button onClick={save} loading={pending}>
              บันทึกเมนู
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
