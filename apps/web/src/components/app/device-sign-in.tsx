"use client";

import { accessFromRole, homeFor, humanizeError, type Home, type Permission } from "@sabai/domain";
import { MonitorSmartphone, WifiOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Keypad, PinDots } from "@/components/ui/feedback";
import { usePinEntry } from "@/hooks/use-pin-entry";
import { Dialog } from "@/components/ui/overlay";
import { Callout } from "@/components/ui/primitives";
import { devicePinSignIn, fetchRoster, type DeviceRoster } from "@/lib/data-source/devices";
import { getDevice } from "@/lib/device";
import { isDomainError, useSabai } from "@/lib/demo/store";
import type { Member, Role } from "@/lib/demo/types";
import { RoleCards } from "./role-cards";

/**
 * The welcome screen of a registered till: who works here today? Tap a name, enter a PIN. No e-mail, no account on
 * the device — the till's own secret is what lets it ask. (An owner or manager can still sign in with e-mail.)
 */
export function DeviceSignIn({ onEmail }: { onEmail: () => void }) {
  const router = useRouter();
  const [roster, setRoster] = useState<DeviceRoster | null>(null);
  const [error, setError] = useState<{ code: string; text: string } | null>(null);
  const [picked, setPicked] = useState<Member | null>(null);
  const { pin, setPin, error: pinError, setError: setPinError, reset: resetPin, keypad } = usePinEntry((v) => void submit(v));

  const load = useCallback(async () => {
    setError(null);
    try {
      setRoster(await fetchRoster());
    } catch (e) {
      const code = isDomainError(e) ? e.code : "INTERNAL";
      const h = humanizeError(code);
      setError({ code, text: `${h.title} — ${h.message}` });
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  // The people who can sign in here, shaped as the welcome cards expect.
  const members: Member[] = (roster?.staff ?? []).map((s) => ({ id: s.id, name: s.displayName, nickname: s.nickname ?? undefined, roleKey: s.roleKey, pin: "", branchIds: "all", color: s.color ?? "emerald", active: true }));
  const roles: Role[] = [...new Map((roster?.staff ?? []).map((s) => [s.roleKey, s.roleName])).entries()].map(([key, name]) => ({ key, name, description: "", grantsAll: false, home: "/", color: "emerald", permissions: [] }));

  const submit = async (value: string) => {
    try {
      const m = await devicePinSignIn(value);
      const role = useSabai.getState().db.roles.find((r) => r.key === m.roleKey)!;
      setPicked(null);
      router.push(homeFor(accessFromRole({ grantsAll: role.grantsAll, permissions: role.permissions as Permission[] }), role.home as Home));
    } catch (e) {
      const code = isDomainError(e) ? e.code : "INTERNAL";
      if (code === "DEVICE_REVOKED") {
        // The owner cancelled this device: say so, and offer the way in that is left.
        setPicked(null);
        const h = humanizeError(code);
        setError({ code, text: `${h.title} — ${h.message}` });
        return;
      }
      const h = humanizeError(code);
      setPinError(`${h.title} — ${h.message}`);
      setPin("");
    }
  };

  const device = getDevice();

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="enter-title" className="text-xl font-semibold text-ink">
            {roster?.tenant.name ?? "เข้าใช้งาน"}
          </h2>
          <p className="flex items-center gap-1.5 text-sm text-ink-3">
            <MonitorSmartphone className="h-4 w-4" aria-hidden="true" />
            {roster ? `${roster.device.name} · ${roster.branch.name}` : device?.name}
          </p>
        </div>
      </div>

      {error ? (
        <div className="mt-5 space-y-3">
          <Callout
            tone={error.code === "NETWORK_OFFLINE" ? "warning" : "danger"}
            title={error.code === "NETWORK_OFFLINE" ? "ต่อเซิร์ฟเวอร์ไม่ได้" : "เข้าใช้งานบนเครื่องนี้ไม่ได้"}
            action={
              error.code === "DEVICE_REVOKED" ? undefined : (
                <Button size="sm" variant="secondary" onClick={() => void load()}>
                  ลองอีกครั้ง
                </Button>
              )
            }
          >
            {error.text}
          </Callout>
          {error.code === "NETWORK_OFFLINE" && (
            <p className="flex items-start gap-2 text-sm text-ink-3">
              <WifiOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              ถ้าเมื่อกี้เข้าใช้งานอยู่แล้ว เปิดหน้าขายต่อได้เลย ระบบจะส่งข้อมูลที่ขายไว้ให้เองเมื่อกลับมาออนไลน์
            </p>
          )}
        </div>
      ) : !roster ? (
        <p role="status" className="mt-5 text-sm text-ink-3">
          กำลังโหลดรายชื่อพนักงาน…
        </p>
      ) : (
        <>
          <p className="mb-3 mt-5 text-sm font-medium text-ink-2">วันนี้ใครอยู่หน้าร้าน? กดชื่อตัวเอง แล้วใส่ PIN</p>
          {members.length === 0 ? (
            <Callout tone="info" title="ยังไม่มีพนักงานที่ตั้ง PIN ไว้">
              ให้เจ้าของร้านเข้าด้วยอีเมล แล้วตั้ง PIN ให้พนักงานที่หน้า “ทีมงาน”
            </Callout>
          ) : (
            <RoleCards
              members={members}
              roles={roles}
              onPick={(id) => {
                setPicked(members.find((m) => m.id === id) ?? null);
                resetPin();
              }}
            />
          )}
        </>
      )}

      <div className="mt-6 border-t border-line pt-4">
        <Button variant="ghost" onClick={onEmail}>
          เจ้าของร้านหรือผู้จัดการ: เข้าด้วยอีเมล
        </Button>
      </div>

      <Dialog open={!!picked} onOpenChange={(o) => !o && setPicked(null)} title={picked ? `PIN ของ ${picked.name}` : "PIN"} description="ใส่ PIN 4 หลักของคุณ" size="sm">
        <div className="space-y-5 pb-2">
          <PinDots length={4} filled={pin.length} error={!!pinError} />
          <p className={pinError ? "text-center text-sm text-danger" : "sr-only"} role={pinError ? "alert" : undefined}>
            {pinError}
          </p>
          <Keypad {...keypad} size="lg" />
        </div>
      </Dialog>
    </>
  );
}
