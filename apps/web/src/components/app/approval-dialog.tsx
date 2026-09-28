"use client";

import { humanizeError } from "@sabai/domain";
import { ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { Avatar } from "@/components/ui/primitives";
import { Keypad, PinDots } from "@/components/ui/feedback";
import { Dialog } from "@/components/ui/overlay";
import { useUi } from "@/hooks/use-sabai";
import { approverByPin, memberCan } from "@/lib/demo/engine";
import { isDomainError, useSabai } from "@/lib/demo/store";

/**
 * "ให้ผู้จัดการใส่ PIN" — never a dead end for staff. The dialog says what is
 * being approved and who can approve it, so nobody has to guess.
 */
export function ApprovalDialog() {
  const approval = useUi((s) => s.approval);
  const close = useUi((s) => s.closeApproval);
  const db = useSabai((s) => s.db);
  const branchId = useSabai((s) => s.session.branchId) ?? db.branches[0]?.id ?? "";
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPin("");
    setError(null);
  }, [approval]);

  const approvers = approval ? db.members.filter((m) => m.active && memberCan(db, m.id, approval.permission, branchId)) : [];

  const submit = (value: string) => {
    if (!approval) return;
    try {
      const m = approverByPin(db, value, approval.permission, branchId);
      close(m.id);
    } catch (e) {
      const h = humanizeError(isDomainError(e) ? e.code : "INTERNAL");
      setError(h.message);
      setPin("");
    }
  };

  const onKey = (k: string) => {
    if (pin.length >= 6) return;
    const next = pin + k;
    setError(null);
    setPin(next);
    if (next.length === 4) setTimeout(() => submit(next), 120);
  };

  return (
    <Dialog open={!!approval} onOpenChange={(o) => !o && close(null)} title="ต้องให้ผู้จัดการอนุมัติ" description={approval?.title} size="sm">
      <div className="space-y-5 pb-2">
        {approval?.detail && <p className="rounded-xl bg-surface-2 px-3.5 py-2.5 text-sm text-ink-2">{approval.detail}</p>}
        <div className="flex items-center gap-2 text-sm text-ink-3">
          <ShieldCheck className="h-4 w-4 text-brand" aria-hidden="true" />
          <span>อนุมัติได้โดย</span>
          <span className="flex -space-x-1.5">
            {approvers.slice(0, 4).map((m) => (
              <Avatar key={m.id} name={m.name} color={m.color} size={24} className="ring-2 ring-surface" />
            ))}
          </span>
          <span className="truncate text-ink-2">{approvers.map((m) => m.name).join(", ")}</span>
        </div>
        <div className="space-y-2">
          <PinDots length={4} filled={pin.length} error={!!error} />
          <p className={error ? "text-center text-sm text-danger" : "text-center text-sm text-ink-3"} role={error ? "alert" : undefined}>
            {error ?? "ผู้จัดการใส่ PIN 4 หลักบนเครื่องนี้"}
          </p>
        </div>
        <Keypad onKey={onKey} onBackspace={() => setPin((p) => p.slice(0, -1))} onClear={() => setPin("")} />
        <p className="text-center text-xs text-ink-3">ตัวอย่าง: พี่นิด (ผู้จัดการ) PIN 2222 · คุณปิยะ (เจ้าของ) PIN 1234</p>
      </div>
    </Dialog>
  );
}
