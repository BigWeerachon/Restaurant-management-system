"use client";

import { cheapestPlanFor, FEATURE_COPY, PLANS, planLimit, planOf, type PlanCode } from "@sabai/domain";
import { Check, Crown, MapPin, Plus, ShieldCheck, Sparkles } from "lucide-react";
import { motion } from "motion/react";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { PageHeader } from "@/components/app/page-header";
import { PromptPayQr } from "@/components/app/promptpay-qr";
import { Button } from "@/components/ui/button";
import { Dialog, Switch, TabPanel, Tabs } from "@/components/ui/overlay";
import { Badge, Callout, Card, Field, Input, Segmented, Select } from "@/components/ui/primitives";
import { useAccess, useAction } from "@/hooks/use-sabai";
import { cn } from "@/lib/cn";
import { addBranch, changePlan, updateBranch, updateChannel, updatePaymentMethod, updateTenant } from "@/lib/demo/engine";
import { useSabai } from "@/lib/demo/store";
import type { Branch, Tenant } from "@/lib/demo/types";

const BUSINESS_TYPES: { value: Tenant["businessType"]; label: string }[] = [
  { value: "cafe", label: "คาเฟ่" },
  { value: "restaurant", label: "ร้านอาหาร" },
  { value: "bakery", label: "เบเกอรี่" },
  { value: "bar", label: "บาร์" },
  { value: "cloud_kitchen", label: "ครัวออนไลน์ (เดลิเวอรีอย่างเดียว)" },
  { value: "food_truck", label: "ฟู้ดทรัค" },
  { value: "buffet", label: "บุฟเฟต์" },
  { value: "other", label: "อื่นๆ" },
];

const pctText = (v: number) => String(Math.round(v * 1000) / 10);
const toRate = (s: string) => Math.min(Math.max(Number(s || 0), 0), 100) / 100;

