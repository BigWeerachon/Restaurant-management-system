"use client";

import { humanizeError } from "@sabai/domain";
import { ArrowRight, MailCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/overlay";
import { Callout, Field, Input, Select } from "@/components/ui/primitives";
import { getAuthProvider } from "@/lib/auth";
import { getAccount, startAccountSession } from "@/lib/auth/session";
import { createShop, type NewShop } from "@/lib/data-source/connect";
import { getApiSession } from "@/lib/data-source/http-client";
import { httpDataSource } from "@/lib/data-source/http-data-source";
import { isDomainError } from "@/lib/demo/store";

const BUSINESS_TYPES: [value: string, label: string][] = [
  ["restaurant", "ร้านอาหาร"],
  ["cafe", "คาเฟ่"],
  ["bakery", "เบเกอรี่"],
  ["bar", "บาร์"],
  ["buffet", "บุฟเฟ่ต์"],
  ["food_truck", "ฟู้ดทรัค"],
  ["cloud_kitchen", "ครัวคลาวด์ (ขายเดลิเวอรีอย่างเดียว)"],
  ["other", "อื่นๆ"],
];

type Errors = Partial<Record<"email" | "password" | "name" | "ownerName" | "form", string>>;

/** Which form field a server complaint belongs to. */
const FIELD_OF: Record<string, keyof Errors> = { name: "name", ownerName: "ownerName", email: "email", password: "password" };

/**
 * Opening a shop: an account (unless one is already signed in on this device), then the shop itself, then straight
 * into the first-run checklist as its owner — no PIN to set up first, the account is proof enough.
 */
export function SignupForm() {
  const router = useRouter();
  const auth = getAuthProvider();
  // A confirmed account with no shop yet (came back from the e-mail link, or the shop step failed last time).
  const [account, setAccount] = useState(() => (getApiSession().token ? getAccount() : null));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [businessType, setBusinessType] = useState("restaurant");
  const [branchName, setBranchName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [vat, setVat] = useState(false);
  const [includeVat, setIncludeVat] = useState(true);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [confirmationFor, setConfirmationFor] = useState<string | null>(null);
  // The same details keep the same key: if the answer to "create the shop" is lost and the person presses again, no second shop appears.
  const attempt = useRef<{ signature: string; key: string } | null>(null);

  const keyFor = (shop: NewShop) => {
    const signature = JSON.stringify(shop);
    if (attempt.current?.signature !== signature) attempt.current = { signature, key: crypto.randomUUID() };
    return attempt.current.key;
  };

  const submit = async () => {
    const next: Errors = {};
    if (!account) {
      if (!/^\S+@\S+\.\S+$/.test(email.trim())) next.email = "ใส่อีเมลให้ถูกต้อง เช่น somchai@example.com";
      if (auth.usesPassword && password.length < 8) next.password = "รหัสผ่านอย่างน้อย 8 ตัวอักษร";
    }
    if (!name.trim()) next.name = "ตั้งชื่อร้านก่อนนะ เช่น “ครัวคุณแม่”";
    if (!ownerName.trim()) next.ownerName = "ใส่ชื่อของคุณ ลูกค้าและทีมงานจะเห็นชื่อนี้";
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setBusy(true);
    try {
      if (!account) {
        const result = await auth.signUp({ email: email.trim(), password });
        if ("confirmationSent" in result) {
          setConfirmationFor(email.trim());
          return;
        }
        startAccountSession(result.session);
        setAccount(result.session);
      }
      const shop: NewShop = {
        name: name.trim(),
        businessType,
        branchName: branchName.trim() || undefined,
        ownerName: ownerName.trim(),
        vatRegistered: vat,
        pricesIncludeVat: vat ? includeVat : true,
      };
      await createShop(shop, keyFor(shop));
      await httpDataSource.signInAsAccount();
      router.push("/setup");
    } catch (e) {
      const code = isDomainError(e) ? e.code : "INTERNAL";
      const human = humanizeError(code, isDomainError(e) ? e.params : {});
      const fields = isDomainError(e) && e.params?.fields && typeof e.params.fields === "object" ? (e.params.fields as Record<string, string>) : null;
      if (code === "EMAIL_TAKEN") setErrors({ email: `${human.title} — ${human.message}` });
      else if (code === "WEAK_PASSWORD") setErrors({ password: `${human.title} — ${human.message}` });
      else if (fields) setErrors(Object.fromEntries(Object.entries(fields).map(([k, v]) => [FIELD_OF[k] ?? "form", v])) as Errors);
      else setErrors({ form: `${human.title} — ${human.message}` });
    } finally {
      setBusy(false);
    }
  };

  if (confirmationFor) {
    return (
      <div className="space-y-4 text-center">
        <MailCheck className="mx-auto h-12 w-12 text-brand" aria-hidden="true" />
        <h2 id="signup-title" className="text-xl font-semibold text-ink">
          ตรวจอีเมลของคุณ
        </h2>
        <p className="text-ink-2">
          เราส่งลิงก์ยืนยันไปที่ <strong className="text-ink">{confirmationFor}</strong> กดลิงก์ในอีเมลนั้น แล้วกลับมาเข้าสู่ระบบ ระบบจะพาสร้างร้านต่อทันที
        </p>
        <Link href="/" className="inline-flex h-11 items-center justify-center rounded-full bg-brand px-6 font-medium text-brand-ink hover:bg-brand-hover">
          ยืนยันแล้ว ไปเข้าสู่ระบบ
        </Link>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="space-y-5"
      noValidate
    >
      <div>
        <h2 id="signup-title" className="text-xl font-semibold text-ink">
          เปิดร้านใหม่ใน Sabai
        </h2>
        <p className="text-sm text-ink-3">ทดลองใช้ฟรี 14 วัน ใช้ได้ทุกฟีเจอร์ ไม่ต้องใส่บัตร</p>
      </div>

      {account ? (
        <Callout tone="success" title="เข้าสู่ระบบแล้ว">
          บัญชี {account.email} — เหลือแค่ตั้งค่าร้านของคุณ
        </Callout>
      ) : (
        <fieldset className="space-y-4">
          <legend className="mb-1 text-sm font-semibold text-ink-2">บัญชีของเจ้าของร้าน</legend>
          <Field label="อีเมล" htmlFor="signup-email" required error={errors.email}>
            <Input id="signup-email" type="email" autoComplete="email" value={email} invalid={!!errors.email} placeholder="somchai@example.com" onChange={(e) => setEmail(e.target.value)} />
          </Field>
          {auth.usesPassword && (
            <Field label="รหัสผ่าน" htmlFor="signup-password" required error={errors.password} hint="อย่างน้อย 8 ตัวอักษร ผสมตัวอักษรกับตัวเลข">
              <Input id="signup-password" type="password" autoComplete="new-password" value={password} invalid={!!errors.password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
          )}
        </fieldset>
      )}

      <fieldset className="space-y-4">
        <legend className="mb-1 text-sm font-semibold text-ink-2">ร้านของคุณ</legend>
        <Field label="ชื่อร้าน" htmlFor="signup-shop" required error={errors.name}>
          <Input id="signup-shop" value={name} invalid={!!errors.name} placeholder="เช่น ครัวคุณแม่" onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="ประเภทร้าน" htmlFor="signup-type" hint="ใช้ตั้งค่าเริ่มต้นให้เหมาะ เปลี่ยนภายหลังได้">
          <Select id="signup-type" value={businessType} onChange={(e) => setBusinessType(e.target.value)}>
            {BUSINESS_TYPES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="ชื่อสาขาแรก" htmlFor="signup-branch" optional hint="ไม่ใส่ = “สาขาหลัก”">
          <Input id="signup-branch" value={branchName} placeholder="เช่น สาขาอารีย์" onChange={(e) => setBranchName(e.target.value)} />
        </Field>
        <Field label="ชื่อของคุณ" htmlFor="signup-owner" required error={errors.ownerName}>
          <Input id="signup-owner" autoComplete="name" value={ownerName} invalid={!!errors.ownerName} placeholder="เช่น คุณเอ" onChange={(e) => setOwnerName(e.target.value)} />
        </Field>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="mb-1 text-sm font-semibold text-ink-2">ภาษี</legend>
        <Switch checked={vat} onCheckedChange={setVat} label="ร้านจดทะเบียนภาษีมูลค่าเพิ่ม (VAT)" description="ไม่แน่ใจ ปล่อยปิดไว้ก่อนได้ เปลี่ยนที่ตั้งค่าภายหลัง" />
        {vat && <Switch checked={includeVat} onCheckedChange={setIncludeVat} label="ราคาบนเมนูรวม VAT แล้ว" description="เปิด = ลูกค้าจ่ายตามราคาเมนู VAT อยู่ในราคาแล้ว" />}
      </fieldset>

      {errors.form && (
        <Callout tone="danger" title="สร้างร้านไม่สำเร็จ">
          {errors.form}
        </Callout>
      )}

      <Button type="submit" size="lg" block loading={busy} iconRight={<ArrowRight className="h-4 w-4" />}>
        สร้างร้านและเริ่มเลย
      </Button>
      {!account && (
        <p className="text-center text-sm text-ink-3">
          มีบัญชีอยู่แล้ว?{" "}
          <Link href="/" className="font-medium text-brand underline underline-offset-2">
            เข้าสู่ระบบ
          </Link>
        </p>
      )}
    </form>
  );
}
