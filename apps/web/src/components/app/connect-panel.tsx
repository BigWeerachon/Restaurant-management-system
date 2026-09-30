"use client";

import { accessFromRole, homeFor, humanizeError, type Home, type Permission } from "@sabai/domain";
import { ArrowRight, Store, UserCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Keypad, PinDots } from "@/components/ui/feedback";
import { Dialog } from "@/components/ui/overlay";
import { Callout, Field, Input } from "@/components/ui/primitives";
import { getAuthProvider } from "@/lib/auth";
import { parseAuthFragment } from "@/lib/auth/fragment";
import { getAccount, signInAccount, signOutAccount, startAccountSession } from "@/lib/auth/session";
import { listShops, openShop, type ShopChoice } from "@/lib/data-source/connect";
import { apiFetch, getApiSession } from "@/lib/data-source/http-client";
import { httpDataSource } from "@/lib/data-source/http-data-source";
import { isDomainError, useSabai } from "@/lib/demo/store";
import type { Member } from "@/lib/demo/types";
import { getDevice } from "@/lib/device";
import { DeviceSignIn } from "./device-sign-in";
import { RoleCards } from "./role-cards";

type Phase = "email" | "shops" | "team" | "device";

/** Title and message together: for a wrong password, the title ("อีเมลหรือรหัสผ่านไม่ถูกต้อง") is the part that says what happened. */
const errorText = (e: unknown) => {
  const h = humanizeError(isDomainError(e) ? e.code : "INTERNAL", isDomainError(e) ? e.params : {});
  return `${h.title} — ${h.message}`;
};

