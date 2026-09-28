"use client";

import { convert, formatQty, unit as unitDef } from "@sabai/domain";
import { ArrowLeft, ArrowRight, Lightbulb } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/app/page-header";
import { Button, LinkButton } from "@/components/ui/button";
import { Stepper, SuccessCheck } from "@/components/ui/feedback";
import { Card, Field, Input, Select } from "@/components/ui/primitives";
import { useAction } from "@/hooks/use-sabai";
import { cn } from "@/lib/cn";
import { addIngredient } from "@/lib/demo/engine";
import { useSabai } from "@/lib/demo/store";

const EMOJI: [RegExp, string][] = [
  [/ไข่/, "🥚"], [/นม/, "🥛"], [/หมู/, "🥩"], [/ไก่/, "🍗"], [/กุ้ง/, "🦐"], [/ปลา/, "🐟"], [/ข้าว/, "🍚"], [/ผัก|คะน้า|กะหล่ำ/, "🥬"],
  [/กาแฟ/, "☕"], [/ชา/, "🍵"], [/น้ำตาล/, "🧂"], [/น้ำแข็ง/, "🧊"], [/แก้ว/, "🥤"], [/กล่อง|ถุง/, "📦"], [/ขนมปัง/, "🍞"], [/เนย/, "🧈"],
  [/ซอส|ซีอิ๊ว/, "🫙"], [/น้ำมัน/, "🛢️"], [/พริก/, "🌶️"], [/กระเทียม/, "🧄"], [/หอม/, "🧅"], [/มะนาว/, "🍋"], [/ช็อก|โกโก้/, "🍫"], [/ครีม/, "🍦"], [/เส้น/, "🍜"],
];
const VOLUME = /นม|น้ำ(?!ตาล|แข็ง)|ซอส|ไซรัป|น้ำมัน|ซีอิ๊ว|ครีม|นมข้น/;
const COUNT = /ไข่|ขนมปัง|แก้ว|กล่อง|ฝา|หลอด|ชิ้น|ลูก|ถุงมือ|ครัวซองต์|เค้ก/;

const KINDS = [
  { base: "g" as const, label: "ชั่งน้ำหนัก", hint: "กรัม / กิโลกรัม", emoji: "⚖️" },
  { base: "ml" as const, label: "ตวงปริมาตร", hint: "มิลลิลิตร / ลิตร", emoji: "🧪" },
  { base: "pcs" as const, label: "นับเป็นชิ้น", hint: "ชิ้น / ฟอง / ใบ", emoji: "🔢" },
];

