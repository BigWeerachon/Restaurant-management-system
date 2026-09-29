/**
 * Shared plumbing for the API adapter: which branch a request is for, how
 * amounts are sent, and the loaders that fill each slice of the store.
 *
 * A loader fetches first and returns a patch, and all patches are applied in a
 * single store update — so a failed request leaves the store as it was.
 */
import { satangToDecimalString } from "@sabai/domain";
import { DomainError } from "../demo/engine";
import { useSabai } from "../demo/store";
import type { DemoState } from "../demo/types";
import { apiFetch } from "./http-client";
import { mapClosedShift, mapCurrentShift, mapOrder, mapTicket, type CurrentShiftApi, type OrderApi, type ShiftRowApi, type TicketApi } from "./live-mappers";
import type { Slice } from "./types";

/** Amounts go to the API as baht with two decimals ("125.50"), never as floats. */
export const baht = (satang: number): string => satangToDecimalString(satang);

export function currentBranchId(): string {
  const { db, session } = useSabai.getState();
  const id = session.branchId ?? db.branches[0]?.id;
  if (!id) throw new DomainError("NOT_FOUND");
  return id;
}

type Patch = (d: DemoState) => void;

const loaders: Partial<Record<Exclude<Slice, "bootstrap">, (branchId: string) => Promise<Patch>>> = {
  // Today's orders of this branch, whole (items, payments, discount), oldest first like the demo keeps them.
  async orders(branchId) {
    const rows = await apiFetch<OrderApi[]>("/v1/orders", { query: { branchId, detail: "full" } });
    return (d) => {
      const mapped = rows.map((o) => mapOrder(o, d.menuItems)).reverse();
      d.orders = [...d.orders.filter((o) => o.branchId !== branchId), ...mapped];
    };
  },

  // The open shift (with cash moves and the server's expected cash) plus closed ones, oldest first.
  async shifts(branchId) {
    const [current, closed] = await Promise.all([
      apiFetch<{ shift: CurrentShiftApi | null }>("/v1/shifts/current", { query: { branchId } }),
      apiFetch<ShiftRowApi[]>("/v1/shifts", { query: { branchId, status: "closed" } }),
    ]);
    return (d) => {
      const mapped = [...closed.map((s) => mapClosedShift(s, branchId)).reverse(), ...(current.shift ? [mapCurrentShift(current.shift, branchId)] : [])];
      d.shifts = [...d.shifts.filter((s) => s.branchId !== branchId), ...mapped];
    };
  },

  // Tickets the kitchen still has to make, plus ones finished in the last few minutes (so a mistaken bump can be recalled).
  async tickets(branchId) {
    const r = await apiFetch<{ tickets: TicketApi[] }>("/v1/kds/tickets", { query: { branchId } });
    return (d) => {
      d.tickets = [...d.tickets.filter((t) => t.branchId !== branchId), ...r.tickets.map((t) => mapTicket(t, branchId))];
    };
  },

  // Which menu items this branch has marked sold out.
  async availability(branchId) {
    const catalog = await apiFetch<{ items: { id: string; sold_out: boolean }[] }>("/v1/catalog", { query: { branchId } });
    return (d) => {
      for (const item of catalog.items) {
        const m = d.menuItems.find((x) => x.id === item.id);
        if (m) m.soldOut[branchId] = item.sold_out;
      }
    };
  },
};

/** Loads slices other than "bootstrap"; a slice with no loader yet is an error rather than a silent no-op. */
export async function loadSlices(slices: Slice[]): Promise<void> {
  const branchId = currentBranchId();
  const patches = await Promise.all(
    slices.map((slice) => {
      const loader = slice === "bootstrap" ? undefined : loaders[slice];
      if (!loader) throw new DomainError("INTERNAL", { feature: `load(${slice})` });
      return loader(branchId);
    }),
  );
  useSabai.getState().patch((d) => {
    for (const patch of patches) patch(d);
  });
}

/**
 * What a command changed: reload the slices that have a loader (the rest arrive with their pages).
 * Best effort — the command already succeeded, so a failed reload must not make it look as if it had
 * failed (a retry could repeat it); the next poll or page load brings the screen up to date.
 */
export async function refresh(slices: Slice[]): Promise<void> {
  // One slice at a time, so a slice this person may not read (the kitchen screen, for a waiter) cannot hold back the others.
  const results = await Promise.allSettled(slices.filter((s) => s !== "bootstrap" && s in loaders).map((s) => loadSlices([s])));
  for (const r of results) if (r.status === "rejected") console.warn("reload after command failed", r.reason);
}
