/**
 * Nothing that identifies a person or unlocks an account leaves this system in a log line or an error report. Two rules:
 * a value under a sensitive *key* is dropped whatever it holds, and text that merely *looks* like a secret is masked.
 */
export const REDACTED = "[redacted]";

const SENSITIVE_WORDS = new Set(["authorization", "cookie", "password", "passwd", "pin", "secret", "token", "apikey", "dsn", "signature", "credential", "credentials", "cvv"]);
const SENSITIVE_PARTS = ["secret", "token", "password", "authorization", "apikey"];

/** `pinHash`, `x-device-token`, `Authorization`, `promptpay_secret` are sensitive; `shipping`, `mapping`, `pinned` are not (whole words only for the short ones). */
export function isSensitiveKey(key: string): boolean {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (words.some((w) => SENSITIVE_WORDS.has(w))) return true;
  const joined = words.join("");
  return SENSITIVE_PARTS.some((p) => joined.includes(p));
}

/** Masks the things that look like secrets inside free text (an error message, a URL). Keeps it short. */
export function redactText(text: string, max = 500): string {
  const masked = text
    .replace(/Bearer\s+[\w.~+/=-]+/gi, "Bearer [redacted]")
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[jwt]")
    .replace(/sbd_[\w-]{16,}/g, "[device-token]")
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[email]")
    // Phone numbers, taxpayer numbers, card numbers: any run of 9+ digits.
    .replace(/\b\d{9,}\b/g, "[number]");
  return masked.length > max ? `${masked.slice(0, max)}…` : masked;
}

/** A URL without its query string or fragment (either can carry a token or a search), and without credentials. */
export function scrubUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return redactText(url.split(/[?#]/)[0] ?? "", 200);
  }
}

/** Deep copy of something to log or report: sensitive keys dropped, strings masked, depth and size limited. */
export function redactFields(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactText(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return String(value);
  if (depth >= 5) return "[truncated]";
  if (value instanceof Error) return { name: value.name, message: redactText(value.message) };
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redactFields(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 40)) {
      out[k] = isSensitiveKey(k) ? REDACTED : redactFields(v, depth + 1);
    }
    return out;
  }
  return String(value);
}
