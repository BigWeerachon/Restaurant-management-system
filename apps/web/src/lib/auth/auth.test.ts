import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearApiSession, apiFetch, getApiSession, setApiSession, setSessionRenewer } from "../data-source/http-client";
import { authKind, setAuthProviderForTests, type AuthProvider, type AuthSession } from "./index";
import { createLocalAuth } from "./local";
import { getAccount, installAuthRenewer, recoverFromUnauthorized, renewAccount, resetAccountForTests, setAccount, signInAccount, signOutAccount } from "./session";
import { createSupabaseAuth, mapSupabaseError } from "./supabase";
import { parseAuthFragment } from "./fragment";
import { jwtExpiry, jwtIdentity } from "./types";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const jwt = (payload: object) => `h.${btoa(JSON.stringify(payload)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}.s`;

describe("which sign-in the app uses", () => {
  it("takes the one named, else Supabase when a project is configured, else the local login", () => {
    expect(authKind({ provider: "local", url: "https://x.supabase.co", anonKey: "k" })).toBe("local");
    expect(authKind({ provider: "supabase" })).toBe("supabase");
    expect(authKind({ url: "https://x.supabase.co", anonKey: "k" })).toBe("supabase");
    expect(authKind({ url: "https://x.supabase.co" })).toBe("local"); // half a configuration is not one
    expect(authKind({})).toBe("local");
  });
});

describe("jwtExpiry", () => {
  it("reads exp from a token, and gives up quietly on anything else", () => {
    expect(jwtExpiry(jwt({ exp: 1_900_000_000 }))).toBe(1_900_000_000);
    expect(jwtExpiry(jwt({ sub: "u" }))).toBeNull();
    expect(jwtExpiry("not-a-token")).toBeNull();
  });
});

describe("the link in a confirmation or reset e-mail", () => {
  const token = jwt({ sub: "u-9", email: "o@x.th", exp: 1_900_000_000 });

  it("brings back a session, and says what the link was for", () => {
    expect(parseAuthFragment(`#access_token=${token}&refresh_token=rt&expires_in=3600&token_type=bearer&type=signup`)).toEqual({
      type: "signup",
      session: { accessToken: token, refreshToken: "rt", expiresAt: 1_900_000_000, userId: "u-9", email: "o@x.th" },
    });
    expect(parseAuthFragment(`#access_token=${token}&refresh_token=rt&type=recovery`)).toMatchObject({ type: "recovery" });
  });

  it("works out the expiry from expires_in when the token does not say", () => {
    const plain = jwt({ sub: "u" });
    expect(parseAuthFragment(`#access_token=${plain}&expires_in=3600&type=magiclink`, () => 1_000)).toMatchObject({ session: { expiresAt: 4_600 } });
  });

  it("reports a link that was old or already used", () => {
    expect(parseAuthFragment("#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired")).toEqual({ error: "Email link is invalid or has expired" });
  });

  it("is null for any other address", () => {
    expect(parseAuthFragment("")).toBeNull();
    expect(parseAuthFragment("#section-2")).toBeNull();
  });

  it("reads who a token is for", () => {
    expect(jwtIdentity(token)).toEqual({ userId: "u-9", email: "o@x.th" });
    expect(jwtIdentity("garbage")).toEqual({ userId: null, email: "" });
  });
});

