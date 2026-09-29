/**
 * The signed-in account on this device, and keeping it signed in.
 *
 * Two different things are stored:
 *   - the **account session** (this file): the owner/manager's own sign-in, renewable;
 *   - the **API session** (`data-source/http-client.ts`): whichever token requests are sent with right now — the
 *     account's token, or a staff token after a PIN switch. A staff token is not renewable: it is replaced by
 *     entering a PIN again.
 */
import { getApiSession, setApiSession, clearApiSession, setSessionRenewer } from "../data-source/http-client";
import { getAuthProvider } from "./index";
import type { AuthSession } from "./types";

const KEY = "sabai-account";
/** Renew this many seconds before the token runs out, so a request never leaves with one that dies on the way. */
const RENEW_BEFORE_S = 60;

let account: AuthSession | null | undefined;

function read(): AuthSession | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as AuthSession) : null;
  } catch {
    return null;
  }
}

export function getAccount(): AuthSession | null {
  if (account === undefined) account = read();
  return account;
}

export function setAccount(next: AuthSession | null) {
  account = next;
  if (typeof localStorage === "undefined") return;
  try {
    if (next) localStorage.setItem(KEY, JSON.stringify(next));
    else localStorage.removeItem(KEY);
  } catch {
    // Private browsing / storage disabled: the account simply will not survive a reload.
  }
}

const nowS = () => Math.floor(Date.now() / 1000);

export const isAccountToken = (token: string | null | undefined): boolean => !!token && getAccount()?.accessToken === token;

let renewing: Promise<string | null> | null = null;

/**
 * A fresh account token, or null when the person has to sign in again. Callers that ask at the same moment share one
 * request — a refresh token can be used once, so two at a time would sign the person out.
 */
export function renewAccount(): Promise<string | null> {
  renewing ??= (async () => {
    const current = getAccount();
    if (!current) return null;
    try {
      const next = await getAuthProvider().refresh(current);
      setAccount(next);
      // If requests were going out with the account's own token, they go out with the new one from now on.
      if (getApiSession().token === current.accessToken) setApiSession({ token: next.accessToken });
      return next.accessToken;
    } catch (e) {
      console.warn("session could not be renewed", e);
      return null;
    }
  })().finally(() => {
    renewing = null;
  });
  return renewing;
}

/** Wires renewal into the HTTP client. Call once when the app starts. */
export function installAuthRenewer() {
  setSessionRenewer({
    canRenew: (token) => isAccountToken(token),
    shouldRenew: (token) => {
      const a = getAccount();
      return !!a && a.accessToken === token && a.expiresAt !== null && a.expiresAt - nowS() < RENEW_BEFORE_S;
    },
    renew: renewAccount,
  });
}

/** Signs in with the provider and makes the account's token the one requests use. */
export async function signInAccount(email: string, password: string): Promise<AuthSession> {
  const session = await getAuthProvider().signIn({ email, password });
  startAccountSession(session);
  return session;
}

export function startAccountSession(session: AuthSession) {
  setAccount(session);
  setApiSession({ token: session.accessToken, tenantId: null });
}

/** Ends this device's sign-in: tells the provider (best effort), forgets the account and every token. */
export async function signOutAccount(): Promise<void> {
  const current = getAccount();
  setAccount(null);
  clearApiSession();
  if (current) await getAuthProvider().signOut(current);
}

/**
 * The server refused the token in use and it could not be renewed. What happens next depends on whose token it was:
 *  - a staff member's (PIN sessions end after some hours): the account behind this device is still signed in, so the
 *    till goes back to "who is here?" — `"account"`;
 *  - the account's own: nothing is left to fall back on, so the device signs out — `"none"`.
 */
export async function recoverFromUnauthorized(): Promise<"account" | "none"> {
  const acc = getAccount();
  const active = getApiSession().token;
  if (acc && active && active !== acc.accessToken) {
    const valid = acc.expiresAt === null || acc.expiresAt - nowS() > RENEW_BEFORE_S;
    const token = valid ? acc.accessToken : await renewAccount();
    if (token) {
      setApiSession({ token });
      return "account";
    }
  }
  await signOutAccount();
  return "none";
}

/** For tests. */
export function resetAccountForTests() {
  account = undefined;
  renewing = null;
  if (typeof localStorage !== "undefined") localStorage.removeItem(KEY);
}
