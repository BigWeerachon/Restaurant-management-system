"use client";

import { humanizeError } from "@sabai/domain";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Keypad, PinDots } from "@/components/ui/feedback";
import { Dialog } from "@/components/ui/overlay";
import { usePinEntry } from "@/hooks/use-pin-entry";
import { useUi } from "@/hooks/use-sabai";
import { accessFromRole, homeFor, type Home, type Permission } from "@sabai/domain";
import { getDataSource } from "@/lib/data-source";
import { isDomainError, useSabai } from "@/lib/demo/store";

/** Shared device: the next person taps their 4-digit PIN and lands on their own screen. */
export function SwitchUserDialog() {
  const open = useUi((s) => s.switchUserOpen);
  const setOpen = useUi((s) => s.setSwitchUserOpen);
  const db = useSabai((s) => s.db);
  const branchId = useSabai((s) => s.session.branchId) ?? db.branches[0]?.id ?? "";
  const router = useRouter();
  const { pin, setPin, error, setError, reset, keypad } = usePinEntry((v) => submit(v));

  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  const submit = async (value: string) => {
    try {
      const m = await getDataSource().pinSwitch(branchId, value);
      const role = useSabai.getState().db.roles.find((r) => r.key === m.roleKey)!;
      setOpen(false);
      toast.success(`สวัสดี ${m.name}`, { description: `เข้าใช้งานในตำแหน่ง ${role.name}` });
      router.push(homeFor(accessFromRole({ grantsAll: role.grantsAll, permissions: role.permissions as Permission[] }), role.home as Home));
    } catch (e) {
      setError(humanizeError(isDomainError(e) ? e.code : "INTERNAL").message);
      setPin("");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen} title="สลับผู้ใช้" description="ใส่ PIN 4 หลักของคุณ" size="sm">
      <div className="space-y-5 pb-2">
        <PinDots length={4} filled={pin.length} error={!!error} />
        <p className={error ? "text-center text-sm text-danger" : "sr-only"} role={error ? "alert" : undefined}>
          {error}
        </p>
        <Keypad {...keypad} size="lg" />
      </div>
    </Dialog>
  );
}
