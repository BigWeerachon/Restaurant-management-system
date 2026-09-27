/**
 * Recipe (BOM) costing and explosion. Mirrors app.ingredient_unit_cost(),
 * app.menu_item_cost() and app.explode_recipe().
 *
 * Costs are THB per base unit as plain numbers (sub-satang precision, e.g.
 * coffee at ฿0.45/g). They are rounded to satang only when shown or summed
 * into money documents.
 */
export type IngredientKind = "raw" | "prep" | "packaging" | "merchandise";

export interface CostIngredient {
  id: string;
  name: string;
  kind: IngredientKind;
  trackStock: boolean;
  /** Current cost per base unit (avg → last → standard); ignored for untracked preps. */
  unitCost: number;
}

export interface RecipeLine {
  ingredientId: string;
  /** Base units per recipe yield. Negative only on modifier recipes (substitutions). */
  qty: number;
  /** Trim / cooking loss, 0–0.95. */
  wasteRate?: number;
}

export interface Recipe {
  yieldQty: number;
  lines: RecipeLine[];
}

export interface RecipeBook {
  ingredients: ReadonlyMap<string, CostIngredient>;
  /** Current prep recipe per output ingredient id. */
  prepRecipes: ReadonlyMap<string, Recipe>;
}

export class RecipeCycleError extends Error {
  readonly code = "RECIPE_CYCLE";
  constructor(readonly path: string[]) {
    super(`Recipe cycle: ${path.join(" → ")}`);
  }
}

const MAX_DEPTH = 10;

function isExpandablePrep(ing: CostIngredient | undefined, book: RecipeBook): boolean {
  return !!ing && ing.kind === "prep" && !ing.trackStock && book.prepRecipes.has(ing.id);
}

/** Cost per base unit, rolling untracked preps up from their recipes. */
export function ingredientUnitCost(id: string, book: RecipeBook, path: string[] = []): number {
  if (path.includes(id) || path.length > MAX_DEPTH) throw new RecipeCycleError([...path, id]);
  const ing = book.ingredients.get(id);
  if (!ing) return 0;
  if (isExpandablePrep(ing, book)) {
    const r = book.prepRecipes.get(id)!;
    const total = r.lines.reduce(
      (sum, l) => sum + l.qty * (1 + (l.wasteRate ?? 0)) * ingredientUnitCost(l.ingredientId, book, [...path, id]),
      0,
    );
    return round6(total / r.yieldQty);
  }
  return ing.unitCost;
}

export interface CostBreakdownLine {
  ingredientId: string;
  name: string;
  qty: number;
  unitCost: number;
  cost: number;
  /** Share of the dish cost, 0–1 — drives the "what makes this dish expensive" bar. */
  share: number;
}

export interface CostBreakdown {
  cost: number;
  lines: CostBreakdownLine[];
}

/** Cost of one yield unit (one portion for menu recipes) with a per-line breakdown. */
export function costRecipe(recipe: Recipe, book: RecipeBook): CostBreakdown {
  const lines = recipe.lines.map((l) => {
    const unitCost = ingredientUnitCost(l.ingredientId, book);
    const qty = (l.qty * (1 + (l.wasteRate ?? 0))) / recipe.yieldQty;
    return {
      ingredientId: l.ingredientId,
      name: book.ingredients.get(l.ingredientId)?.name ?? "—",
      qty: round4(qty),
      unitCost,
      cost: round4(qty * unitCost),
      share: 0,
    };
  });
  const cost = round4(lines.reduce((s, l) => s + l.cost, 0));
  for (const l of lines) l.share = cost > 0 ? l.cost / cost : 0;
  lines.sort((a, b) => b.cost - a.cost);
  return { cost, lines };
}

/** Portion cost of a menu item with the chosen modifier recipes added on top. */
export function menuItemCost(base: Recipe | undefined, modifiers: Recipe[], book: RecipeBook): number {
  const parts = [base, ...modifiers].filter((r): r is Recipe => !!r);
  return round4(parts.reduce((s, r) => s + costRecipe(r, book).cost, 0));
}

/** Leaf ingredients (stock-tracked) and quantities consumed by `multiplier` yields. */
export function explodeRecipe(recipe: Recipe, multiplier: number, book: RecipeBook): Map<string, number> {
  const out = new Map<string, number>();
  const walk = (r: Recipe, mult: number, path: string[]) => {
    for (const l of r.lines) {
      const qty = (mult * l.qty * (1 + (l.wasteRate ?? 0))) / r.yieldQty;
      const ing = book.ingredients.get(l.ingredientId);
      if (isExpandablePrep(ing, book)) {
        if (path.includes(l.ingredientId) || path.length > MAX_DEPTH) {
          throw new RecipeCycleError([...path, l.ingredientId]);
        }
        walk(book.prepRecipes.get(l.ingredientId)!, qty, [...path, l.ingredientId]);
      } else if (ing?.trackStock !== false) {
        out.set(l.ingredientId, round4((out.get(l.ingredientId) ?? 0) + qty));
      }
    }
  };
  walk(recipe, multiplier, []);
  for (const [k, v] of out) if (v === 0) out.delete(k);
  return out;
}

/** Would adding `componentId` to the prep recipe of `outputId` create a loop? */
export function wouldCreateCycle(outputId: string, componentId: string, book: RecipeBook): boolean {
  if (outputId === componentId) return true;
  const stack = [componentId];
  const seen = new Set<string>();
  while (stack.length) {
    const id = stack.pop()!;
    if (id === outputId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    const r = book.prepRecipes.get(id);
    if (r) stack.push(...r.lines.map((l) => l.ingredientId));
  }
  return false;
}

/** Price excluding VAT (what food cost % is measured against). */
export function priceExVat(price: number, vatRate: number, pricesIncludeVat: boolean): number {
  return pricesIncludeVat && vatRate > 0 ? price / (1 + vatRate) : price;
}

export function foodCostPct(cost: number, price: number, vatRate = 0, pricesIncludeVat = true): number {
  const net = priceExVat(price, vatRate, pricesIncludeVat);
  return net > 0 ? cost / net : 0;
}

export type MarginHealth = "great" | "ok" | "watch" | "high";

/** Industry rule of thumb for Thai cafés/restaurants: 25–35 % food cost is healthy. */
export function marginHealth(costPct: number): MarginHealth {
  if (costPct <= 0.28) return "great";
  if (costPct <= 0.35) return "ok";
  if (costPct <= 0.42) return "watch";
  return "high";
}

/**
 * Smart default for "ราคาขายแนะนำ": the price that hits a target food cost,
 * rounded up to a price people are used to seeing (…0 / …5 baht).
 */
export function suggestPrice(cost: number, targetPct = 0.3, vatRate = 0, pricesIncludeVat = true): number {
  if (cost <= 0) return 0;
  let price = cost / targetPct;
  if (pricesIncludeVat && vatRate > 0) price *= 1 + vatRate;
  const step = price < 100 ? 5 : 10;
  return Math.ceil(price / step) * step;
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
