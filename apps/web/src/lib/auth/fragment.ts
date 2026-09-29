import { jwtExpiry, jwtIdentity, type AuthSession } from "./types";

export type AuthLink = { type: string; session: AuthSession } | { error: string };

/**
 * What Supabase's e-mail links bring back: the session in the part of the address after `#`
 * (`#access_token=…&refresh_token=…&expires_in=3600&type=signup|recovery|magiclink`), or an `error_description`
 * when the link was old or already used. Returns null for any address that is not one of those.
 */
export function parseAuthFragment(hash: string, now: () => number = () => Math.floor(Date.now() / 1000)): AuthLink | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const error = params.get("error_description") ?? params.get("error");
  if (error && (params.has("error_code") || params.has("error"))) return { error };
  const accessToken = params.get("access_token");
  if (!accessToken) return null;
  const expiresIn = Number(params.get("expires_in"));
  const identity = jwtIdentity(accessToken);
  return {
    type: params.get("type") ?? "magiclink",
    session: {
      accessToken,
      refreshToken: params.get("refresh_token"),
      expiresAt: Number(params.get("expires_at")) || jwtExpiry(accessToken) || (expiresIn ? now() + expiresIn : null),
      userId: identity.userId,
      email: identity.email,
    },
  };
}