export default function NewIngredientPage() {
  const db = useSabai((s) => s.db);
  const { exec, pending } = useAction();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [base, setBase] = useState<"g" | "ml" | "pcs">("g");
  const [baseTouched, setBaseTouched] = useState(false);
  const [category, setCategory] = useState("");
  const [packName, setPackName] = useState("");
  const [packSize, setPackSize] = useState("1");
  const [packUnit, setPackUnit] = useState("kg");
  const [price, setPrice] = useState("");
  const [onHand, setOnHand] = useState("");
  const [reorder, setReorder] = useState("1");
  const [nameError, setNameError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const emoji = EMOJI.find(([re]) => re.test(name))?.[1] ?? "📦";
  const categories = useMemo(() => [...new Set(["เนื้อสัตว์", "ผักและผลไม้", "ของแห้งและเครื่องปรุง", "นมและเครื่องดื่ม", "บรรจุภัณฑ์", ...db.ingredients.map((i) => i.category)])], [db.ingredients]);
  const packUnits = base === "g" ? ["kg", "g"] : base === "ml" ? ["l", "ml"] : ["pcs", "dozen"];
  const packBase = Number(packSize) > 0 ? convert(Number(packSize), packUnit, base) : 0;
  const perUnit = packBase > 0 && Number(price) > 0 ? Number(price) / packBase : 0;

  const onName = (v: string) => {
    setName(v);
    setNameError(null);
    if (!baseTouched) {
      const b = COUNT.test(v) ? "pcs" : VOLUME.test(v) ? "ml" : "g";
      setBase(b);
      setPackUnit(b === "g" ? "kg" : b === "ml" ? "l" : "pcs");
    }
  };

  const next = () => {
    if (step === 0) {
      if (!name.trim()) return setNameError("ตั้งชื่อวัตถุดิบก่อน เช่น “อกไก่”");
      if (db.ingredients.some((i) => i.name === name.trim())) return setNameError("มีวัตถุดิบชื่อนี้แล้ว ลองชื่ออื่นหรือเพิ่มรายละเอียด เช่น “อกไก่ (แช่แข็ง)”");
    }
    setStep((s) => s + 1);
  };

  const save = async () => {
    const r = await exec((d, c) =>
      addIngredient(d, c, {
        name,
        emoji,
        baseUnit: base,
        displayUnit: packUnit !== base && packUnit !== "dozen" ? packUnit : undefined,
        category: category || "อื่นๆ",
        pack: packBase > 0 && Number(price) > 0 ? { name: packName || `${packSize} ${unitDef(packUnit).shortTh}`, qty: packBase, price: Math.round(Number(price) * 100) } : undefined,
        openingQty: Number(onHand) > 0 ? Number(onHand) * packBase : undefined,
        reorderPoint: Number(reorder) > 0 && packBase > 0 ? Number(reorder) * packBase : undefined,
        parLevel: Number(reorder) > 0 && packBase > 0 ? Number(reorder) * 3 * packBase : undefined,
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
          <p className="text-ink-3">ใช้ในสูตรเมนูได้ทันที และระบบจะเตือนเมื่อเหลือน้อย</p>
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            <Button
              onClick={() => {
                setSaved(null);
                setStep(0);
                setName("");
                setPrice("");
                setOnHand("");
                setBaseTouched(false);
              }}
            >
              เพิ่มอีกรายการ
            </Button>
            <LinkButton href="/menu/new" variant="secondary">
              ใช้ในเมนูใหม่
            </LinkButton>
            <LinkButton href="/inventory" variant="ghost">
              กลับไปสต็อก
            </LinkButton>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader eyebrow={<Link href="/inventory" className="inline-flex items-center gap-1 hover:text-ink"><ArrowLeft className="h-4 w-4" /> สต็อก</Link>} title="เพิ่มวัตถุดิบ" description="ตอบ 3 คำถามง่ายๆ ระบบคำนวณต้นทุนต่อหน่วยให้เอง" />
      <Stepper steps={["คืออะไร", "ซื้อมาแบบไหน", "เตือนเมื่อใกล้หมด"]} current={step} className="mb-6" />
      <Card className="p-5 sm:p-6">
        <AnimatePresence mode="wait">
          {step === 0 && (
            <motion.div key="0" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-5">
              <Field label="ชื่อวัตถุดิบ" required error={nameError} htmlFor="name">
                <div className="flex gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-surface-2 text-2xl" aria-hidden="true">
                    {emoji}
                  </span>
                  <Input id="name" autoFocus value={name} invalid={!!nameError} onChange={(e) => onName(e.target.value)} placeholder="เช่น อกไก่ นมสด ไข่ไก่" onKeyDown={(e) => e.key === "Enter" && next()} />
                </div>
              </Field>
              <div>
                <p className="mb-2 text-sm font-medium text-ink">วัดปริมาณยังไง</p>
                <div role="radiogroup" aria-label="หน่วยนับ" className="grid grid-cols-3 gap-2">
                  {KINDS.map((k) => (
                    <button
                      key={k.base}
                      role="radio"
                      aria-checked={base === k.base}
                      onClick={() => {
                        setBase(k.base);
                        setBaseTouched(true);
                        setPackUnit(k.base === "g" ? "kg" : k.base === "ml" ? "l" : "pcs");
                      }}
                      className={cn("rounded-2xl border-2 p-3 text-center", base === k.base ? "border-brand bg-brand-soft" : "border-line hover:border-line-strong")}
                    >
                      <span className="block text-2xl" aria-hidden="true">
                        {k.emoji}
                      </span>
                      <span className="block text-sm font-semibold text-ink">{k.label}</span>
                      <span className="block text-xs text-ink-3">{k.hint}</span>
                    </button>
                  ))}
                </div>
                {name && !baseTouched && <p className="mt-2 flex items-center gap-1.5 text-sm text-ink-3"><Lightbulb className="h-4 w-4 text-accent" aria-hidden="true" /> ระบบเดาให้จากชื่อ เปลี่ยนได้</p>}
              </div>
              <Field label="หมวด" optional hint="ช่วยจัดกลุ่มตอนนับสต็อก">
                <div className="flex flex-wrap gap-2">
                  {categories.map((c) => (
                    <button key={c} type="button" onClick={() => setCategory(c)} aria-pressed={category === c} className={cn("h-10 rounded-full border px-3 text-sm", category === c ? "border-brand bg-brand-soft text-brand-soft-ink" : "border-line text-ink-2 hover:border-line-strong")}>
                      {c}
                    </button>
                  ))}
                </div>
              </Field>
            </motion.div>
          )}
          {step === 1 && (
            <motion.div key="1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-5">
              <Field label="ซื้อเป็นแพ็กแบบไหน" hint="เช่น ถุง 1 กก. / แผง 30 ฟอง / ขวด 2 ลิตร" htmlFor="pack">
                <Input id="pack" value={packName} onChange={(e) => setPackName(e.target.value)} placeholder={base === "pcs" ? "แผง 30 ฟอง" : base === "ml" ? "ขวด 2 ลิตร" : "ถุง 1 กก."} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="แพ็กละ" htmlFor="size">
                  <div className="flex gap-2">
                    <Input id="size" inputMode="decimal" value={packSize} onChange={(e) => setPackSize(e.target.value.replace(/[^\d.]/g, ""))} />
                    <Select aria-label="หน่วยของแพ็ก" value={packUnit} onChange={(e) => setPackUnit(e.target.value)} className="w-28">
                      {packUnits.map((u) => (
                        <option key={u} value={u}>
                          {unitDef(u).nameTh}
                        </option>
                      ))}
                    </Select>
                  </div>
                </Field>
                <Field label="ราคาต่อแพ็ก" htmlFor="price">
                  <Input id="price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ""))} prefix="฿" placeholder="0" />
                </Field>
              </div>
              <AnimatePresence>
                {perUnit > 0 && (
                  <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="rounded-2xl bg-brand-soft p-4 text-brand-soft-ink">
                    ต้นทุนตก <strong className="text-lg">฿{perUnit < 1 ? perUnit.toFixed(3) : perUnit.toFixed(2)}</strong> ต่อ{unitDef(base).nameTh} — ระบบใช้ตัวเลขนี้คิดต้นทุนเมนูให้อัตโนมัติ
                  </motion.div>
                )}
              </AnimatePresence>
              <Field label="ตอนนี้มีอยู่กี่แพ็ก" optional hint="ใส่เพื่อเริ่มนับสต็อกจากตัวเลขจริง ข้ามได้ถ้ายังไม่แน่ใจ" htmlFor="onhand">
                <Input id="onhand" inputMode="decimal" value={onHand} onChange={(e) => setOnHand(e.target.value.replace(/[^\d.]/g, ""))} placeholder="0" suffix={Number(onHand) > 0 && packBase > 0 ? `= ${formatQty(Number(onHand) * packBase, base)}` : "แพ็ก"} />
              </Field>
            </motion.div>
          )}
          {step === 2 && (
            <motion.div key="2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-5">
              <Field label="เตือนเมื่อเหลือน้อยกว่า" hint="ค่าแนะนำ: 1 แพ็ก — ระบบจะแนะนำให้สั่งจนมี 3 แพ็กเสมอ" htmlFor="reorder">
                <Input id="reorder" inputMode="decimal" value={reorder} onChange={(e) => setReorder(e.target.value.replace(/[^\d.]/g, ""))} suffix="แพ็ก" />
              </Field>
              <div className="rounded-2xl border border-line p-4">
                <p className="mb-2 text-sm font-medium text-ink-3">ตรวจทาน</p>
                <p className="text-lg font-semibold text-ink">
                  {emoji} {name}
                </p>
                <p className="text-sm text-ink-2">
                  {packName || `${packSize} ${unitDef(packUnit).shortTh}`} · ฿{price || "—"} {perUnit > 0 && `(฿${perUnit < 1 ? perUnit.toFixed(3) : perUnit.toFixed(2)}/${unitDef(base).shortTh})`}
                </p>
                <p className="text-sm text-ink-2">หมวด: {category || "อื่นๆ"}</p>
              </div>
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
              {step === 1 && (
                <Button variant="ghost" onClick={() => setStep(2)}>
                  ข้ามไปก่อน
                </Button>
              )}
              <Button onClick={next} iconRight={<ArrowRight className="h-4 w-4" />}>
                ต่อไป
              </Button>
            </div>
          ) : (
            <Button onClick={save} loading={pending}>
              บันทึกวัตถุดิบ
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
