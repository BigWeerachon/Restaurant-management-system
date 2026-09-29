"use client";

import { humanizeError } from "@sabai/domain";
import { KeyRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Callout, Field, Input } from "@/components/ui/primitives";
import { getAuthProvider } from "@/lib/auth";
import { getAccount } from "@/lib/auth/session";
import { isDomainError } from "@/lib/demo/store";

/** Where the e-mail link from "forgot password" lands: the link has already signed this device in, so all that is left is the new password. */
export function ResetPasswordForm() {
  const router = useRouter();
  const auth = getAuthProvider();
  const account = getAccount();
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!account || !auth.updatePassword) {
    return (
      <div className="space-y-4">
        <h2 id="reset-title" className="text-xl font-semibold text-ink">
          ลิงก์นี้ใช้ไม่ได้แล้ว
        </h2>
        <p className="text-ink-2">ลิงก์ตั้งรหัสผ่านใหม่ใช้ได้ครั้งเดียวและมีอายุจำกัด ขอลิงก์ใหม่ได้ที่หน้าเข้าสู่ระบบ กด “ลืมรหัสผ่าน”</p>
        <Link href="/" className="inline-flex h-11 items-center justify-center rounded-full bg-brand px-6 font-medium text-brand-ink hover:bg-brand-hover">
          ไปหน้าเข้าสู่ระบบ
        </Link>
      </div>
    );
  }

  const submit = async () => {
    if (password.length < 8) return setError("รหัสผ่านอย่างน้อย 8 ตัวอักษร");
    if (password !== again) return setError("รหัสผ่านสองช่องไม่ตรงกัน");
    setBusy(true);
    setError(null);
    try {
      await auth.updatePassword!(account, password);
      router.replace("/");
    } catch (e) {
      setError(humanizeError(isDomainError(e) ? e.code : "INTERNAL").message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="space-y-4"
      noValidate
    >
      <div>
        <h2 id="reset-title" className="text-xl font-semibold text-ink">
          ตั้งรหัสผ่านใหม่
        </h2>
        <p className="text-sm text-ink-3">บัญชี {account.email}</p>
      </div>
      <Field label="รหัสผ่านใหม่" htmlFor="reset-password" required hint="อย่างน้อย 8 ตัวอักษร ผสมตัวอักษรกับตัวเลข">
        <Input id="reset-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Field label="พิมพ์รหัสผ่านใหม่อีกครั้ง" htmlFor="reset-again" required error={error}>
        <Input id="reset-again" type="password" autoComplete="new-password" value={again} invalid={!!error} onChange={(e) => setAgain(e.target.value)} />
      </Field>
      <Callout tone="info" className="text-sm">
        รหัสผ่านใหม่ใช้กับการเข้าสู่ระบบด้วยอีเมลเท่านั้น PIN ของพนักงานไม่เปลี่ยน
      </Callout>
      <Button type="submit" size="lg" block loading={busy} icon={<KeyRound className="h-4 w-4" />}>
        บันทึกรหัสผ่านใหม่
      </Button>
    </form>
  );
}
