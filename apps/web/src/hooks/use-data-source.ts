"use client";

import type { Permission } from "@sabai/domain";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { dataSourceMode, getDataSource } from "@/lib/data-source";
import { registerActiveSlices, useRealtimeStatus } from "@/lib/data-source/realtime";
import type { ApprovalToken, DataSource, ReportFilter, ReportSummary, Slice, TodayStats } from "@/lib/data-source/types";
import type { BillingState } from "@/lib/demo/types";
import { billing as selectBilling, reportSummary as selectReportSummary, todayStats as selectTodayStats } from "@/lib/demo/selectors";
import { getHistory, isDomainError, useSabai } from "@/lib/demo/store";
import { showError, useAccess, useUi } from "./use-sabai";

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

/** How often to read again while the live line is up: only a safety net, since events say what changed. */
const HEARTBEAT_MS = 60_000;

/**
 * Keeps slices of the store fresh from the API (a no-op in demo mode, where the
 * store already holds everything). Reads them when the screen opens, when the
 * signed-in person or branch changes, and whenever a live event says they changed.
 * `everyMs` is how often to read them anyway while there is no live line — a screen
 * that must not go stale (the kitchen) asks for a short one; with the line up it
 * relaxes to a slow heartbeat.
 */
export function useLoad(slices: Slice[], opts: { everyMs?: number } = {}): LoadState {
  // Asking for no slices (a part of a screen this person may not see) asks for nothing.
  const api = dataSourceMode() === "api" && slices.length > 0;
  const hydrated = useSabai((s) => s.hydrated);
  const memberId = useSabai((s) => s.session.memberId);
  const branchId = useSabai((s) => s.session.branchId);
  const key = slices.join(",");
  const [state, setState] = useState<{ loading: boolean; error: unknown }>({ loading: api, error: null });
  const first = useRef(true);
  const live = useRealtimeStatus() === "live";
  const pollMs = opts.everyMs ? (live ? Math.max(opts.everyMs, HEARTBEAT_MS) : opts.everyMs) : undefined;

  // While this screen is up, events that change what it shows are worth reading again.
  useEffect(() => (api ? registerActiveSlices(key.split(",") as Slice[]) : undefined), [api, key]);

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
    if (!pollMs) return;
    const id = setInterval(() => void run(true), pollMs);
    return () => clearInterval(id);
  }, [api, hydrated, memberId, branchId, run, pollMs]);

  return { ...state, reload: () => run() };
}

export interface QueryState<T> extends LoadState {
  data: T | undefined;
}

/**
 * One question put to the API (a report, today's numbers). Runs when `key` changes — a `null` key asks nothing —
 * and every `everyMs` if given. The answer to a different question is dropped rather than shown under the new
 * heading; a refresh of the same question keeps what is on screen until the new answer arrives.
 */
function useApiQuery<T>(key: string | null, fetcher: () => Promise<T>, opts: { everyMs?: number } = {}): QueryState<T> {
  const hydrated = useSabai((s) => s.hydrated);
  const memberId = useSabai((s) => s.session.memberId);
  const branchId = useSabai((s) => s.session.branchId);
  const [state, setState] = useState<{ key: string | null; data: T | undefined; loading: boolean; error: unknown }>({ key, data: undefined, loading: key !== null, error: null });
  const latest = useRef(fetcher);
  latest.current = fetcher;
  const asked = useRef(0);

  const run = useCallback(
    async (silent = false) => {
      if (key === null) return;
      const n = ++asked.current;
      if (!silent) setState((s) => ({ key, data: s.key === key ? s.data : undefined, loading: true, error: null }));
      try {
        const data = await latest.current();
        if (n === asked.current) setState({ key, data, loading: false, error: null });
      } catch (error) {
        // A poll that fails once is not worth a banner; the next one will retry.
        if (n === asked.current && !silent) setState((s) => ({ key, data: s.key === key ? s.data : undefined, loading: false, error }));
      }
    },
    [key],
  );

  useEffect(() => {
    if (key === null || !hydrated || !memberId) return;
    void run();
    if (!opts.everyMs) return;
    const id = setInterval(() => void run(true), opts.everyMs);
    return () => clearInterval(id);
  }, [key, hydrated, memberId, branchId, run, opts.everyMs]);

  // Until the effect has started for a new key, what is in `state` still answers the old one.
  return { data: state.key === key ? state.data : undefined, loading: key !== null && (state.key !== key || state.loading), error: state.key === key ? state.error : null, reload: () => run() };
}

const NOT_ASKED: QueryState<never> = { data: undefined, loading: false, error: null, reload: async () => {} };

/**
 * The report for a period (`null` asks nothing). API mode asks the server; demo mode has all the data in memory
 * and works it out on the spot, so it also stays current as the demo shop trades.
 */
export function useReportSummary(filter: ReportFilter | null): QueryState<ReportSummary> {
  const api = dataSourceMode() === "api";
  const db = useSabai((s) => s.db);
  const key = filter ? `${filter.from}|${filter.to}|${filter.branchId ?? ""}` : null;
  const local = useMemo(() => (!api && filter ? selectReportSummary(db, getHistory(db), filter) : undefined), [api, db, key]); // eslint-disable-line react-hooks/exhaustive-deps
  const remote = useApiQuery(api ? key : null, () => getDataSource().reportSummary(filter!));
  return api ? remote : { ...NOT_ASKED, data: local };
}

/** Today's numbers for one branch, refreshed every 30 seconds in API mode; `now` matters only to the demo, which counts up to this minute. */
export function useTodayStats(branchId: string, now: Date): QueryState<TodayStats> {
  const api = dataSourceMode() === "api";
  const db = useSabai((s) => s.db);
  const local = useMemo(() => (api ? undefined : selectTodayStats(db, getHistory(db), branchId, now)), [api, db, branchId, now]);
  const remote = useApiQuery(api ? `today|${branchId}` : null, () => getDataSource().today(branchId), { everyMs: 30_000 });
  return api ? remote : { ...NOT_ASKED, data: local };
}

/**
 * The shop's own bill for using Sabai — only for someone who may manage billing (`null` for everyone else, who is never
 * shown it and is never asked the server for it). API mode reads it (again on a live subscription event, and after a
 * plan change); the demo works it out from the plan and the trial.
 */
export function useBilling(): { billing: BillingState | null; load: LoadState } {
  const { can } = useAccess();
  const allowed = can("billing.manage");
  const db = useSabai((s) => s.db);
  const load = useLoad(allowed ? ["billing"] : []);
  if (!allowed) return { billing: null, load };
  return { billing: dataSourceMode() === "api" ? db.billing ?? null : selectBilling(db), load };
}
