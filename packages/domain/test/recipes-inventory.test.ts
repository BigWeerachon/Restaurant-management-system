import { describe, expect, it } from "vitest";
import {
  applyMovement,
  convert,
  costRecipe,
  explodeRecipe,
  foodCostPct,
  formatQty,
  ingredientUnitCost,
  marginHealth,
  menuItemCost,
  RecipeCycleError,
  reorderSuggestion,
  stockStatus,
  suggestPrice,
  summarizeCount,
  toBase,
  usageVariance,
  wouldCreateCycle,
  type CostIngredient,
  type Recipe,
  type RecipeBook,
} from "../src";

const ing = (id: string, unitCost: number, extra: Partial<CostIngredient> = {}): CostIngredient => ({
  id,
  name: id,
  kind: "raw",
  trackStock: true,
  unitCost,
  ...extra,
});

// Same café as the SQL end-to-end test.
const book: RecipeBook = {
  ingredients: new Map([
    ["coffee", ing("coffee", 0.45)],
    ["milk", ing("milk", 0.045)],
    ["oat", ing("oat", 0.12)],
    ["sugar", ing("sugar", 0.03)],
    ["syrup", ing("syrup", 0, { kind: "prep", trackStock: false })],
  ]),
  prepRecipes: new Map([["syrup", { yieldQty: 1000, lines: [{ ingredientId: "sugar", qty: 500 }] }]]),
};
const latte: Recipe = {
  yieldQty: 1,
  lines: [
    { ingredientId: "coffee", qty: 18 },
    { ingredientId: "milk", qty: 180 },
    { ingredientId: "syrup", qty: 20 },
  ],
};
const oatSwap: Recipe = { yieldQty: 1, lines: [{ ingredientId: "milk", qty: -180 }, { ingredientId: "oat", qty: 180 }] };

describe("recipe costing", () => {
  it("rolls untracked prep cost up from its recipe", () => {
    expect(ingredientUnitCost("syrup", book)).toBe(0.015);
  });

  it("matches app.menu_item_cost (16.50) and breaks down what drives the cost", () => {
    const b = costRecipe(latte, book);
    expect(b.cost).toBe(16.5);
    expect(b.lines[0]!.share).toBeCloseTo(8.1 / 16.5);
    expect(b.lines.map((l) => l.ingredientId).at(-1)).toBe("syrup");
  });

  it("adds modifier recipes (substitution)", () => {
    // 16.50 − 180×0.045 + 180×0.12 = 30.00
    expect(menuItemCost(latte, [oatSwap], book)).toBe(30);
  });

  it("applies trim loss", () => {
    const r: Recipe = { yieldQty: 1, lines: [{ ingredientId: "coffee", qty: 100, wasteRate: 0.1 }] };
    expect(costRecipe(r, book).cost).toBe(49.5);
  });

  it("explodes to leaf stock items, like app.explode_recipe", () => {
    const used = explodeRecipe(latte, 2, book);
    expect(Object.fromEntries(used)).toEqual({ coffee: 36, milk: 360, sugar: 20 });
    const swap = explodeRecipe(oatSwap, 1, book);
    expect(Object.fromEntries(swap)).toEqual({ milk: -180, oat: 180 });
  });

  it("detects recipe loops before they are saved", () => {
    const loopBook: RecipeBook = {
      ingredients: new Map([
        ["a", ing("a", 0, { kind: "prep", trackStock: false })],
        ["b", ing("b", 0, { kind: "prep", trackStock: false })],
      ]),
      prepRecipes: new Map([
        ["a", { yieldQty: 1, lines: [{ ingredientId: "b", qty: 1 }] }],
        ["b", { yieldQty: 1, lines: [{ ingredientId: "a", qty: 1 }] }],
      ]),
    };
    expect(() => ingredientUnitCost("a", loopBook)).toThrow(RecipeCycleError);
    expect(wouldCreateCycle("syrup", "syrup", book)).toBe(true);
    expect(wouldCreateCycle("syrup", "sugar", book)).toBe(false);
    expect(wouldCreateCycle("a", "b", loopBook)).toBe(true);
  });

  it("judges margins and suggests friendly prices", () => {
    expect(foodCostPct(16.5, 65, 0.07, true)).toBeCloseTo(0.2716, 3);
    expect(marginHealth(0.27)).toBe("great");
    expect(marginHealth(0.33)).toBe("ok");
    expect(marginHealth(0.4)).toBe("watch");
    expect(marginHealth(0.5)).toBe("high");
    expect(suggestPrice(16.5, 0.3, 0.07, true)).toBe(60); // 16.5/0.3×1.07 = 58.85 → 60
    expect(suggestPrice(40, 0.3)).toBe(140);
    expect(suggestPrice(0)).toBe(0);
  });
});

