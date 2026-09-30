import { jwtVerify, SignJWT } from "jose";
import { ApiFailure } from "./errors";

/**
 * Who is calling.
 *   – A signed-in person: Supabase access token (HS256) with `sub`.
 *   – A PIN-switched staff member on a shared device: token minted by this API
 *     with `mid` (membership id) — PIN-only staff have no e-mail account.
 */
export interface Actor {
  userId: string | null;
  membershipId: string | null;
  claims: Record<string, unknown>;
}

export async function verifyToken(token: string, secret: string): Promise<Actor> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), { algorithms: ["HS256"] });
    if (payload.role && payload.role !== "authenticated") throw new Error("role");
    const sub = typeof payload.sub === "string" ? payload.sub : null;
    const mid = typeof payload.mid === "string" ? payload.mid : null;
    if (!sub && !mid) throw new Error("no subject");
    return { userId: sub, membershipId: mid, claims: { ...payload, role: "authenticated" } };
  } catch {
    throw new ApiFailure("AUTH_REQUIRED", 401);
  }
}

export async function mintStaffToken(opts: {
  secret: string;
  membershipId: string;
  tenantId: string;
  branchId: string;
  ttlSeconds: number;
  /** The registered till the PIN was entered on, when there was one. */
  deviceId?: string;
}): Promise<{ token: string; expiresAt: string }> {
  const exp = Math.floor(Date.now() / 1000) + opts.ttlSeconds;
  const token = await new SignJWT({ role: "authenticated", mid: opts.membershipId, tid: opts.tenantId, bid: opts.branchId, amr: ["pin"], ...(opts.deviceId ? { did: opts.deviceId } : {}) })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime(exp)
    .setAudience("authenticated")
    .sign(new TextEncoder().encode(opts.secret));
  return { token, expiresAt: new Date(exp * 1000).toISOString() };
}

/** Test/dev helper: a user token shaped like Supabase's. */
export async function mintUserToken(secret: string, userId: string, ttlSeconds = 3600): Promise<string> {
  return new SignJWT({ role: "authenticated" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .setAudience("authenticated")
    .sign(new TextEncoder().encode(secret));
}
