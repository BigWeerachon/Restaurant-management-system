"use client";

import type { Permission } from "@sabai/domain";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { dataSourceMode, getDataSource } from "@/lib/data-source";
import type { ApprovalToken, DataSource, Slice } from "@/lib/data-source/types";
import { isDomainError, useSabai } from "@/lib/demo/store";
import { showError, useUi } from "./use-sabai";

interface ExecOptions<T> {
  success?: string | ((r: T) => string);
  successDetail?: string | ((r: T) => string);
  /** When the command says a manager must approve, ask for their PIN and run it again with the approval. */
  approval?: { permission: Permission; title: string; detail?: string };
  silentError?: boolean;
}

/**
 * Runs one data-source command with a pending flag, a human error toast and the
 * approve-by-PIN retry. Works the same in demo and API mode: the command only
 * ever sees the `DataSource`.
 */
export function useDsAction() {
  const requestApproval = useUi((s) => s.requestApproval);
  const [pending, setPending] = useState(false);

  const exec = useCallback(
    async <T,>(command: (ds: DataSource, approval?: ApprovalToken) => Promise<T>, opts: ExecOptions<T> = {}): Promise<{ ok: true; value: T } | { ok: false; code: string }> => {
      setPending(true);
      try {
        const ds = getDataSource();
        let value: T;
        try {
          value = await command(ds);
        } catch (err) {
          if (isDomainError(err) && err.code === "APPROVAL_REQUIRED" && opts.approval) {
            const approver = await requestApproval(opts.approval.permission, opts.approval.title, opts.approval.detail);
            if (!approver) return { ok: false, code: "CANCELLED" };
            value = await command(ds, { value: approver });
          } else {
            throw err;
          }
        }
        if (opts.success) {
          toast.success(typeof opts.success === "function" ? opts.success(value) : opts.success, {
            description: typeof opts.successDetail === "function" ? opts.successDetail(value) : opts.successDetail,
          });
        }
        return { ok: true, value };
      } catch (err) {
        if (!opts.silentError) showError(err);
        return { ok: false, code: isDomainError(err) ? err.code : "INTERNAL" };
      } finally {
        setPending(false);
      }
    },
    [requestApproval],
  );

  return { exec, pending };
}

export interface LoadState {
  /** True while the first load is running. */
  loading: boolean;
  error: unknown;
  reload: () => Promise<void>;
}

/**
 * Keeps slices of the store fresh from the API (a no-op in demo mode, where the
 * store already holds everything). Reloads when the signed-in person or branch
 * changes, and every `everyMs` if given — until live events arrive (phase 5).
 */
export function useLoad(slices: Slice[], opts: { everyMs?: number } = {}): LoadState {
  const api = dataSourceMode() === "api";
  const hydrated = useSabai((s) => s.hydrated);
  const memberId = useSabai((s) => s.session.memberId);
  const branchId = useSabai((s) => s.session.branchId);
  const key = slices.join(",");
  const [state, setState] = useState<{ loading: boolean; error: unknown }>({ loading: api, error: null });
  const first = useRef(true);

  const run = useCallback(
    async (silent = false) => {
      if (!api) return;
      if (!silent) setState((s) => ({ ...s, loading: first.current, error: null }));
      try {
        await getDataSource().load(key.split(",") as Slice[]);
        first.current = false;
        setState({ loading: false, error: null });
      } catch (error) {
        // A poll that fails once is not worth a banner; the next one will retry.
        if (!silent) setState({ loading: false, error });
      }
    },
    [api, key],
  );

  useEffect(() => {
    if (!api || !hydrated || !memberId) return;
    first.current = true;
    void run();
    if (!opts.everyMs) return;
    const id = setInterval(() => void run(true), opts.everyMs);
    return () => clearInterval(id);
  }, [api, hydrated, memberId, branchId, run, opts.everyMs]);

  return { ...state, reload: () => run() };
}
