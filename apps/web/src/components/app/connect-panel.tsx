"use client";

import { accessFromRole, homeFor, humanizeError, type Home, type Permission } from "@sabai/domain";
import { ArrowRight, Store } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Keypad, PinDots } from "@/components/ui/feedback";
import { Dialog } from "@/components/ui/overlay";
import { Field, Input } from "@/components/ui/primitives";
import { getAuthProvider } from "@/lib/auth";
import { signInAccount, signOutAccount } from "@/lib/auth/session";
import { listShops, openShop, type ShopChoice } from "@/lib/data-source/connect";
import { getApiSession } from "@/lib/data-source/http-client";
import { httpDataSource } from "@/lib/data-source/http-data-source";
import { isDomainError, useSabai } from "@/lib/demo/store";
import type { Member } from "@/lib/demo/types";
import { RoleCards } from "./role-cards";

type Phase = "email" | "shops" | "team";

const errorText = (e: unknown) => humanizeError(isDomainError(e) ? e.code : "INTERNAL").message;

/** API mode's replacement for the sample-shop picker: sign in, choose a shop, then tap your role and enter your PIN. */
export function ConnectPanel() {
  const db = useSabai((s) => s.db);
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>(() => {
    const s = getApiSession();
    return s.token && s.tenantId ? "team" : "email";
  });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const auth = getAuthProvider();
  const [shops, setShops] = useState<ShopChoice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<Member | null>(null);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const connect = () =>
    guard(async () => {
      if (!email.trim()) {
        setError("ใส่อีเมลก่อนนะ");
        return;
      }
      if (auth.usesPassword && !password) {
        setError("ใส่รหัสผ่านก่อนนะ");
        return;
      }
      await signInAccount(email.trim(), password);
      const found = await listShops();
      if (found.length === 0) {
        await signOutAccount();
        setError("บัญชีนี้ยังไม่มีร้าน");
      } else if (found.length === 1) {
        await openShop(found[0]!.tenantId);
        setPhase("team");
      } else {
        setShops(found);
        setPhase("shops");
      }
    });

  const chooseShop = (tenantId: string) =>
    guard(async () => {
      await openShop(tenantId);
      setPhase("team");
    });

  const disconnect = () => {
    void signOutAccount();
    setPhase("email");
    setPassword("");
    setError(null);
  };

  const branchFor = (m: Member) => (m.branchIds === "all" ? db.branches[0]?.id : m.branchIds[0]) ?? "";

  const submitPin = async (value: string) => {
    if (!picked) return;
    try {
      const m = await httpDataSource.pinSwitch(branchFor(picked), value);
      const role = useSabai.getState().db.roles.find((r) => r.key === m.roleKey)!;
      setPicked(null);
      router.push(homeFor(accessFromRole({ grantsAll: role.grantsAll, permissions: role.permissions as Permission[] }), role.home as Home));
    } catch (e) {
      setPinError(errorText(e));
      setPin("");
    }
  };

  const onKey = (k: string) => {
    if (pin.length >= 4) return;
    const next = pin + k;
    setPinError(null);
    setPin(next);
    if (next.length === 4) setTimeout(() => submitPin(next), 120);
  };

  const pick = (memberId: string) => {
    setPicked(db.members.find((m) => m.id === memberId) ?? null);
    setPin("");
    setPinError(null);
  };

  if (phase === "email") {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void connect();
        }}
        className="space-y-4"
      >
        <div>
          <h2 id="enter-title" className="text-xl font-semibold text-ink">
            เชื่อมต่อร้านจริง
          </h2>
          <p className="text-sm text-ink-3">{auth.usesPassword ? "เข้าสู่ระบบด้วยบัญชีของเจ้าของร้านหรือผู้จัดการ" : "โหมดพัฒนา: เข้าด้วยอีเมลของบัญชีที่มีร้านอยู่ในระบบ"}</p>
        </div>
        <Field label="อีเมล" htmlFor="connect-email" error={auth.usesPassword ? undefined : error}>
          <Input id="connect-email" type="email" autoComplete="email" value={email} invalid={!!error} placeholder="owner@sabai.dev" onChange={(e) => setEmail(e.target.value)} />
        </Field>
        {auth.usesPassword && (
          <Field label="รหัสผ่าน" htmlFor="connect-password" error={error}>
            <Input id="connect-password" type="password" autoComplete="current-password" value={password} invalid={!!error} onChange={(e) => setPassword(e.target.value)} />
          </Field>
        )}
        <Button type="submit" size="lg" block disabled={busy} iconRight={<ArrowRight className="h-4 w-4" />}>
          {busy ? "กำลังเชื่อมต่อ…" : auth.usesPassword ? "เข้าสู่ระบบ" : "เชื่อมต่อ"}
        </Button>
        <p className="text-xs text-ink-3">ตอนนี้โหมดนี้ทำได้เฉพาะเข้าสู่ระบบและโหลดข้อมูลร้าน หน้าอื่นๆ จะย้ายมาใช้ข้อมูลจริงทีละหน้า</p>
      </form>
    );
  }

  if (phase === "shops") {
    return (
      <div className="space-y-4">
        <div>
          <h2 id="enter-title" className="text-xl font-semibold text-ink">
            เลือกร้าน
          </h2>
          <p className="text-sm text-ink-3">บัญชีนี้อยู่ในหลายร้าน</p>
        </div>
        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}
        <ul className="grid gap-3">
          {shops.map((s) => (
            <li key={s.tenantId}>
              <button disabled={busy} onClick={() => void chooseShop(s.tenantId)} className="glass flex min-h-11 w-full items-center gap-3 rounded-2xl p-4 text-left font-semibold text-ink hover:border-brand/60 hover:bg-brand-soft/25">
                <Store className="h-5 w-5 text-brand" aria-hidden="true" />
                {s.tenantName}
              </button>
            </li>
          ))}
        </ul>
        <Button variant="ghost" onClick={disconnect}>
          ใช้บัญชีอื่น
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 id="enter-title" className="text-xl font-semibold text-ink">
            {db.tenant.name || "ร้านของคุณ"}
          </h2>
          <p className="text-sm text-ink-3">{db.branches.length} สาขา · เชื่อมต่อกับระบบจริงแล้ว</p>
        </div>
        <Button variant="ghost" onClick={disconnect}>
          ใช้บัญชีอื่น
        </Button>
      </div>
      <p className="mb-3 mt-5 text-sm font-medium text-ink-2">เลือกว่าวันนี้คุณคือใคร แล้วใส่ PIN</p>
      <RoleCards members={db.members.filter((m) => m.active)} roles={db.roles} onPick={pick} />
      <Dialog open={!!picked} onOpenChange={(o) => !o && setPicked(null)} title={picked ? `PIN ของ ${picked.name}` : "PIN"} description="ใส่ PIN 4 หลักของคุณ" size="sm">
        <div className="space-y-5 pb-2">
          <PinDots length={4} filled={pin.length} error={!!pinError} />
          <p className={pinError ? "text-center text-sm text-danger" : "sr-only"} role={pinError ? "alert" : undefined}>
            {pinError}
          </p>
          <Keypad onKey={onKey} onBackspace={() => setPin((p) => p.slice(0, -1))} onClear={() => setPin("")} size="lg" />
        </div>
      </Dialog>
    </>
  );
}
