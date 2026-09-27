/**
 * Kitchen display timing. Three levels, never colour alone: every level also
 * has an icon and a word so it reads under glare and for colour-blind cooks.
 */
export type Urgency = "ok" | "warn" | "late";

export interface StationTiming {
  warnAfterSec: number;
  lateAfterSec: number;
}

export const DEFAULT_TIMING: StationTiming = { warnAfterSec: 300, lateAfterSec: 600 };

export function elapsedSeconds(firedAt: string | number | Date, now: number = Date.now()): number {
  const t = typeof firedAt === "number" ? firedAt : new Date(firedAt).getTime();
  return Math.max(0, Math.floor((now - t) / 1000));
}

export function urgency(elapsedSec: number, timing: StationTiming = DEFAULT_TIMING): Urgency {
  if (elapsedSec >= timing.lateAfterSec) return "late";
  if (elapsedSec >= timing.warnAfterSec) return "warn";
  return "ok";
}

export const URGENCY_COPY: Record<Urgency, { th: string; en: string; icon: string }> = {
  ok: { th: "ทันเวลา", en: "On time", icon: "clock" },
  warn: { th: "ใกล้เกินเวลา", en: "Hurry", icon: "alert-triangle" },
  late: { th: "เกินเวลา", en: "Late", icon: "flame" },
};

/** 83 → "1:23", 3725 → "1:02:05" */
export function formatElapsed(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

/** Oldest and most urgent first — cooks work top-left to bottom-right. */
export function sortTickets<T extends { firedAt: string; priority?: number }>(tickets: T[]): T[] {
  return [...tickets].sort(
    (a, b) => (b.priority ?? 0) - (a.priority ?? 0) || Date.parse(a.firedAt) - Date.parse(b.firedAt),
  );
}

/** "All-day" counts: how many of each dish are waiting across tickets. */
export function allDayCounts(items: Array<{ name: string; qty: number; done?: boolean; voided?: boolean }>): Array<{ name: string; qty: number }> {
  const m = new Map<string, number>();
  for (const i of items) if (!i.done && !i.voided) m.set(i.name, (m.get(i.name) ?? 0) + i.qty);
  return [...m.entries()].map(([name, qty]) => ({ name, qty })).sort((a, b) => b.qty - a.qty);
}