describe("local auth (development)", () => {
  const cfg = (fetchImpl: typeof fetch) => createLocalAuth({ baseUrl: () => "http://api.test", fetchImpl });

  it("signs in with the e-mail alone and knows when the token runs out", async () => {
    const token = jwt({ sub: "u-1", exp: 1_900_000_000 });
    const fetchImpl = vi.fn(async () => json(200, { token, userId: "u-1" })) as unknown as typeof fetch;
    const auth = cfg(fetchImpl);
    expect(auth.usesPassword).toBe(false);
    const s = await auth.signIn({ email: "owner@sabai.dev", password: "" });
    expect(s).toEqual({ accessToken: token, refreshToken: null, expiresAt: 1_900_000_000, userId: "u-1", email: "owner@sabai.dev" });
    const [url, init] = (fetchImpl as any).mock.calls[0];
    expect(String(url)).toBe("http://api.test/v1/dev/login");
    expect(JSON.parse(init.body)).toEqual({ email: "owner@sabai.dev" });
  });

  it("renews by signing in again, and signing up is signing in", async () => {
    const fetchImpl = vi.fn(async () => json(200, { token: jwt({ exp: 2_000_000_000 }), userId: "u-1" })) as unknown as typeof fetch;
    const auth = cfg(fetchImpl);
    const up = await auth.signUp({ email: "new@x.dev", password: "" });
    expect("session" in up && up.session.email).toBe("new@x.dev");
    const again = await auth.refresh({ accessToken: "old", refreshToken: null, expiresAt: 1, userId: null, email: "new@x.dev" });
    expect(again.expiresAt).toBe(2_000_000_000);
  });

  it("says the line is down as the app's own error, and passes on a code the server gave", async () => {
    await expect(cfg((async () => Promise.reject(new TypeError("fetch failed"))) as typeof fetch).signIn({ email: "a@b.c", password: "" })).rejects.toMatchObject({ code: "NETWORK_OFFLINE" });
    await expect(cfg((async () => json(403, { error: { code: "PERMISSION_DENIED" } })) as unknown as typeof fetch).signIn({ email: "a@b.c", password: "" })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(cfg((async () => new Response("<html>bad gateway</html>", { status: 502 })) as unknown as typeof fetch).signIn({ email: "a@b.c", password: "" })).rejects.toMatchObject({ code: "INTERNAL" });
  });
});

describe("supabase auth (production)", () => {
  const URL_ = "https://abc.supabase.co/";
  const make = (fetchImpl: typeof fetch) => createSupabaseAuth({ url: URL_, anonKey: "anon-key", fetchImpl, now: () => 1_000 });
  const session = { access_token: "at", refresh_token: "rt", expires_at: 4_600, expires_in: 3600, user: { id: "u-1", email: "o@x.th" } };

  it("signs in with the password grant, sending the project's anon key", async () => {
    const fetchImpl = vi.fn(async () => json(200, session)) as unknown as typeof fetch;
    const s = await make(fetchImpl).signIn({ email: "o@x.th", password: "correct horse 42" });
    expect(s).toEqual({ accessToken: "at", refreshToken: "rt", expiresAt: 4_600, userId: "u-1", email: "o@x.th" });
    const [url, init] = (fetchImpl as any).mock.calls[0];
    expect(url).toBe("https://abc.supabase.co/auth/v1/token?grant_type=password");
    expect(init.headers.apikey).toBe("anon-key");
    expect(init.headers.authorization).toBeUndefined();
    expect(JSON.parse(init.body)).toEqual({ email: "o@x.th", password: "correct horse 42" });
  });

  it("works out the expiry from expires_in when expires_at is missing", async () => {
    const { expires_at: _, ...rest } = session;
    const s = await make((async () => json(200, rest)) as unknown as typeof fetch).signIn({ email: "o@x.th", password: "x" });
    expect(s.expiresAt).toBe(1_000 + 3600);
  });

  it("signs up: a session straight away, or a message that a confirmation e-mail was sent", async () => {
    expect(await make((async () => json(200, session)) as unknown as typeof fetch).signUp({ email: "o@x.th", password: "correct horse 42" })).toMatchObject({ session: { accessToken: "at" } });
    expect(await make((async () => json(200, { id: "u-2", email: "o@x.th", identities: [] })) as unknown as typeof fetch).signUp({ email: "o@x.th", password: "correct horse 42" })).toEqual({ confirmationSent: true });
  });

  it("renews with the refresh token, and takes the new one it is given", async () => {
    const fetchImpl = vi.fn(async () => json(200, { ...session, access_token: "at2", refresh_token: "rt2" })) as unknown as typeof fetch;
    const s = await make(fetchImpl).refresh({ accessToken: "at", refreshToken: "rt", expiresAt: 1, userId: "u-1", email: "o@x.th" });
    expect(s).toMatchObject({ accessToken: "at2", refreshToken: "rt2" });
    const [url, init] = (fetchImpl as any).mock.calls[0];
    expect(url).toBe("https://abc.supabase.co/auth/v1/token?grant_type=refresh_token");
    expect(JSON.parse(init.body)).toEqual({ refresh_token: "rt" });
  });

  it("cannot renew without a refresh token, or when Supabase refuses it: the person signs in again", async () => {
    await expect(make(vi.fn() as unknown as typeof fetch).refresh({ accessToken: "a", refreshToken: null, expiresAt: 1, userId: null, email: "e" })).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    for (const [status, body] of [
      [400, { error_code: "refresh_token_not_found", msg: "Invalid Refresh Token: Refresh Token Not Found" }],
      [400, { error: "invalid_grant", error_description: "Invalid Refresh Token: Already Used" }],
      [401, { msg: "bad" }],
    ] as const) {
      await expect(make((async () => json(status, body)) as unknown as typeof fetch).refresh({ accessToken: "a", refreshToken: "r", expiresAt: 1, userId: null, email: "e" })).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    }
  });

  it("signs out this device only, with the token, and does not care if that fails", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
    await make(fetchImpl).signOut({ accessToken: "at", refreshToken: "rt", expiresAt: 1, userId: null, email: "e" });
    const [url, init] = (fetchImpl as any).mock.calls[0];
    expect(url).toBe("https://abc.supabase.co/auth/v1/logout?scope=local");
    expect(init.headers.authorization).toBe("Bearer at");
    await expect(make((async () => Promise.reject(new TypeError("offline"))) as typeof fetch).signOut({ accessToken: "at", refreshToken: null, expiresAt: 1, userId: null, email: "e" })).resolves.toBeUndefined();
  });

  it("sets a new password for the session the reset link gave", async () => {
    const fetchImpl = vi.fn(async () => json(200, { id: "u-1" })) as unknown as typeof fetch;
    await make(fetchImpl).updatePassword!({ accessToken: "at", refreshToken: "rt", expiresAt: 1, userId: "u-1", email: "o@x.th" }, "brand new pw 42");
    const [url, init] = (fetchImpl as any).mock.calls[0];
    expect(url).toBe("https://abc.supabase.co/auth/v1/user");
    expect(init.method).toBe("PUT");
    expect(init.headers.authorization).toBe("Bearer at");
    expect(init.headers.apikey).toBe("anon-key");
    expect(JSON.parse(init.body)).toEqual({ password: "brand new pw 42" });
  });

  it("asks for a password-reset e-mail", async () => {
    const fetchImpl = vi.fn(async () => json(200, {})) as unknown as typeof fetch;
    await make(fetchImpl).resetPassword!("o@x.th");
    expect((fetchImpl as any).mock.calls[0][0]).toBe("https://abc.supabase.co/auth/v1/recover");
  });

  it("says the line is down as the app's own error", async () => {
    await expect(make((async () => Promise.reject(new TypeError("fetch failed"))) as typeof fetch).signIn({ email: "a@b.c", password: "x" })).rejects.toMatchObject({ code: "NETWORK_OFFLINE" });
  });
});