describe("units", () => {
  it("converts within a dimension and refuses nonsense", () => {
    expect(convert(1.5, "kg", "g")).toBe(1500);
    expect(toBase(2, "tbsp")).toBe(30);
    expect(() => convert(1, "kg", "ml")).toThrow();
  });

  it("formats quantities the way people say them", () => {
    expect(formatQty(1500, "g")).toBe("1.5 กก.");
    expect(formatQty(250, "ml")).toBe("250 มล.");
    expect(formatQty(12, "pcs", "dozen")).toBe("1 โหล");
  });
});

describe("stock ledger rules (parity with app.apply_stock_movement)", () => {
  it("blends purchase cost into the moving average", () => {
    const first = applyMovement({ qty: 0, avgCost: 0 }, { qty: 2000, unitCost: 0.5, reason: "purchase" });
    expect(first.balance).toEqual({ qty: 2000, avgCost: 0.5 });
    const second = applyMovement(first.balance, { qty: 1000, unitCost: 0.8, reason: "purchase" });
    expect(second.balance.avgCost).toBe(0.6);
  });

  it("moves outflows at average cost and allows negative stock", () => {
    const r = applyMovement({ qty: 10, avgCost: 2 }, { qty: -15, reason: "sale" });
    expect(r.unitCost).toBe(2);
    expect(r.balance.qty).toBe(-5);
    // Next delivery resets the average instead of blending with a negative quantity.
    const after = applyMovement(r.balance, { qty: 20, unitCost: 3, reason: "purchase" });
    expect(after.balance).toEqual({ qty: 15, avgCost: 3 });
  });

  it("classifies stock status", () => {
    expect(stockStatus(-1)).toBe("negative");
    expect(stockStatus(0)).toBe("out");
    expect(stockStatus(400, 500)).toBe("low");
    expect(stockStatus(600, 500)).toBe("ok");
  });

  it("suggests whole packs up to par, counting what is already on order", () => {
    expect(reorderSuggestion({ onHand: 300, reorderPoint: 500, parLevel: 2000, packQty: 1000 })).toEqual({ qty: 2000, packs: 2 });
    expect(reorderSuggestion({ onHand: 300, onOrder: 1000, reorderPoint: 500, parLevel: 2000, packQty: 1000 })).toBeNull();
    expect(reorderSuggestion({ onHand: 300, reorderPoint: null })).toBeNull();
  });

  it("summarises a blind count — uncounted is unknown, not zero", () => {
    const s = summarizeCount([
      { ingredientId: "coffee", name: "เมล็ดกาแฟ", expected: 1964, counted: 1950, unitCost: 0.5 },
      { ingredientId: "milk", name: "นมสด", expected: 5620, counted: 5620, unitCost: 0.05 },
      { ingredientId: "oat", name: "นมโอ๊ต", expected: 820, counted: null, unitCost: 0.12 },
    ]);
    expect(s.counted).toBe(2);
    expect(s.uncounted).toBe(1);
    expect(s.varianceValue).toBe(-7);
    expect(s.biggestLosses[0]!.ingredientId).toBe("coffee");
  });

  it("measures actual vs theoretical usage", () => {
    const v = usageVariance({ ingredientId: "coffee", theoretical: 900, opening: 2000, purchases: 1000, closing: 2000, unitCost: 0.5 });
    expect(v.actual).toBe(1000);
    expect(v.gap).toBe(100);
    expect(v.gapValue).toBe(50);
  });
});
