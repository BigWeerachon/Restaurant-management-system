/** Settings commands for the API adapter: the business, its branches, sales channels, ways to be paid, and the plan. */
import { DomainError, currentBusinessDate } from "../demo/engine";
import { useSabai } from "../demo/store";
import { apiFetch } from "./http-client";
import { currentBranchId, refresh } from "./http-context";
import type { DataSource } from "./types";

/** A short code for a new branch (the database wants 2–8 letters or digits): BR2, BR3, ... the first one nobody has. */
function nextBranchCode(): string {
  const taken = new Set(useSabai.getState().db.branches.map((b) => b.code?.toUpperCase()));
  for (let n = taken.size + 1; ; n++) if (!taken.has(`BR${n}`)) return `BR${n}`;
}

/** A rate that starts today lets bills from earlier days keep the rate they were made under. */
function today(): string {
  return currentBusinessDate(useSabai.getState().db, currentBranchId(), new Date());
}

async function setCommission(id: string, rate: number, validFrom: string, note?: string) {
  await apiFetch(`/v1/channels/${id}/commission-rate`, { method: "POST", body: { rate, validFrom, note } });
}

export const settingsCommands = {
  async updateTenant(patch) {
    const body: Record<string, unknown> = {};
    if (patch.name !== undefined) body.name = patch.name.trim();
    if (patch.businessType !== undefined) body.businessType = patch.businessType;
    if (patch.vatRegistered !== undefined) body.vatRegistered = patch.vatRegistered;
    if (patch.pricesIncludeVat !== undefined) body.pricesIncludeVat = patch.pricesIncludeVat;
    if (patch.cashRounding !== undefined) body.cashRounding = patch.cashRounding;
    if (Object.keys(body).length === 0) return;
    await apiFetch("/v1/tenant", { method: "PATCH", body });
    await refresh(["settings"]);
  },

  async addBranch(input) {
    const r = await apiFetch<{ id: string }>("/v1/branches", {
      method: "POST",
      body: { code: nextBranchCode(), name: input.name.trim(), address: input.address?.trim() || undefined, phone: input.phone?.trim() || undefined },
    });
    await refresh(["settings"]);
    const created = useSabai.getState().db.branches.find((b) => b.id === r.id);
    if (!created) throw new DomainError("INTERNAL", { feature: "addBranch: not in the reloaded shop" });
    return created;
  },

  async updateBranch(id, patch) {
    const body: Record<string, unknown> = {};
    if (patch.name !== undefined) body.name = patch.name.trim();
    if (patch.address !== undefined) body.address = patch.address;
    if (patch.phone !== undefined) body.phone = patch.phone;
    if (patch.openingHours !== undefined) body.openingHours = patch.openingHours;
    if (patch.dayCutoff !== undefined) body.dayCutoff = patch.dayCutoff;
    if (patch.serviceChargeRate !== undefined) body.serviceChargeRate = patch.serviceChargeRate;
    if (Object.keys(body).length === 0) return;
    await apiFetch(`/v1/branches/${id}`, { method: "PATCH", body });
    await refresh(["settings"]);
  },

  async updateChannel(id, patch) {
    const channel = useSabai.getState().db.channels.find((c) => c.id === id);
    const body: Record<string, unknown> = {};
    if (patch.name !== undefined) body.name = patch.name.trim();
    if (patch.color !== undefined) body.color = patch.color;
    if (patch.active !== undefined) body.active = patch.active;
    if (patch.appliesServiceCharge !== undefined) body.appliesServiceCharge = patch.appliesServiceCharge;
    // A markup or GP that is not different is not a change (the screen sends both together).
    if (patch.priceMarkup !== undefined && patch.priceMarkup !== channel?.priceMarkup) body.priceMarkup = patch.priceMarkup;
    if (Object.keys(body).length > 0) await apiFetch(`/v1/channels/${id}`, { method: "PATCH", body });
    // (A GP that is the same would only add a row to the rate history.)
    if (patch.commissionRate !== undefined && patch.commissionRate !== channel?.commissionRate) await setCommission(id, patch.commissionRate, today());
    await refresh(["settings"]);
  },

  async setChannelCommission(id, rate, validFrom, note) {
    await setCommission(id, rate, validFrom, note);
    await refresh(["settings"]);
  },

  async updatePaymentMethod(id, patch) {
    const body: Record<string, unknown> = {};
    if (patch.active !== undefined) body.active = patch.active;
    if (patch.promptpayId !== undefined) body.promptpayId = patch.promptpayId;
    if (patch.feeRate !== undefined) body.feeRate = patch.feeRate;
    if (Object.keys(body).length === 0) return;
    await apiFetch(`/v1/payment-methods/${id}`, { method: "PATCH", body });
    await refresh(["settings"]);
  },

  async skipOnboardingStep(key) {
    await apiFetch("/v1/onboarding/skip", { method: "POST", body: { step: key } });
    await refresh(["onboarding"]);
  },

  async confirmCashOnly() {
    await apiFetch("/v1/settings/payments/confirm-cash-only", { method: "POST" });
    // Whether payments count as set up is part of the shop's own data and of the checklist.
    await refresh(["settings", "onboarding"]);
  },

  async changePlan(plan) {
    await apiFetch("/v1/settings/plan", { method: "POST", body: { planCode: plan } });
    await refresh(["settings"]);
  },
} satisfies Partial<DataSource>;