/** API mode's replacement for the sample-shop picker: sign in, choose a shop, then tap your role and enter your PIN. */
export function ConnectPanel() {
  const db = useSabai((s) => s.db);
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>(() => {
    const s = getApiSession();
    // A registered till with nobody signed in asks "who is here?"; signing in with e-mail stays one tap away.
    return s.token && s.tenantId ? "team" : getDevice() ? "device" : "email";
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
  const [meError, setMeError] = useState<string | null>(null);
  /** Good or neutral news for the top of the form: e-mail confirmed, reset link sent, link expired. */
  const [notice, setNotice] = useState<{ tone: "success" | "info" | "warning"; text: string } | null>(null);

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
      await continueWithAccount();
    });

  /** The account is signed in: find its shops and go on to the one to open (or to opening the first). */
  const continueWithAccount = async () => {
    const found = await listShops();
    if (found.length === 0) {
      // A signed-in account with no shop yet (e.g. just confirmed by e-mail): carry on to opening one.
      router.push("/signup");
    } else if (found.length === 1) {
      await openShop(found[0]!.tenantId);
      setPhase("team");
    } else {
      setShops(found);
      setPhase("shops");
    }
  };

  const chooseShop = (tenantId: string) =>
    guard(async () => {
      await openShop(tenantId);
      setPhase("team");
    });

  const disconnect = () => {
    void signOutAccount();
    setPhase(getDevice() ? "device" : "email");
    setPassword("");
    setError(null);
  };

  useEffect(() => {
    let cancelled = false;
    // Opened from an e-mail: the link carries a session in the part of the address after "#". Checked when the page
    // opens, and again if the link is opened while this page is already showing (only the "#" part changes).
    const handleLink = async () => {
      const link = parseAuthFragment(window.location.hash);
      if (link) {
        // The session must not stay in the address bar or the browser history.
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
        if ("error" in link) {
          setNotice({ tone: "warning", text: "ลิงก์นี้หมดอายุหรือถูกใช้ไปแล้ว ขอลิงก์ใหม่ได้ที่นี่" });
          return;
        }
        startAccountSession(link.session);
        if (link.type === "recovery") {
          router.replace("/reset-password");
          return;
        }
        setNotice({ tone: "success", text: "ยืนยันอีเมลเรียบร้อยแล้ว" });
      }
      // Signed in earlier (or just now, by link) but no shop opened yet: carry on from where it stopped.
      const s = getApiSession();
      if (s.token && !s.tenantId && getAccount() && !cancelled) await guard(continueWithAccount);
    };
    void handleLink();
    const onHash = () => void handleLink();
    window.addEventListener("hashchange", onHash);
    return () => {
      cancelled = true;
      window.removeEventListener("hashchange", onHash);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const forgot = () =>
    guard(async () => {
      if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
        setError("ใส่อีเมลของคุณในช่องด้านบนก่อน แล้วกด “ลืมรหัสผ่าน” อีกครั้ง");
        return;
      }
      await auth.resetPassword?.(email.trim());
      // The same answer whether or not the address has an account: this form must not tell strangers who is a customer.
      setNotice({ tone: "info", text: "ถ้าอีเมลนี้มีบัญชีอยู่ เราส่งลิงก์ตั้งรหัสผ่านใหม่ให้แล้ว ตรวจกล่องจดหมาย (รวมถึงจดหมายขยะ)" });
    });

  const account = getAccount();
  // Whether the signed-in account is one of this shop's people (an owner who has not set a PIN yet has only this way in).
  const [myName, setMyName] = useState<string | null>(null);
  useEffect(() => {
    if (phase !== "team" || !account) return;
    let cancelled = false;
    void (async () => {
      try {
        const { tenantId } = getApiSession();
        const me = await apiFetch<{ memberships: { tenantId: string; displayName: string }[] }>("/v1/me", { tenant: false });
        if (!cancelled) setMyName(me.memberships.find((m) => m.tenantId === tenantId)?.displayName ?? null);
      } catch {
        if (!cancelled) setMyName(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [phase, account]);

  const enterAsMe = () =>
    guard(async () => {
      try {
        const m = await httpDataSource.signInAsAccount();
        const role = useSabai.getState().db.roles.find((r) => r.key === m.roleKey)!;
        router.push(homeFor(accessFromRole({ grantsAll: role.grantsAll, permissions: role.permissions as Permission[] }), role.home as Home));
      } catch (e) {
        setMeError(errorText(e));
      }
    });

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

  if (phase === "device") return <DeviceSignIn onEmail={() => setPhase("email")} />;

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
        {notice && (
          <Callout tone={notice.tone} className="text-sm">
            {notice.text}
          </Callout>
        )}
        <Field label="อีเมล" htmlFor="connect-email" error={auth.usesPassword ? undefined : error}>
          <Input id="connect-email" type="email" autoComplete="email" value={email} invalid={!!error} placeholder="owner@sabai.dev" onChange={(e) => setEmail(e.target.value)} />
        </Field>
        {auth.usesPassword && (
          <Field label="รหัสผ่าน" htmlFor="connect-password" error={error}>
            <Input id="connect-password" type="password" autoComplete="current-password" value={password} invalid={!!error} onChange={(e) => setPassword(e.target.value)} />
          </Field>
        )}
        {auth.resetPassword && (
          <button type="button" onClick={() => void forgot()} className="-mt-2 inline-flex h-11 items-center text-sm font-medium text-brand underline underline-offset-2">
            ลืมรหัสผ่าน
          </button>
        )}
        <Button type="submit" size="lg" block disabled={busy} iconRight={<ArrowRight className="h-4 w-4" />}>
          {busy ? "กำลังเชื่อมต่อ…" : auth.usesPassword ? "เข้าสู่ระบบ" : "เชื่อมต่อ"}
        </Button>
        {getDevice() && (
          <Button type="button" variant="ghost" block onClick={() => setPhase("device")}>
            กลับไปเลือกพนักงาน (เข้าด้วย PIN)
          </Button>
        )}
        <p className="text-center text-sm text-ink-3">
          ยังไม่มีร้าน?{" "}
          <Link href="/signup" className="font-medium text-brand underline underline-offset-2">
            สมัครและเปิดร้านใหม่
          </Link>
        </p>
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
      {account && myName && (
        <div className="mt-5">
          <Button variant="secondary" size="lg" block loading={busy} icon={<UserCheck className="h-5 w-5" />} onClick={() => void enterAsMe()}>
            เข้าเป็น {myName} ด้วยบัญชี {account.email}
          </Button>
          {meError && (
            <p className="mt-2 text-sm text-danger" role="alert">
              {meError}
            </p>
          )}
        </div>
      )}
      <p className="mb-3 mt-5 text-sm font-medium text-ink-2">{account && myName ? "หรือเลือกว่าวันนี้ใครอยู่หน้าร้าน แล้วใส่ PIN" : "เลือกว่าวันนี้คุณคือใคร แล้วใส่ PIN"}</p>
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
