/**
 * "Connect to a real shop" steps for the welcome page. Until real sign-in
 * lands (checklist phase 6) the only way in is the API's development login,
 * which the API does not expose in production.
 */
import { apiFetch, setApiSession } from "./http-client";
import { loadShop } from "./http-data-source";

export interface ShopChoice {
  tenantId: string;
  tenantName: string;
}

export async function devLogin(email: string): Promise<void> {
  const r = await apiFetch<{ token: string }>("/v1/dev/login", { method: "POST", body: { email }, tenant: false });
  setApiSession({ token: r.token, tenantId: null });
}

export async function listShops(): Promise<ShopChoice[]> {
  const me = await apiFetch<{ memberships: { tenantId: string; tenantName: string }[] }>("/v1/me", { tenant: false });
  const seen = new Map<string, ShopChoice>();
  for (const m of me.memberships) seen.set(m.tenantId, { tenantId: m.tenantId, tenantName: m.tenantName });
  return [...seen.values()];
}

export async function openShop(tenantId: string): Promise<void> {
  setApiSession({ tenantId });
  await loadShop({ reset: true });
}