// ---------------------------------------------------------------------------
function Business() {
  const db = useSabai((s) => s.db);
  const { exec } = useAction();
  const t = db.tenant;
  const [name, setName] = useState(t.name);
  const set = (patch: Parameters<typeof updateTenant>[2], msg = "บันทึกแล้ว") => exec((d, c) => updateTenant(d, c, patch), { success: msg });
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="space-y-4 p-5">
        <Field label="ชื่อร้าน" hint="แสดงบนใบเสร็จและหน้าจอ" htmlFor="shop">
          <Input id="shop" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== t.name && set({ name })} />
        </Field>
        <Field label="ประเภทร้าน" htmlFor="btype">
          <Select id="btype" value={t.businessType} onChange={(e) => set({ businessType: e.target.value as Tenant["businessType"] })}>
            {BUSINESS_TYPES.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </Select>
        </Field>
      </Card>
      <Card className="space-y-4 p-5">
        <Switch checked={t.vatRegistered} onCheckedChange={(v) => set({ vatRegistered: v }, v ? "เปิดคิด VAT แล้ว" : "ปิดการคิด VAT แล้ว")} label="จดทะเบียนภาษีมูลค่าเพิ่ม (VAT 7%)" description="ถ้ารายได้เกิน 1.8 ล้านบาท/ปี ต้องจด VAT — ใบเสร็จจะแสดงภาษีให้อัตโนมัติ" />
        {t.vatRegistered && (
          <Segmented
            label="ราคาในเมนู"
            className="w-full"
            value={t.pricesIncludeVat ? "incl" : "excl"}
            onChange={(v) => set({ pricesIncludeVat: v === "incl" })}
            options={[
              { value: "incl", label: "รวม VAT แล้ว (แนะนำ)" },
              { value: "excl", label: "ยังไม่รวม VAT" },
            ]}
          />
        )}
        <Field label="ปัดเศษเงินสด" hint="ใช้กับการรับเงินสดเท่านั้น โอน/บัตรคิดตามยอดจริง" htmlFor="round">
          <Segmented
            label="ปัดเศษเงินสด"
            className="w-full"
            value={t.cashRounding}
            onChange={(v) => set({ cashRounding: v })}
            options={[
              { value: "none", label: "ไม่ปัด" },
              { value: "0.25", label: "25 สตางค์" },
              { value: "1.00", label: "1 บาท" },
            ]}
          />
        </Field>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
function BranchDialog({ branch, open, onClose }: { branch: Branch | null; open: boolean; onClose: () => void }) {
  const { exec, pending } = useAction();
  const [form, setForm] = useState({ name: "", address: "", phone: "", openingHours: "", dayCutoff: "05:00", service: "0" });
  const [loaded, setLoaded] = useState<string | null>(null);
  const key = branch?.id ?? (open ? "new" : null);
  if (key !== loaded) {
    setLoaded(key);
    setForm({ name: branch?.name ?? "", address: branch?.address ?? "", phone: branch?.phone ?? "", openingHours: branch?.openingHours ?? "", dayCutoff: branch?.dayCutoff ?? "05:00", service: pctText(branch?.serviceChargeRate ?? 0) });
  }
  const up = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  const save = async () => {
    const r = branch
      ? await exec((d, c) => updateBranch(d, c, branch.id, { name: form.name, address: form.address, phone: form.phone, openingHours: form.openingHours, dayCutoff: form.dayCutoff, serviceChargeRate: toRate(form.service) }), { success: "บันทึกข้อมูลสาขาแล้ว" })
      : await exec((d, c) => addBranch(d, c, { name: form.name, address: form.address, phone: form.phone }), { success: `เปิด${form.name}แล้ว`, successDetail: "ตั้งค่าจอครัวและค่าเริ่มต้นให้แล้ว" });
    if (r.ok) onClose();
  };
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()} title={branch ? branch.name : "เพิ่มสาขา"} size="md" footer={<Button loading={pending} disabled={!form.name.trim()} onClick={save}>{branch ? "บันทึก" : "เพิ่มสาขา"}</Button>}>
      <div className="grid gap-4 pb-2 sm:grid-cols-2">
        <Field label="ชื่อสาขา" required htmlFor="bn" className="sm:col-span-2">
          <Input id="bn" value={form.name} onChange={up("name")} placeholder="เช่น สาขาอารีย์" />
        </Field>
        <Field label="ที่อยู่ (แสดงบนใบเสร็จ)" htmlFor="ba" className="sm:col-span-2">
          <Input id="ba" value={form.address} onChange={up("address")} />
        </Field>
        <Field label="เบอร์โทร" htmlFor="bp">
          <Input id="bp" inputMode="tel" value={form.phone} onChange={up("phone")} />
        </Field>
        {branch && (
          <>
            <Field label="เวลาเปิด-ปิด" htmlFor="bh">
              <Input id="bh" value={form.openingHours} onChange={up("openingHours")} placeholder="07:00–21:00" />
            </Field>
            <Field label="ตัดยอดขายรายวันเวลา" hint="ร้านที่เปิดเลยเที่ยงคืน ยอดหลังเที่ยงคืนยังนับเป็นของวันเดิมจนถึงเวลานี้" htmlFor="bc">
              <Input id="bc" type="time" value={form.dayCutoff} onChange={up("dayCutoff")} />
            </Field>
            <Field label="ค่าบริการ (Service charge)" hint="คิดเฉพาะการทานที่ร้าน" htmlFor="bs">
              <Input id="bs" inputMode="decimal" suffix="%" value={form.service} onChange={up("service")} />
            </Field>
          </>
        )}
      </div>
    </Dialog>
  );
}

function Branches({ onUpgrade }: { onUpgrade: () => void }) {
  const db = useSabai((s) => s.db);
  const [editing, setEditing] = useState<Branch | null>(null);
  const [adding, setAdding] = useState(false);
  const limit = planLimit(db.tenant.plan, "branches");
  const atLimit = limit !== null && db.branches.length >= limit;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        {db.branches.map((b) => (
          <Card key={b.id} interactive as="article" className="p-5">
            <button className="w-full text-left" onClick={() => setEditing(b)}>
              <p className="flex items-center gap-2 font-semibold text-ink">
                <MapPin className="h-4 w-4 text-brand" aria-hidden="true" /> {b.name}
              </p>
              <p className="mt-1 text-sm text-ink-3">{b.address || "ยังไม่ได้ใส่ที่อยู่"}</p>
              <p className="mt-3 flex flex-wrap gap-2 text-xs">
                <Badge>{b.openingHours || "ยังไม่ระบุเวลา"}</Badge>
                <Badge>ตัดยอด {b.dayCutoff}</Badge>
                {b.serviceChargeRate > 0 && <Badge>Service {pctText(b.serviceChargeRate)}%</Badge>}
                <Badge>{b.tables.length} โต๊ะ</Badge>
              </p>
            </button>
          </Card>
        ))}
      </div>
      {atLimit ? (
        <Callout tone="info" title={`แพ็กเกจ${planOf(db.tenant.plan).name}มีได้ ${limit} สาขา`} action={<Button size="sm" variant="secondary" onClick={onUpgrade}>ดูแพ็กเกจ</Button>}>
          อัปเกรดเป็น{cheapestPlanFor({ branches: db.branches.length + 1 }).name} เพื่อเพิ่มสาขา — ข้อมูลเดิมและการขายไม่สะดุด
        </Callout>
      ) : (
        <Button variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>
          เพิ่มสาขา
        </Button>
      )}
      <BranchDialog branch={editing} open={!!editing || adding} onClose={() => (setEditing(null), setAdding(false))} />
    </div>
  );
}

