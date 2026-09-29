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

export interface NewShop {
  name: string;
  businessType: string;
  branchName?: string;
  ownerName: string;
  vatRegistered: boolean;
  pricesIncludeVat: boolean;
}

/**
 * Creates the account's first shop and opens it. The key stays the same for the same details, so trying again after a
 * lost answer does not make a second shop.
 */
export async function createShop(input: NewShop, idempotencyKey: string): Promise<string> {
  const r = await apiFetch<{ tenant_id: string }>("/v1/tenants", { method: "POST", body: input, tenant: false, idempotencyKey });
  await openShop(r.tenant_id);
  return r.tenant_id;
}
