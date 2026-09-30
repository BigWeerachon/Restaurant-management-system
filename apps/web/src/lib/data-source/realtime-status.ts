/**
 * What a screen needs to know about the live line, apart from the line itself: which parts of the store are on
 * screen (so an event only reads what is being looked at) and whether the line is up. Kept apart from `realtime.ts`
 * (the stream, which needs the HTTP client) so the pages and the header can show all of this without loading any of it.
 */
import { useSyncExternalStore } from "react";
import type { Slice } from "./types";

// ---------------------------------------------------------------------------
// Which slices are on screen
// ---------------------------------------------------------------------------
const active = new Map<Slice, number>();

/** True while a mounted screen shows this slice. */
export const isSliceActive = (slice: Slice): boolean => active.has(slice);

/** A screen that shows these slices says so while it is mounted; returns the undo. */
export function registerActiveSlices(slices: readonly Slice[]): () => void {
  for (const s of slices) active.set(s, (active.get(s) ?? 0) + 1);
  return () => {
    for (const s of slices) {
      const n = (active.get(s) ?? 1) - 1;
      if (n <= 0) active.delete(s);
      else active.set(s, n);
    }
  };
}

export const activeSlices = (): Slice[] => [...active.keys()];

// ---------------------------------------------------------------------------
// Connection status, for the screen to show
// ---------------------------------------------------------------------------
export type RealtimeStatus = "off" | "connecting" | "live" | "offline";

let status: RealtimeStatus = "off";
const listeners = new Set<() => void>();

export function setRealtimeStatus(next: RealtimeStatus) {
  if (status === next) return;
  status = next;
  for (const l of listeners) l();
}

export const realtimeStatus = (): RealtimeStatus => status;

export function useRealtimeStatus(): RealtimeStatus {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => status,
    () => "off" as const,
  );
}
