/**
 * Thin fetch wrapper for `HttpDataSource`: attaches the bearer token,
 * `X-Tenant-Id`, and an `Idempotency-Key` on POSTs; retries a request that
 * never reached the server (not one the server answered, even with an
 * error); and turns the API's `{ error: {...} }` envelope into the same
 * `DomainError` the demo engine throws, so `isDomainError()`/`showError()`
 * in `apps/web/src/hooks/use-sabai.ts` work unchanged for both adapters.
 */
import { DomainError } from "../demo/engine";
import { isKnownErrorCode } from "@sabai/domain";

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 500;

export function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";
}

/** In-memory session for the API adapter — cleared on reload, set again on sign-in. Persisted to localStorage so a refresh doesn't force a re-login. */
interface ApiSession {
  token: string | null;
  tenantId: string | null;
}

const SESSION_KEY = "sabai-api-session";

function loadSession(): ApiSession {
  if (typeof localStorage === "undefined") return { token: null, tenantId: null };
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return { token: null, tenantId: null };
    return JSON.parse(raw) as ApiSession;
  } catch {
    return { token: null, tenantId: null };
  }
}

let session: ApiSession = loadSession();

function saveSession() {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // Private browsing / storage disabled — the session just won't survive a reload.
  }
}

export function setApiSession(next: Partial<ApiSession>) {
  session = { ...session, ...next };
  saveSession();
}

export function getApiSession(): Readonly<ApiSession> {
  return session;
}

export function clearApiSession() {
  session = { token: null, tenantId: null };
  saveSession();
}

function newIdempotencyKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `idem-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

interface ApiErrorBody {
  error: { code: string; reference?: string; fields?: Record<string, string>; details?: Record<string, unknown> };
}

async function toDomainError(res: Response): Promise<DomainError> {
  let body: ApiErrorBody | null = null;
  try {
    body = (await res.json()) as ApiErrorBody;
  } catch {
    // Not JSON (a proxy error page, a dead server, ...).
  }
  const code = body?.error?.code;
  const params = { ...(body?.error?.details ?? {}), ...(body?.error?.fields ? { fields: body.error.fields } : {}) };
  // The API always sends a code from the same catalog the demo throws; if it
  // ever doesn't (a proxy, a 502 HTML page, ...), fall back to INTERNAL.
  return new DomainError(code && isKnownErrorCode(code) ? code : "INTERNAL", params);
}

export interface ApiFetchOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  /** Extra query params appended to the URL. */
  query?: Record<string, string | number | boolean | undefined>;
  /** Attach X-Tenant-Id. Defaults to true — nearly every endpoint needs it once signed in. */
  tenant?: boolean;
  timeoutMs?: number;
}

/**
 * Calls one API endpoint and returns its parsed JSON body, or throws a
 * `DomainError` — the same shape `apps/web/src/hooks/use-sabai.ts` already
 * knows how to turn into a toast. Idempotency-Key is attached to every POST
 * automatically so a retried request (ours or the caller's) is always safe.
 */
export async function apiFetch<T = unknown>(path: string, opts: ApiFetchOptions = {}): Promise<T> {
  const method = opts.method ?? "GET";
  const url = new URL(path, apiBaseUrl());
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));

  const headers: Record<string, string> = {};
  if (session.token) headers.Authorization = `Bearer ${session.token}`;
  if ((opts.tenant ?? true) && session.tenantId) headers["X-Tenant-Id"] = session.tenantId;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (method === "POST") headers["Idempotency-Key"] = newIdempotencyKey();

  let lastNetworkError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) throw await toDomainError(res);
      if (res.status === 204) return undefined as T;
      const text = await res.text();
      return (text ? JSON.parse(text) : undefined) as T;
    } catch (err) {
      clearTimeout(timeout);
      // A DomainError means the server answered (with an error) — never retry that, it'll fail the same way again.
      if (err instanceof DomainError) throw err;
      lastNetworkError = err;
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * 2 ** attempt));
        continue;
      }
    }
  }
  throw new DomainError("NETWORK_OFFLINE", { cause: lastNetworkError instanceof Error ? lastNetworkError.message : String(lastNetworkError) });
}
