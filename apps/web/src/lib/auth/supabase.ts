import { DomainError } from "../demo/engine";
import type { AuthProvider, AuthSession, Credentials } from "./types";

/** What GoTrue (Supabase Auth) says when it refuses, turned into the app's own error codes. */
export function mapSupabaseError(status: number, body: unknown): DomainError {
  const b = (body ?? {}) as Record<string, unknown>;
  const code = String(b.error_code ?? b.code ?? b.error ?? "").toLowerCase();
  const msg = String(b.msg ?? b.message ?? b.error_description ?? "").toLowerCase();
  if (code === "invalid_credentials" || (code === "invalid_grant" && msg.includes("invalid login")) || msg.includes("invalid login credentials")) return new DomainError("AUTH_INVALID");
  if (code === "user_already_exists" || code === "email_exists" || msg.includes("already registered")) return new DomainError("EMAIL_TAKEN");
  if (code === "weak_password" || msg.includes("password should be") || msg.includes("password is too")) return new DomainError("WEAK_PASSWORD");
  if (code === "email_not_confirmed" || msg.includes("email not confirmed")) return new DomainError("EMAIL_NOT_CONFIRMED");
  if (status === 429 || code.includes("rate_limit")) return new DomainError("RATE_LIMITED");
  if (code === "validation_failed" || code === "email_address_invalid" || status === 422) return new DomainError("VALIDATION", { fields: { email: "อีเมลนี้ใช้ไม่ได้ ตรวจตัวสะกดอีกครั้ง" } });
  // A refresh that is refused means the session is over, whatever the exact reason (expired, used up, revoked).
  if (code.startsWith("refresh_token") || msg.includes("refresh token") || code === "invalid_grant" || code === "session_expired" || code === "session_not_found" || code === "bad_jwt" || status === 401) return new DomainError("AUTH_REQUIRED");
  return new DomainError("INTERNAL");
}

interface GoTrueSession {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
  expires_in?: number;
  user?: { id?: string; email?: string };
}

/** Supabase Auth over its REST API — no client library, so the bundle stays small and the calls are easy to test. */
export function createSupabaseAuth(cfg: { url: string; anonKey: string; fetchImpl?: typeof fetch; now?: () => number }): AuthProvider {
  const base = cfg.url.replace(/\/+$/, "");
  const now = cfg.now ?? (() => Math.floor(Date.now() / 1000));

  const call = async (path: string, body: unknown, bearer?: string, method: "POST" | "PUT" = "POST"): Promise<{ status: number; json: any }> => {
    const doFetch = cfg.fetchImpl ?? fetch;
    let res: Response;
    try {
      res = await doFetch(`${base}/auth/v1/${path}`, {
        method,
        headers: { "content-type": "application/json", apikey: cfg.anonKey, ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new DomainError("NETWORK_OFFLINE", { cause: e instanceof Error ? e.message : String(e) });
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // Not JSON (a proxy page): handled below by the status alone.
    }
    if (!res.ok) throw mapSupabaseError(res.status, json);
    return { status: res.status, json };
  };

  const toSession = (json: GoTrueSession, fallbackEmail: string): AuthSession => ({
    accessToken: json.access_token!,
    refreshToken: json.refresh_token ?? null,
    expiresAt: json.expires_at ?? (json.expires_in ? now() + json.expires_in : null),
    userId: json.user?.id ?? null,
    email: json.user?.email ?? fallbackEmail,
  });

  const signIn = async ({ email, password }: Credentials) => {
    const { json } = await call("token?grant_type=password", { email, password });
    if (!json?.access_token) throw new DomainError("INTERNAL");
    return toSession(json, email);
  };

  return {
    kind: "supabase",
    usesPassword: true,
    signIn,
    async signUp({ email, password }) {
      const { json } = await call("signup", { email, password });
      // With e-mail confirmation on, Supabase answers with the user and no session: the person has to open the link first.
      return json?.access_token ? { session: toSession(json, email) } : { confirmationSent: true };
    },
    async refresh(session) {
      if (!session.refreshToken) throw new DomainError("AUTH_REQUIRED");
      const { json } = await call("token?grant_type=refresh_token", { refresh_token: session.refreshToken });
      if (!json?.access_token) throw new DomainError("AUTH_REQUIRED");
      return toSession(json, session.email);
    },
    async signOut(session) {
      try {
        // This device only: signing out here must not end the owner's sessions on their other devices.
        await call("logout?scope=local", {}, session.accessToken);
      } catch {
        // The token may already be dead, or there may be no line: either way this device forgets it.
      }
    },
    async resetPassword(email) {
      await call("recover", { email });
    },
    async updatePassword(session, password) {
      await call("user", { password }, session.accessToken, "PUT");
    },
  };
}
