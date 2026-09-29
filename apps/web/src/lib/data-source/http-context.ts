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
import {
  mapBalances,
  mapClosedShift,
  mapCount,
  mapCurrentShift,
  mapMovement,
  mapOrder,
  mapPurchaseOrder,
  mapTicket,
  type CountDetailApi,
  type CountRowApi,
  type CurrentShiftApi,
  type MovementApi,
  type OrderApi,
  type PurchaseOrderApi,
  type ShiftRowApi,
  type StockRowApi,
  type TicketApi,
} from "./live-mappers";
import { mapShopBootstrap, type ShopApiResponse } from "./mappers";
import type { Slice } from "./types";

/**
 * Fetches `GET /v1/shop` into the shared store. `reset` starts from an empty
 * shop first (and signs everyone out) — used when connecting; a plain refresh
 * keeps the signed-in person and whatever live data has been loaded.
 */
export async function loadShop(opts: { reset: boolean }): Promise<void> {
  const boot = mapShopBootstrap(await apiFetch<ShopApiResponse>("/v1/shop"));
  const store = useSabai.getState();
  if (opts.reset) store.reset("fresh", boot.tenant.name);
  useSabai.getState().patch((d) => {
    // Which items are sold out is per branch and comes from the availability slice, not from the shop itself.
    const soldOut = new Map(d.menuItems.map((m) => [m.id, m.soldOut]));
    Object.assign(d, boot);
    for (const m of d.menuItems) m.soldOut = soldOut.get(m.id) ?? {};
  });
}

/** Best effort, like `refresh`: for commands that change the shop's own data (costs, ingredients, prices). */
export async function refreshShop(): Promise<void> {
  try {
    await loadShop({ reset: false });
  } catch (e) {
    console.warn("shop reload after command failed", e);
  }
}

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

  // Quantity and average cost on hand per ingredient, and the latest movements (oldest first, like the demo keeps them).
  async stock(branchId) {
    const [rows, moves] = await Promise.all([
      apiFetch<StockRowApi[]>("/v1/stock", { query: { branchId } }),
      apiFetch<MovementApi[]>("/v1/stock-movements", { query: { branchId, limit: 200 } }),
    ]);
    return (d) => {
      for (const key of Object.keys(d.balances)) if (key.startsWith(`${branchId}:`)) delete d.balances[key];
      Object.assign(d.balances, mapBalances(rows, branchId));
      d.movements = [...d.movements.filter((m) => m.branchId !== branchId), ...moves.map((m) => mapMovement(m, branchId)).reverse()];
    };
  },

  // The count in progress or waiting for approval (there is at most one per branch in practice).
  async counts(branchId) {
    const rows = await apiFetch<CountRowApi[]>("/v1/stock-counts", { query: { branchId } });
    const active = rows.filter((r) => r.status === "in_progress" || r.status === "submitted");
    const details = await Promise.all(active.map((r) => apiFetch<CountDetailApi>(`/v1/stock-counts/${r.id}`)));
    return (d) => {
      d.counts = [...d.counts.filter((c) => c.branchId !== branchId), ...details.map((c, i) => mapCount(c, active[i]!, branchId))];
    };
  },

  // This branch's purchase orders with their lines and how much of each has arrived, newest first like the demo keeps them.
  async purchasing(branchId) {
    const rows = await apiFetch<PurchaseOrderApi[]>("/v1/purchase-orders", { query: { branchId, detail: "full" } });
    return (d) => {
      d.purchaseOrders = [...rows.map(mapPurchaseOrder), ...d.purchaseOrders.filter((p) => p.branchId !== branchId)];
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
