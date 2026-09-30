import { apiBaseUrl } from "../data-source/http-client";
import { createLocalAuth } from "./local";
import { createSupabaseAuth } from "./supabase";
import type { AuthProvider } from "./types";

export type { AuthProvider, AuthSession, Credentials, SignUpResult } from "./types";

/**
 * Which sign-in the app uses. `NEXT_PUBLIC_AUTH_PROVIDER` says so outright; without it, a Supabase project in the
 * environment means Supabase, and nothing means the local dev login. (The names are spelled out so Next can inline them.)
 */
export function authKind(override?: { provider?: string; url?: string; anonKey?: string }): "local" | "supabase" {
  const provider = override ? override.provider : process.env.NEXT_PUBLIC_AUTH_PROVIDER;
  const url = override ? override.url : process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = override ? override.anonKey : process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (provider === "local" || provider === "supabase") return provider;
  return url && anonKey ? "supabase" : "local";
}

let provider: AuthProvider | null = null;

export function getAuthProvider(): AuthProvider {
  if (provider) return provider;
  if (authKind() === "supabase") {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) throw new Error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are needed for the supabase auth provider");
    provider = createSupabaseAuth({ url, anonKey });
  } else {
    provider = createLocalAuth({ baseUrl: apiBaseUrl });
  }
  return provider;
}

/** Tests choose the provider directly. */
export function setAuthProviderForTests(next: AuthProvider | null) {
  provider = next;
}
