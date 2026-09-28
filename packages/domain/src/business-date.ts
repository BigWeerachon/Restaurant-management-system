/**
 * Business day. A sale at 01:30 in a bar that closes at 03:00 belongs to
 * "yesterday's" business day. Mirrors app.business_date().
 */
export interface BusinessDayConfig {
  timeZone: string;
  /** "05:00" — activity before this local time counts for the previous day. */
  cutoff: string;
}

export const DEFAULT_BUSINESS_DAY: BusinessDayConfig = { timeZone: "Asia/Bangkok", cutoff: "05:00" };

export function businessDate(at: Date, cfg: BusinessDayConfig = DEFAULT_BUSINESS_DAY): string {
  const [h = 0, m = 0] = cfg.cutoff.split(":").map(Number);
  const shifted = new Date(at.getTime() - (h * 60 + m) * 60_000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: cfg.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(shifted);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** "ศ. 27 ก.ย. 2569" — Thai display with Buddhist era (data stays ISO). */
export function formatThaiDate(isoDate: string, withWeekday = true): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: "UTC",
    ...(withWeekday ? { weekday: "short" as const } : {}),
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(d);
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (both ISO dates); negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Wall-clock hour and minute in the shop's time zone (not the device's). */
export function shopClock(at: Date, timeZone = "Asia/Bangkok"): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { hour: get("hour"), minute: get("minute") };
}
