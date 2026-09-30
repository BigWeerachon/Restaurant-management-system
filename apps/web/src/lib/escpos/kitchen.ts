import type { Ticket } from "../demo/types";

/** A slip older than this is not worth printing: the kitchen has long since seen it on the screen or made it. */
export const KITCHEN_MAX_AGE_MS = 30 * 60_000;

/**
 * Which tickets need a slip now: this branch's tickets that are new, not cancelled, have something to cook, are recent,
 * and have not been printed on this device yet. Oldest first, so slips come out in the order they were fired.
 */
export function ticketsToPrint(tickets: Ticket[], printed: ReadonlySet<string>, opts: { branchId: string; now: number; maxAgeMs?: number }): Ticket[] {
  const maxAge = opts.maxAgeMs ?? KITCHEN_MAX_AGE_MS;
  return tickets
    .filter((t) => t.branchId === opts.branchId && t.status === "new" && !printed.has(t.id) && opts.now - new Date(t.firedAt).getTime() <= maxAge && t.items.some((i) => i.status !== "voided"))
    .sort((a, b) => a.firedAt.localeCompare(b.firedAt));
}
