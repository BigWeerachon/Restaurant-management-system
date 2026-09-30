/** Menu commands for the API adapter: add an item, change its price or recipe. */
import type { Recipe } from "@sabai/domain";
import { DomainError } from "../demo/engine";
import { useSabai } from "../demo/store";
import { apiFetch } from "./http-client";
import { baht, refreshShop } from "./http-context";
import type { DataSource } from "./types";

const recipeBody = (recipe: Recipe) => recipe.lines.map((l) => ({ ingredientId: l.ingredientId, qty: l.qty, wasteRate: l.wasteRate ?? 0 }));

// The shop is the source of truth for menu items, so every change is followed by a reload (best effort: the
// change is already saved) and, when the caller needs the item, read back from it.

export const menuCommands = {
  async addMenuItem(input) {
    const r = await apiFetch<{ id: string }>("/v1/menu-items", {
      method: "POST",
      body: {
        name: input.name.trim(),
        emoji: input.emoji,
        price: baht(input.price),
        kitchenRoute: input.route,
        categoryId: input.categoryId,
        // A new category takes the item's picture, like the demo does.
        categoryName: input.categoryId ? undefined : input.categoryName?.trim() || undefined,
        recipe: input.recipe?.lines.length ? recipeBody(input.recipe) : undefined,
      },
    });
    await refreshShop();
    const created = useSabai.getState().db.menuItems.find((m) => m.id === r.id);
    if (!created) throw new DomainError("INTERNAL", { feature: "addMenuItem: not in the reloaded shop" });
    return created;
  },

  async updateMenuItem(id, patch) {
    const body: Record<string, unknown> = {};
    if (patch.price !== undefined) body.price = baht(patch.price);
    if (patch.name !== undefined) body.name = patch.name.trim();
    if (patch.emoji !== undefined) body.emoji = patch.emoji;
    if (patch.active !== undefined) body.active = patch.active;
    // A recipe key that is present but empty means "no recipe any more"; an absent key leaves it as it is.
    if ("recipe" in patch) body.recipe = patch.recipe ? recipeBody(patch.recipe) : [];
    if (Object.keys(body).length === 0) return;
    await apiFetch(`/v1/menu-items/${id}`, { method: "PATCH", body });
    await refreshShop();
  },
} satisfies Partial<DataSource>;
