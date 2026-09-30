import { menuItemCost } from "@sabai/domain";
import { recipeBook } from "./engine";
import type { DemoState, MenuItem } from "./types";

/** Portion cost of the standard version of a menu item (THB). */
export function menuItemCostOf(db: DemoState, item: MenuItem, branchId?: string): number {
  return menuItemCost(item.recipe, [], recipeBook(db, branchId));
}
