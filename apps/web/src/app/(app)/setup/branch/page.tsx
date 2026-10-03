"use client";

import { ArrowLeft, Check, Moon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { LoadBanner } from "@/components/app/load-banner";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Callout, Card, Field, Input } from "@/components/ui/primitives";
import { useDsAction, useLoad } from "@/hooks/use-data-source";
import { cn } from "@/lib/cn";
import { useSabai } from "@/lib/demo/store";

const HOURS = [
  { label: "เช้า–เย็น", value: "07:00–17:00", close: "17:00" },
  { label: "สาย–ค่ำ", value: "10:00–22:00", close: "22:00" },
  { label: "เย็น–ดึก", value: "17:00–02:00", close: "02:00" },
];

/** First branch in one screen: what goes on the receipt + when the day ends. */
export default function SetupBranchPage() {
  const db = useSabai((s) => s.db);
  const branch = db.branches[0]!;
  const router = useRouter();
  const { exec, pending } = useDsAction();
  const load = useLoad(["settings"]);
  const [name, setName] = useState(branch.name);
  const [address, setAddress] = useState(branch.address ?? "");
  const [phone, setPhone] = useState(branch.phone ?? "");
  const [hours, setHours] = useState(branch.openingHours ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const close = hours.split(/[–-]/)[1]?.trim() ?? "";
  // Open past midnight → sales until 05:00 still belong to the previous day.
  const lateNight = /^0[0-4]:/.test(close);

  const save = async () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = "ตั้งชื่อสาขา เช่น สาขาหลัก";
    if (!address.trim() && !phone.trim()) e.address = "ใส่ที่อยู่หรือเบอร์โทรอย่างน้อย 1 อย่าง เพื่อแสดงบนใบเสร็จ";
    setErrors(e);
    if (Object.keys(e).length) return;
    const r = await exec((ds) => ds.updateBranch(branch.id, { name, address, phone, openingHours: hours, dayCutoff: "05:00" }), { success: "ตั้งค่าสาขาเรียบร้อย", successDetail: "ขั้นต่อไป: เลือกวิธีรับเงิน" });
    if (r.ok) router.push("/setup");
  };

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader eyebrow={<Link href="/setup" className="inline-flex items-center gap-1 hover:text-ink"><ArrowLeft className="h-4 w-4" /> เริ่มต้นใช้งาน</Link>} title="ตั้งค่าสาขาแรก" description="ข้อมูลนี้จะอยู่บนใบเสร็จ ใช้เวลาไม่ถึงนาที" />
      <LoadBanner state={load} className="mb-4" />
      <Card className="space-y-5 p-5 sm:p-6">
        <Field label="ชื่อสาขา" required error={errors.name} htmlFor="n">
          <Input id="n" value={name} invalid={!!errors.name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="ที่อยู่" error={errors.address} hint="เช่น 12/3 ซอยอารีย์ 1 พญาไท กรุงเทพฯ" htmlFor="a">
          <Input id="a" value={address} invalid={!!errors.address} onChange={(e) => setAddress(e.target.value)} autoComplete="street-address" />
        </Field>
        <Field label="เบอร์โทรร้าน" htmlFor="p">
          <Input id="p" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
        </Field>
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-ink">เวลาเปิด-ปิด</legend>
          <div className="flex flex-wrap gap-2">
            {HOURS.map((h) => (
              <button key={h.value} type="button" aria-pressed={hours === h.value} onClick={() => setHours(h.value)} className={cn("h-11 rounded-2xl border px-4 text-sm", hours === h.value ? "border-brand bg-brand-soft text-brand-soft-ink" : "border-line text-ink-2 hover:border-line-strong")}>
                {h.label} <span className="tabular text-ink-3">{h.value}</span>
              </button>
            ))}
          </div>
          <Input className="mt-2" aria-label="เวลาเปิด-ปิดแบบกำหนดเอง" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="หรือพิมพ์เอง เช่น 08:00–20:00" />
        </fieldset>
        {lateNight && (
          <Callout tone="info" title="ร้านเปิดเลยเที่ยงคืน">
            <span className="inline-flex items-center gap-1">
              <Moon className="h-4 w-4" aria-hidden="true" /> ยอดขายหลังเที่ยงคืนจนถึงตี 5 จะนับเป็นของวันที่เปิดร้าน — ปิดยอดครั้งเดียวต่อคืน
            </span>
          </Callout>
        )}
        <Button block size="lg" loading={pending} icon={<Check className="h-5 w-5" />} onClick={save}>
          บันทึกและไปขั้นต่อไป
        </Button>
      </Card>
    </div>
  );
}
