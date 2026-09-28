"use client";

/**
 * The demo data source: a local, offline-first store (persisted to
 * localStorage). Every mutation goes through `run()`, which applies one engine
 * command atomically (Immer), so a failed command leaves no partial state —
 * the same all-or-nothing guarantee as a database transaction.
 */
import { current, isDraft, produce } from "immer";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { businessDate } from "@sabai/domain";
import { DomainError, type Ctx } from "./engine";
import { generateHistory, type History } from "./history";
import { seedLive } from "./live-seed";
import { DEMO_VERSION, freshState, sampleState } from "./seed";
import type { DemoState, Session } from "./types";

export function todayIso(now = new Date()) {
  return businessDate(now);
}

let historyCache: { key: string; value: History } | null = null;
export function getHistory(db: DemoState): History {
  const key = `${db.mode}:${db.seededFor}:${db.version}`;
  if (!historyCache || historyCache.key !== key) historyCache = { key, value: generateHistory(db, db.seededFor) };
  return historyCache.value;
}

function build(mode: "demo" | "fresh", shopName?: string): DemoState {
  const now = new Date();
  const today = todayIso(now);
  if (mode === "fresh") return freshState(today, shopName);
  const base = sampleState(today);
  return produce(base, (draft) => {
    seedLive(draft, now, today, generateHistory(base, today));
  });
}

interface SabaiStore {
  db: DemoState;
  session: Session;
  hydrated: boolean;
  /** Apply one engine command as the signed-in member. */
  run<T>(fn: (draft: DemoState, ctx: Ctx) => T, opts?: { latencyMs?: number; asMember?: string }): Promise<T>;
  signIn(memberId: string, branchId?: string): void;
  signOut(): void;
  setBranch(branchId: string): void;
  reset(mode: "demo" | "fresh", shopName?: string): void;
  patch(fn: (draft: DemoState) => void): void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const useSabai = create<SabaiStore>()(
  persist(
    (set, get) => ({
      // Cheap placeholder; the real shop is built once, on rehydrate, in the browser.
      db: { ...freshState("1970-01-01"), seededFor: "" },
      session: { memberId: null, branchId: null },
      hydrated: false,

      async run<T>(fn: (draft: DemoState, ctx: Ctx) => T, opts?: { latencyMs?: number; asMember?: string }): Promise<T> {
        if (opts?.latencyMs) await sleep(opts.latencyMs);
        const { db, session } = get();
        const ctx: Ctx = {
          now: new Date(),
          actorId: opts?.asMember ?? session.memberId,
          branchId: session.branchId ?? db.branches[0]!.id,
        };
        let result!: T;
        const next = produce(db, (draft) => {
          const r = fn(draft as DemoState, ctx);
          // Commands may return live drafts; hand callers a plain snapshot.
          result = (isDraft(r) ? current(r as never) : r) as T;
        });
        set({ db: next });
        return result;
      },

      signIn(memberId, branchId) {
        const { db } = get();
        const m = db.members.find((x) => x.id === memberId);
        const allowed = m?.branchIds === "all" ? db.branches.map((b) => b.id) : (m?.branchIds ?? []);
        set({ session: { memberId, branchId: branchId && allowed.includes(branchId) ? branchId : (allowed[0] ?? db.branches[0]!.id) } });
      },

      signOut() {
        set({ session: { memberId: null, branchId: get().session.branchId } });
      },

      setBranch(branchId) {
        set({ session: { ...get().session, branchId } });
      },

      reset(mode, shopName) {
        historyCache = null;
        set({ db: build(mode, shopName), session: { memberId: null, branchId: null } });
      },

      patch(fn) {
        set({ db: produce(get().db, fn) });
      },
    }),
    {
      name: "sabai-demo",
      version: DEMO_VERSION,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ db: s.db, session: s.session }),
      migrate: () => ({ db: build("demo"), session: { memberId: null, branchId: null } }) as never,
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // A new calendar day starts a fresh, lively demo (same mode).
        if (!state.db.seededFor) {
          state.db = build("demo");
          state.session = { memberId: null, branchId: null };
        } else if (state.db.version !== DEMO_VERSION || state.db.seededFor !== todayIso()) {
          state.db = build(state.db.mode ?? "demo");
          state.session = { memberId: null, branchId: null };
        }
        state.hydrated = true;
        useSabai.setState({ hydrated: true, db: state.db, session: state.session });
      },
    },
  ),
);

export function isDomainError(e: unknown): e is DomainError {
  return e instanceof DomainError || (typeof e === "object" && e !== null && (e as { name?: string }).name === "DomainError");
}
