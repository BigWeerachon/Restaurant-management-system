/** Purchasing commands for the API adapter: order stock from a supplier and move the order along. */
import { addDays } from "@sabai/domain";
import { DomainError, currentBusinessDate, memberCan } from "../demo/engine";
import { useSabai } from "../demo/store";
import { apiFetch } from "./http-client";
import { baht, currentBranchId, refresh } from "./http-context";
import { newClientId } from "./ids";
import type { DataSource } from "./types";

/** The order as the reloaded store holds it; it must be there, or the caller would be handed something made up. */
function savedOrder(id: string) {
  const po = useSabai.getState().db.purchaseOrders.find((p) => p.id === id);
  if (!po) throw new DomainError("INTERNAL", { feature: "purchase order: not in the reloaded list" });
  return po;
}

export const purchasingCommands = {
  async createPurchaseOrder(supplierId, lines) {
    const { db, session } = useSabai.getState();
    const branchId = currentBranchId();
    const wanted = lines.filter((l) => l.qtyPacks > 0);
    if (wanted.length === 0) throw new DomainError("LINES_REQUIRED");
    const supplier = db.suppliers.find((s) => s.id === supplierId);
    const id = newClientId("po");
    await apiFetch("/v1/purchase-orders", {
      method: "POST",
      body: {
        id,
        branchId,
        supplierId,
        expectedDate: addDays(currentBusinessDate(db, branchId, new Date()), supplier?.leadTimeDays ?? 1),
        // Priced at the pack the ingredient is usually bought in, like the demo does.
        lines: wanted.map((l) => {
          const ing = db.ingredients.find((i) => i.id === l.ingredientId);
          if (!ing) throw new DomainError("NOT_FOUND", { entity: "ingredient" });
          return { ingredientId: ing.id, packName: ing.pack?.name ?? ing.baseUnit, packQty: ing.pack?.qty ?? 1, qtyPacks: l.qtyPacks, unitPrice: baht(ing.pack?.price ?? 0) };
        }),
      },
    });
    // Whoever may approve orders does not need a second step for their own: same as the demo.
    if (memberCan(db, session.memberId, "purchasing.approve", branchId)) {
      try {
        await apiFetch(`/v1/purchase-orders/${id}/status`, { method: "POST", body: { status: "approved" } });
      } catch (e) {
        // The order exists and waits for approval; approving it is one tap on the list.
        console.warn("could not approve the new purchase order", e);
      }
    }
    await refresh(["purchasing"]);
    return savedOrder(id);
  },

  async createPOFromSuggestions(branchId, supplierId, ingredientIds) {
    const r = await apiFetch<{ id: string }>("/v1/purchase-orders/from-suggestions", { method: "POST", body: { branchId, supplierId, ingredientIds } });
    await refresh(["purchasing"]);
    return savedOrder(r.id);
  },

  async setPurchaseOrderStatus(poId, status) {
    await apiFetch(`/v1/purchase-orders/${poId}/status`, { method: "POST", body: { status } });
    await refresh(["purchasing"]);
  },
} satisfies Partial<DataSource>;
