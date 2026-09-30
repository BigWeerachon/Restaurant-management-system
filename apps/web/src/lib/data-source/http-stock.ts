/** Stock commands for the API adapter: receiving, waste, counts, new ingredients. */
import { summarizeCount, toSatang } from "@sabai/domain";
import { DomainError } from "../demo/engine";
import { useSabai } from "../demo/store";
import { apiFetch } from "./http-client";
import { baht, currentBranchId, refresh, refreshShop } from "./http-context";
import type { DataSource } from "./types";

/** The branch's default stock location — the API needs one to record waste and start a count. */
function stockLocationId(): string {
  const { db } = useSabai.getState();
  const id = db.branches.find((b) => b.id === currentBranchId())?.stockLocationId;
  if (!id) throw new DomainError("NOT_FOUND", { entity: "location" });
  return id;
}

export const stockCommands = {
  async receiveGoods(input) {
    const { db } = useSabai.getState();
    // Same rule as the database: a unit cost more than 5% above the last one is worth telling the owner about.
    const priceAlerts: { ingredientId: string; oldCost: number; newCost: number; pct: number }[] = [];
    for (const l of input.lines) {
      const ing = db.ingredients.find((i) => i.id === l.ingredientId);
      const old = ing?.lastCost ?? ing?.standardCost ?? 0;
      const unitCost = l.packQty > 0 ? l.unitPrice / 100 / l.packQty : 0;
      if (ing && old > 0 && unitCost > old * 1.05) priceAlerts.push({ ingredientId: ing.id, oldCost: old, newCost: unitCost, pct: Math.round((unitCost / old - 1) * 1000) / 10 });
    }
    // Receiving against an order names the order's line each row belongs to, so the order can tell what has arrived.
    const po = input.poId ? db.purchaseOrders.find((p) => p.id === input.poId) : undefined;
    const poLineId = (ingredientId: string, packName: string) => (po?.lines.find((pl) => pl.ingredientId === ingredientId && pl.packName === packName) ?? po?.lines.find((pl) => pl.ingredientId === ingredientId))?.id;
    const r = await apiFetch<{ id: string; grNo: string; total: string }>("/v1/receipts", {
      method: "POST",
      body: {
        branchId: currentBranchId(),
        supplierId: input.supplierId,
        poId: input.poId,
        paymentMode: input.paymentMode,
        lines: input.lines.filter((l) => l.qtyPacks > 0).map((l) => ({ ingredientId: l.ingredientId, packName: l.packName, packQty: l.packQty, qtyPacks: l.qtyPacks, unitPrice: baht(l.unitPrice), poLineId: poLineId(l.ingredientId, l.packName) })),
      },
    });
    // Receiving changes what things cost (and the supplier's usual pack), so the shop's own data is reloaded too.
    await Promise.all([refresh(["stock", "purchasing", "finance"]), refreshShop()]);
    return { id: r.id, grNo: r.grNo, total: toSatang(r.total), priceAlerts };
  },

  async recordWaste(ingredientId, qty, reasonCode, note) {
    const { db } = useSabai.getState();
    const ing = db.ingredients.find((i) => i.id === ingredientId);
    const avg = db.balances[`${currentBranchId()}:${ingredientId}`]?.avgCost;
    const r = await apiFetch<{ id: string }>("/v1/waste", { method: "POST", body: { locationId: stockLocationId(), ingredientId, qty, reason: reasonCode, note } });
    await refresh(["stock"]);
    // The value written off, as the database booked it if the reload brought the movement back, else from the cost we knew.
    const booked = useSabai.getState().db.movements.find((m) => m.id === r.id);
    return booked ? Math.abs(booked.qty * booked.unitCost) : qty * (avg || ing?.lastCost || ing?.standardCost || 0);
  },

  async startCount() {
    const r = await apiFetch<{ id: string }>("/v1/stock-counts", { method: "POST", body: { locationId: stockLocationId(), scope: "full", blind: true } });
    await refresh(["counts"]);
    return r.id;
  },

  async recordCount(countId, ingredientId, counted) {
    await apiFetch(`/v1/stock-counts/${countId}/lines`, { method: "PUT", body: { ingredientId, counted } });
    await refresh(["counts"]);
  },

  async submitCount(countId) {
    await apiFetch(`/v1/stock-counts/${countId}/submit`, { method: "POST" });
    await refresh(["counts"]);
  },

  async approveCount(countId) {
    // The value of the difference, worked out the same way the count screen shows it before approving.
    const count = useSabai.getState().db.counts.find((c) => c.id === countId);
    const value = count
      ? summarizeCount(count.lines.map((l) => ({ ingredientId: l.ingredientId, name: "", expected: l.expected ?? 0, counted: l.counted, unitCost: l.unitCost ?? 0 }))).varianceValue
      : 0;
    const r = await apiFetch<{ adjustedLines: number }>(`/v1/stock-counts/${countId}/approve`, { method: "POST" });
    await refresh(["stock", "counts"]);
    return { adjusted: r.adjustedLines, value };
  },

  async addIngredient(input) {
    const r = await apiFetch<{ id: string }>("/v1/ingredients", {
      method: "POST",
      body: {
        name: input.name.trim(),
        emoji: input.emoji,
        baseUnit: input.baseUnit,
        displayUnit: input.displayUnit,
        categoryName: input.category.trim() || undefined,
        pack: input.pack ? { name: input.pack.name, qty: input.pack.qty, price: baht(input.pack.price), supplierId: input.pack.supplierId } : undefined,
        reorderPoint: input.reorderPoint,
        parLevel: input.parLevel,
        storageZone: input.zone,
        openingQty: input.openingQty,
        branchId: input.openingQty ? currentBranchId() : undefined,
      },
    });
    await Promise.all([refreshShop(), refresh(["stock"])]);
    const created = useSabai.getState().db.ingredients.find((i) => i.id === r.id);
    if (!created) throw new DomainError("INTERNAL", { feature: "addIngredient: not in the reloaded shop" });
    return created;
  },
} satisfies Partial<DataSource>;
