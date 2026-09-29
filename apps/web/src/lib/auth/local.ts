import { DomainError } from "../demo/engine";
import { isKnownErrorCode } from "@sabai/domain";
import { jwtExpiry, type AuthProvider, type AuthSession } from "./types";

/** The API's development login: an e-mail is enough, and a new e-mail simply gets an account. */
export function createLocalAuth(cfg: { baseUrl: () => string; fetchImpl?: typeof fetch }): AuthProvider {
  const login = async (email: string): Promise<AuthSession> => {
    const doFetch = cfg.fetchImpl ?? fetch;
    let res: Response;
    try {
      res = await doFetch(new URL("/v1/dev/login", cfg.baseUrl()), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
    } catch (e) {
      throw new DomainError("NETWORK_OFFLINE", { cause: e instanceof Error ? e.message : String(e) });
    }
    const body = (await res.json().catch(() => null)) as { token?: string; userId?: string; error?: { code?: string } } | null;
    if (!res.ok || !body?.token) {
      const code = body?.error?.code;
      throw new DomainError(code && isKnownErrorCode(code) ? code : "INTERNAL");
    }
    return { accessToken: body.token, refreshToken: null, expiresAt: jwtExpiry(body.token), userId: body.userId ?? null, email };
  };
  return {
    kind: "local",
    usesPassword: false,
    signUp: async ({ email }) => ({ session: await login(email) }),
    signIn: ({ email }) => login(email),
    // No password to lose, so renewing is signing in again.
    refresh: (session) => login(session.email),
    signOut: async () => undefined,
  };
}
