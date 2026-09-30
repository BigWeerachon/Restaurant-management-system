import { createHmac, timingSafeEqual } from "node:crypto";
import { ApiFailure } from "../errors";

/** How far a signature's timestamp may be from ours. A captured request cannot be replayed later. */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

/** `t=<unix seconds>,v1=<hex hmac-sha256 of "<t>.<raw body>">` — the header a provider adapter (or the person confirming a transfer) sends. */
export function signWebhook(secret: string, rawBody: string, at: Date = new Date()): string {
  const t = Math.floor(at.getTime() / 1000);
  const v1 = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  return `t=${t},v1=${v1}`;
}

/** Throws AUTH_REQUIRED unless the header is a valid, recent signature of exactly this body. */
export function verifyWebhook(secret: string, rawBody: string, header: string | undefined, now: Date = new Date()): void {
  const parts = Object.fromEntries((header ?? "").split(",").map((p) => p.trim().split("=") as [string, string]));
  const t = Number(parts.t);
  const given = parts.v1 ?? "";
  if (!secret || !Number.isFinite(t) || !/^[0-9a-f]{64}$/.test(given)) throw new ApiFailure("AUTH_REQUIRED", 401, { reason: "bad_signature" });
  if (Math.abs(now.getTime() / 1000 - t) > WEBHOOK_TOLERANCE_SECONDS) throw new ApiFailure("AUTH_REQUIRED", 401, { reason: "stale_signature" });
  const want = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest();
  if (!timingSafeEqual(want, Buffer.from(given, "hex"))) throw new ApiFailure("AUTH_REQUIRED", 401, { reason: "bad_signature" });
}
