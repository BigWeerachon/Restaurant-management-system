/**
 * Sign-in for the person who owns the account (checklist 6.1). Two providers behind one interface:
 *   - `supabase`: production. E-mail + password against Supabase Auth; the API verifies the token it issues.
 *   - `local`: development and CI. The API's passwordless dev login; the API never mounts it in production.
 * Staff who share a till do not use either: they switch user with a PIN (`/v1/auth/pin`).
 */
export interface AuthSession {
  accessToken: string;
  /** Present when the provider can renew the session without asking for the password again. */
  refreshToken: string | null;
  /** Seconds since 1970, when known. */
  expiresAt: number | null;
  userId: string | null;
  email: string;
}

export type SignUpResult = { session: AuthSession } | { confirmationSent: true };

export interface Credentials {
  email: string;
  password: string;
}

export interface AuthProvider {
  kind: "local" | "supabase";
  /** Whether the sign-in form must ask for a password (the dev login has none). */
  usesPassword: boolean;
  signUp(input: Credentials): Promise<SignUpResult>;
  signIn(input: Credentials): Promise<AuthSession>;
  /** A fresh session from an existing one. Throws `AUTH_REQUIRED` when the person has to sign in again. */
  refresh(session: AuthSession): Promise<AuthSession>;
  /** Best effort: the device forgets the session whether or not the provider could be told. */
  signOut(session: AuthSession): Promise<void>;
  /** Sends a "set a new password" e-mail. Absent where there are no passwords. */
  resetPassword?(email: string): Promise<void>;
}

/** The expiry (`exp`, seconds) inside a JWT, without checking its signature — only used to know when to renew. */
export function jwtExpiry(token: string): number | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "="))) as { exp?: unknown };
    return typeof json.exp === "number" ? json.exp : null;
  } catch {
    return null;
  }
}
