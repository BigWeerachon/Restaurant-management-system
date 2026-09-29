/**
 * "Connect to a real shop" steps for the welcome page: sign in the account (see `lib/auth`), list its shops, open one.
 */
import { apiFetch, setApiSession } from "./http-client";
import { loadShop } from "./http-data-source";

export interface ShopChoice {
  tenantId: string;
  tenantName: string;
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