// ---------------------------------------------------------------------------
function Channels() {
  const db = useSabai((s) => s.db);
  const { exec } = useAction();
  const [draft, setDraft] = useState<Record<string, { gp: string; markup: string }>>({});
  return (
    <div className="space-y-4">
      <Callout tone="info" title="ค่า GP มีผลตั้งแต่วันที่เปลี่ยน">
        บิลเก่ายังคิดตามอัตรา ณ วันที่ขาย รายงานกำไรจึงถูกต้องย้อนหลัง (แพลตฟอร์มมักปรับ GP เป็นช่วงๆ)
      </Callout>
      <ul className="grid gap-3 lg:grid-cols-2">
        {db.channels.map((c) => {
          const d = draft[c.id] ?? { gp: pctText(c.commissionRate), markup: pctText(c.priceMarkup) };
          const gp = toRate(d.gp);
          const markup = toRate(d.markup);
          const keep = Math.round((1 + markup) * (1 - gp) * 100);
          const dirty = gp !== c.commissionRate || markup !== c.priceMarkup;
          const platform = c.kind === "delivery_platform";
          return (
            <li key={c.id}>
              <Card className={cn("p-5", !c.active && "opacity-70")}>
                <div className="flex items-center gap-3">
                  <span className="h-3 w-3 rounded-full" style={{ background: c.color }} aria-hidden="true" />
                  <div className="flex-1">
                    <Switch checked={c.active} onCheckedChange={(v) => exec((dd, cc) => updateChannel(dd, cc, c.id, { active: v }), { success: v ? `เปิดขายผ่าน ${c.name}` : `ปิด ${c.name} แล้ว` })} label={c.name} description={platform ? `โอนเงินเข้าบัญชีทุก ${c.settlementDays} วัน` : c.kind === "dine_in" ? "คิดค่าบริการตามที่ตั้งไว้ในแต่ละสาขา" : "ไม่คิดค่าบริการ · ใส่ค่าบรรจุภัณฑ์เป็นตัวเลือกเสริมได้"} />
                  </div>
                </div>
                {platform && c.active && (
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <Field label="ค่า GP" htmlFor={`gp-${c.id}`}>
                      <Input id={`gp-${c.id}`} inputMode="decimal" suffix="%" value={d.gp} onChange={(e) => setDraft({ ...draft, [c.id]: { ...d, gp: e.target.value.replace(/[^\d.]/g, "") } })} />
                    </Field>
                    <Field label="บวกราคาเมนู" htmlFor={`mk-${c.id}`}>
                      <Input id={`mk-${c.id}`} inputMode="decimal" suffix="%" value={d.markup} onChange={(e) => setDraft({ ...draft, [c.id]: { ...d, markup: e.target.value.replace(/[^\d.]/g, "") } })} />
                    </Field>
                    <p className="col-span-2 rounded-xl bg-surface-2 p-3 text-sm text-ink-2">
                      เมนูราคาหน้าร้าน ฿100 → ขายบนแอป ฿{Math.round(100 * (1 + markup))} → ร้านได้รับ <strong className={cn("tabular", keep < 80 ? "text-warning" : "text-ink")}>฿{keep}</strong> ก่อนหักต้นทุน
                    </p>
                    {dirty && (
                      <div className="col-span-2 flex justify-end">
                        <Button size="sm" onClick={() => exec((dd, cc) => updateChannel(dd, cc, c.id, { commissionRate: gp, priceMarkup: markup }), { success: `บันทึก ${c.name} แล้ว`, successDetail: "มีผลกับบิลตั้งแต่ตอนนี้" })}>
                          บันทึก
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
function Payments() {
  const db = useSabai((s) => s.db);
  const { exec } = useAction();
  const pp = db.paymentMethods.find((m) => m.kind === "promptpay");
  const [ppId, setPpId] = useState(pp?.promptpayId ?? "");
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <Card className="divide-y divide-line">
        {db.paymentMethods.map((m) => (
          <div key={m.id} className="p-4">
            <Switch
              checked={m.active}
              disabled={m.kind === "cash"}
              onCheckedChange={(v) => exec((d, c) => updatePaymentMethod(d, c, m.id, { active: v }), { success: v ? `เปิดรับ${m.name}` : `ปิด${m.name}แล้ว` })}
              label={m.name}
              description={m.kind === "cash" ? "เปิดไว้เสมอ ใช้ทอนเงินและกรณีระบบอื่นขัดข้อง" : m.feeRate > 0 ? `ค่าธรรมเนียม ${pctText(m.feeRate)}% · เงินเข้าใน ${m.settlementDays} วัน` : m.kind === "platform" ? "แพลตฟอร์มเก็บเงินแทนร้าน" : "ไม่มีค่าธรรมเนียม · เงินเข้าทันที"}
            />
            {m.kind === "promptpay" && (
              <Field label="หมายเลขพร้อมเพย์ของร้าน" hint="เบอร์มือถือ หรือเลขผู้เสียภาษี 13 หลัก" htmlFor="pp" className="mt-3">
                <div className="flex gap-2">
                  <Input id="pp" className="flex-1" inputMode="numeric" value={ppId} onChange={(e) => setPpId(e.target.value)} placeholder="08x-xxx-xxxx" />
                  <Button variant="secondary" disabled={!ppId || ppId === m.promptpayId} onClick={() => exec((d, c) => updatePaymentMethod(d, c, m.id, { promptpayId: ppId, active: true }), { success: "บันทึกพร้อมเพย์แล้ว", successDetail: "หน้าขายจะสร้าง QR ตามยอดบิลให้อัตโนมัติ" })}>
                    บันทึก
                  </Button>
                </div>
              </Field>
            )}
          </div>
        ))}
      </Card>
      <Card className="p-5 text-center">
        <p className="mb-3 text-sm font-medium text-ink-2">ตัวอย่าง QR ที่ลูกค้าจะเห็น</p>
        {ppId ? <PromptPayQr id={ppId} amount={145} /> : <p className="text-sm text-ink-3">ใส่หมายเลขพร้อมเพย์เพื่อดูตัวอย่าง</p>}
        <p className="mt-3 text-xs text-ink-3">ยอดล็อกตามบิล ลูกค้าพิมพ์ยอดผิดไม่ได้ · ระบบกระทบยอดกับรายการเดินบัญชีให้</p>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
function Plan() {
  const db = useSabai((s) => s.db);
  const { can } = useAccess();
  const { exec, pending } = useAction();
  const [yearly, setYearly] = useState(false);
  const [confirm, setConfirm] = useState<PlanCode | null>(null);
  const current = planOf(db.tenant.plan);
  const trialDays = Math.max(0, Math.ceil((Date.parse(db.tenant.trialEndsAt) - Date.now()) / 86_400_000));
  return (
    <div className="space-y-4">
      <Card className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center">
        <Crown className="h-8 w-8 text-accent" aria-hidden="true" />
        <div className="flex-1">
          <p className="font-semibold text-ink">
            แพ็กเกจปัจจุบัน: {current.name}
            {trialDays > 0 && <span className="font-normal text-ink-3"> · ทดลองใช้ฟรีเหลือ {trialDays} วัน</span>}
          </p>
          <p className="flex items-center gap-1.5 text-sm text-ink-3">
            <ShieldCheck className="h-4 w-4 text-success" aria-hidden="true" /> ไม่ว่าเกิดอะไรขึ้นกับการชำระค่าบริการ ระบบจะไม่หยุดการขายหน้าร้านของคุณ
          </p>
        </div>
        <Segmented label="รอบบิล" value={yearly ? "y" : "m"} onChange={(v) => setYearly(v === "y")} options={[{ value: "m", label: "รายเดือน" }, { value: "y", label: "รายปี (ฟรี 2 เดือน)" }]} />
      </Card>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {PLANS.filter((p) => p.code !== "enterprise").map((p, i) => {
          const isCurrent = p.code === current.code;
          const price = yearly ? p.priceYearly : p.priceMonthly;
          return (
            <motion.div key={p.code} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
              <Card className={cn("flex h-full flex-col p-5", isCurrent && "ring-2 ring-brand", p.code === "pro" && !isCurrent && "ring-1 ring-accent")}>
                <div className="flex items-center justify-between">
                  <p className="text-lg font-semibold text-ink">{p.name}</p>
                  {isCurrent ? <Badge tone="brand">ใช้อยู่</Badge> : p.code === "pro" ? <Badge tone="warning" icon={<Sparkles className="h-3 w-3" aria-hidden="true" />}>ยอดนิยม</Badge> : null}
                </div>
                <p className="mt-1 text-sm text-ink-3">{p.pitch}</p>
                <p className="mt-4 text-3xl font-bold tabular text-ink">
                  ฿{(price ?? 0).toLocaleString("th-TH")}
                  <span className="text-sm font-normal text-ink-3">/{yearly ? "ปี" : "เดือน"}</span>
                </p>
                <p className="text-xs text-ink-3">
                  {p.limits.branches} สาขา · {p.limits.staff} พนักงาน · {p.limits.devices} เครื่อง
                </p>
                <ul className="mt-4 flex-1 space-y-1.5 text-sm text-ink-2">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
                      {FEATURE_COPY[f]}
                    </li>
                  ))}
                </ul>
                {can("billing.manage") && !isCurrent && (
                  <Button className="mt-4" variant={p.code === "pro" ? "primary" : "secondary"} onClick={() => setConfirm(p.code)}>
                    เปลี่ยนเป็น{p.name}
                  </Button>
                )}
              </Card>
            </motion.div>
          );
        })}
      </div>
      <p className="text-center text-sm text-ink-3">ร้านมากกว่า 10 สาขา หรือต้องการ SSO/API เฉพาะ — ติดต่อทีมงานเพื่อแพ็กเกจเอนเตอร์ไพรส์</p>
      <Dialog open={!!confirm} onOpenChange={(v) => !v && setConfirm(null)} title={`เปลี่ยนเป็นแพ็กเกจ${confirm ? planOf(confirm).name : ""}?`} description="เปลี่ยนได้ทุกเมื่อ คิดเงินตามสัดส่วนวันที่ใช้จริง" size="sm" footer={
        <Button loading={pending} onClick={async () => {
          if (!confirm) return;
          const r = await exec((d, c) => changePlan(d, c, confirm), { success: `เปลี่ยนเป็น${planOf(confirm).name}แล้ว` });
          if (r.ok) setConfirm(null);
        }}>
          ยืนยัน
        </Button>
      }>
        <p className="pb-2 text-sm text-ink-2">ข้อมูลทั้งหมดอยู่ครบ ฟีเจอร์ที่ไม่มีในแพ็กเกจใหม่จะถูกซ่อน (ไม่ลบ) และกลับมาเมื่ออัปเกรดอีกครั้ง</p>
      </Dialog>
    </div>
  );
}

function SettingsInner() {
  const params = useSearchParams();
  const { can } = useAccess();
  const [tab, setTab] = useState(params.get("tab") ?? (can("settings.manage") ? "business" : "plan"));
  const tabs = [
    ...(can("settings.manage")
      ? [
          { value: "business", label: "ข้อมูลร้าน" },
          { value: "branches", label: "สาขา" },
          { value: "channels", label: "ช่องทางขายและ GP" },
          { value: "payments", label: "การรับเงิน" },
        ]
      : []),
    ...(can("billing.manage") ? [{ value: "plan", label: "แพ็กเกจ" }] : []),
  ];
  return (
    <>
      <PageHeader title="ตั้งค่า" description="ตั้งครั้งเดียว ใช้ได้ทุกสาขา — ทุกช่องมีค่าที่แนะนำไว้ให้แล้ว" />
      <Tabs value={tab} onValueChange={setTab} tabs={tabs}>
        <TabPanel value="business" className="pt-4">
          <Business />
        </TabPanel>
        <TabPanel value="branches" className="pt-4">
          <Branches onUpgrade={() => setTab("plan")} />
        </TabPanel>
        <TabPanel value="channels" className="pt-4">
          <Channels />
        </TabPanel>
        <TabPanel value="payments" className="pt-4">
          <Payments />
        </TabPanel>
        <TabPanel value="plan" className="pt-4">
          <Plan />
        </TabPanel>
      </Tabs>
    </>
  );
}

export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsInner />
    </Suspense>
  );
}
