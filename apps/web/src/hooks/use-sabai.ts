"use client";

import { accessFromRole, can as canDo, homeFor, humanizeError, navigationFor, type Home, type Permission } from "@sabai/domain";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { create } from "zustand";
import { currentBusinessDate } from "@/lib/demo/engine";
import { getHistory, isDomainError, useSabai } from "@/lib/demo/store";

// ---------------------------------------------------------------------------
// Who am I, what can I do, where do I work
// ---------------------------------------------------------------------------
export function useAccess() {
  const db = useSabai((s) => s.db);
  const session = useSabai((s) => s.session);
  return useMemo(() => {
    const member = db.members.find((m) => m.id === session.memberId) ?? null;
    const role = member ? db.roles.find((r) => r.key === member.roleKey) ?? null : null;
    const access = role ? accessFromRole({ grantsAll: role.grantsAll, permissions: role.permissions as Permission[] }) : { grantsAll: false, permissions: new Set<string>() };
    const branch = db.branches.find((b) => b.id === session.branchId) ?? db.branches[0]!;
    const branches = member?.branchIds === "all" ? db.branches : db.branches.filter((b) => member?.branchIds.includes(b.id));
    return {
      member,
      role,
      access,
      branch,
      branches,
      can: (p: Permission) => canDo(access, p),
      nav: navigationFor(access, role?.key),
      home: homeFor(access, (role?.home as Home) ?? "today"),
    };
  }, [db.members, db.roles, db.branches, session.memberId, session.branchId]);
}

export function useBusinessDate() {
  const db = useSabai((s) => s.db);
  const { branch } = useAccess();
  const now = useNow(60_000);
  return currentBusinessDate(db, branch.id, now);
}

export function useHistory() {
  const db = useSabai((s) => s.db);
  return useMemo(() => getHistory(db), [db.mode, db.seededFor, db.version]); // eslint-disable-line react-hooks/exhaustive-deps
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

// ---------------------------------------------------------------------------
// Manager approval by PIN (global dialog)
// ---------------------------------------------------------------------------
interface ApprovalRequest {
  permission: Permission;
  title: string;
  detail?: string;
  resolve: (approverId: string | null) => void;
}

export const useUi = create<{
  approval: ApprovalRequest | null;
  commandOpen: boolean;
  switchUserOpen: boolean;
  requestApproval: (permission: Permission, title: string, detail?: string) => Promise<string | null>;
  closeApproval: (approverId: string | null) => void;
  setCommandOpen: (v: boolean) => void;
  setSwitchUserOpen: (v: boolean) => void;
}>((set, get) => ({
  approval: null,
  commandOpen: false,
  switchUserOpen: false,
  requestApproval: (permission, title, detail) =>
    new Promise((resolve) => {
      set({ approval: { permission, title, detail, resolve } });
    }),
  closeApproval: (approverId) => {
    get().approval?.resolve(approverId);
    set({ approval: null });
  },
  setCommandOpen: (v) => set({ commandOpen: v }),
  setSwitchUserOpen: (v) => set({ switchUserOpen: v }),
}));

// ---------------------------------------------------------------------------
// Actions: pending state, human errors, approval retry, success feedback
// ---------------------------------------------------------------------------
export function showError(err: unknown) {
  const code = isDomainError(err) ? err.code : "INTERNAL";
  const params = isDomainError(err) ? err.params : {};
  const human = humanizeError(code, params, isDomainError(err) ? undefined : Math.random().toString(16).slice(2, 10).toUpperCase().replace(/(.{4})/, "$1-"));
  if (!isDomainError(err)) console.error(err);
  toast.error(human.title, {
    description: human.reference ? `${human.message} · รหัสอ้างอิง ${human.reference}` : human.message,
  });
  return human;
}