describe("what Supabase's refusals mean", () => {
  it.each([
    [400, { error_code: "invalid_credentials", msg: "Invalid login credentials" }, "AUTH_INVALID"],
    [400, { error: "invalid_grant", error_description: "Invalid login credentials" }, "AUTH_INVALID"],
    [422, { error_code: "user_already_exists", msg: "User already registered" }, "EMAIL_TAKEN"],
    [400, { msg: "User already registered" }, "EMAIL_TAKEN"],
    [422, { error_code: "weak_password", msg: "Password should be at least 8 characters" }, "WEAK_PASSWORD"],
    [400, { error_code: "email_not_confirmed", msg: "Email not confirmed" }, "EMAIL_NOT_CONFIRMED"],
    [429, { error_code: "over_request_rate_limit", msg: "slow down" }, "RATE_LIMITED"],
    [400, { error_code: "email_address_invalid", msg: "Email address is invalid" }, "VALIDATION"],
    [401, { msg: "invalid JWT" }, "AUTH_REQUIRED"],
    [500, { msg: "boom" }, "INTERNAL"],
    [502, null, "INTERNAL"],
  ])("%s %j → %s", (status, body, code) => {
    expect(mapSupabaseError(status, body).code).toBe(code);
  });
});

describe("keeping the account signed in", () => {
  const fresh = (over: Partial<AuthSession> = {}): AuthSession => ({ accessToken: "acc-1", refreshToken: "ref-1", expiresAt: Math.floor(Date.now() / 1000) + 3600, userId: "u-1", email: "o@x.th", ...over });
  let refresh: ReturnType<typeof vi.fn>;
  let provider: AuthProvider;

  beforeEach(() => {
    resetAccountForTests();
    clearApiSession();
    let n = 1;
    refresh = vi.fn(async (s: AuthSession) => {
      await new Promise((r) => setTimeout(r, 5));
      n++;
      return { ...s, accessToken: `acc-${n}`, refreshToken: `ref-${n}` };
    });
    provider = { kind: "supabase", usesPassword: true, signUp: vi.fn(), signIn: vi.fn(async () => fresh()), refresh, signOut: vi.fn(async () => undefined) } as unknown as AuthProvider;
    setAuthProviderForTests(provider);
    installAuthRenewer();
  });
  afterEach(() => {
    setSessionRenewer(null);
    setAuthProviderForTests(null);
    vi.unstubAllGlobals();
    resetAccountForTests();
    clearApiSession();
  });

  const startSession = (over: Partial<AuthSession> = {}) => {
    const s = fresh(over);
    setAccount(s);
    setApiSession({ token: s.accessToken, tenantId: "t-1" });
    return s;
  };

  it("sign-in stores the account and makes its token the one requests use", async () => {
    await signInAccount("o@x.th", "pw");
    expect(getAccount()).toMatchObject({ accessToken: "acc-1" });
    expect(getApiSession()).toMatchObject({ token: "acc-1", tenantId: null });
  });

  it("two renewals at the same moment share one request (a refresh token works once)", async () => {
    startSession();
    const [a, b] = await Promise.all([renewAccount(), renewAccount()]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(a).toBe("acc-2");
    expect(b).toBe("acc-2");
    expect(getAccount()).toMatchObject({ accessToken: "acc-2", refreshToken: "ref-2" });
    expect(getApiSession().token).toBe("acc-2");
  });

  it("does not swap a PIN-switched staff token for the account's when renewing", async () => {
    startSession();
    setApiSession({ token: "staff-token" });
    await renewAccount();
    expect(getApiSession().token).toBe("staff-token");
    expect(getAccount()!.accessToken).toBe("acc-2");
  });

  it("gives null, and keeps the account, when the session cannot be renewed", async () => {
    startSession();
    refresh.mockRejectedValueOnce(Object.assign(new Error("refused"), { code: "AUTH_REQUIRED" }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await renewAccount()).toBeNull();
    warn.mockRestore();
    expect(getAccount()!.accessToken).toBe("acc-1");
  });

  it("renews before a request when the token is about to run out, and sends the new one", async () => {
    startSession({ expiresAt: Math.floor(Date.now() / 1000) + 20 });
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: URL, init: any) => {
      seen.push(init.headers.Authorization);
      return json(200, { ok: true });
    }));
    await apiFetch("/v1/me");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(seen).toEqual(["Bearer acc-2"]);
  });

  it("leaves a token with time left alone", async () => {
    startSession();
    vi.stubGlobal("fetch", vi.fn(async () => json(200, {})));
    await apiFetch("/v1/me");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("on a 401 renews once and sends the same request again — same idempotency key, new token", async () => {
    startSession();
    const calls: { auth: string; key: string }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: URL, init: any) => {
      calls.push({ auth: init.headers.Authorization, key: init.headers["Idempotency-Key"] });
      return calls.length === 1 ? json(401, { error: { code: "AUTH_REQUIRED" } }) : json(200, { id: "o-1" });
    }));
    expect(await apiFetch("/v1/orders", { method: "POST", body: { a: 1 } })).toEqual({ id: "o-1" });
    expect(calls.map((c) => c.auth)).toEqual(["Bearer acc-1", "Bearer acc-2"]);
    expect(calls[0]!.key).toBe(calls[1]!.key);
  });

  it("does not loop: a second 401 after renewing is the answer", async () => {
    startSession();
    const fetchMock = vi.fn(async () => json(401, { error: { code: "AUTH_REQUIRED" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(apiFetch("/v1/me")).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("when renewing fails, the 401 is the answer straight away", async () => {
    startSession();
    refresh.mockRejectedValue(new Error("refused"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchMock = vi.fn(async () => json(401, { error: { code: "AUTH_REQUIRED" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(apiFetch("/v1/me")).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    warn.mockRestore();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never tries to renew a staff token: that one is replaced by a PIN", async () => {
    startSession();
    setApiSession({ token: "staff-token" });
    vi.stubGlobal("fetch", vi.fn(async () => json(401, { error: { code: "AUTH_REQUIRED" } })));
    await expect(apiFetch("/v1/me")).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    expect(refresh).not.toHaveBeenCalled();
  });

  describe("when the server ends a session", () => {
    it("a staff member's ends: the account behind the till is still signed in, so it goes back to choosing who is here", async () => {
      startSession();
      setApiSession({ token: "staff-token" });
      expect(await recoverFromUnauthorized()).toBe("account");
      expect(getApiSession()).toMatchObject({ token: "acc-1", tenantId: "t-1" });
      expect(refresh).not.toHaveBeenCalled(); // the account token still has time
      expect(getAccount()).not.toBeNull();
    });

    it("…renewing the account first if its own token has run out meanwhile", async () => {
      startSession({ expiresAt: Math.floor(Date.now() / 1000) - 5 });
      setApiSession({ token: "staff-token" });
      expect(await recoverFromUnauthorized()).toBe("account");
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(getApiSession().token).toBe("acc-2");
    });

    it("…and signing everyone out if it cannot be renewed", async () => {
      startSession({ expiresAt: Math.floor(Date.now() / 1000) - 5 });
      setApiSession({ token: "staff-token" });
      refresh.mockRejectedValue(new Error("refused"));
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      expect(await recoverFromUnauthorized()).toBe("none");
      warn.mockRestore();
      expect(getAccount()).toBeNull();
      expect(getApiSession()).toEqual({ token: null, tenantId: null });
    });

    it("the account's own token ended: nothing to fall back on, the device signs out", async () => {
      startSession();
      expect(await recoverFromUnauthorized()).toBe("none");
      expect(getAccount()).toBeNull();
      expect(provider.signOut).toHaveBeenCalled();
    });
  });

  it("signing out tells the provider and forgets every token", async () => {
    startSession();
    await signOutAccount();
    expect(provider.signOut).toHaveBeenCalledWith(expect.objectContaining({ accessToken: "acc-1" }));
    expect(getAccount()).toBeNull();
    expect(getApiSession()).toEqual({ token: null, tenantId: null });
  });
});
