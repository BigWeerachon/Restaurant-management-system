import { beforeEach, describe, expect, it } from "vitest";
import { alerts } from "./selectors";
import { todayIso, useSabai } from "./store";

describe("home-page alerts", () => {
  beforeEach(() => {
    useSabai.getState().reset("fresh");
  });

  const stateWith = (activity: { type: string; ingredientId?: string; pct?: number; branchId?: string; at?: string }[]) => {
    const { db } = useSabai.getState();
    const today = todayIso();
    const ing = { ...db.ingredients[0]!, id: "ing-milk", name: "นมสด" };
    return {
      today,
      state: {
        ...db,
        ingredients: [ing],
        activity: activity.map((a, i) => ({ id: `ev-${i}`, at: a.at ?? new Date().toISOString(), type: a.type, branchId: a.branchId, text: "x", data: a.ingredientId ? { ingredientId: a.ingredientId, pct: a.pct } : undefined })),
      },
      branchId: db.branches[0]!.id,
    };
  };

  it("warns about an ingredient's price rise from the event the database records, when there are no receipts to read it from", () => {
    const { state, today, branchId } = stateWith([{ type: "inventory.price_increased", ingredientId: "ing-milk", pct: 12.5 }]);
    const a = alerts(state, branchId, today).find((x) => x.id === "price-ing-milk");
    expect(a).toMatchObject({ tone: "warn", title: "ราคานมสดขึ้น 12.5%", href: "/menu?sort=cost" });
  });

  it("ignores old price rises, other branches' and events that do not say which ingredient", () => {
    const old = new Date(Date.now() - 5 * 86400000).toISOString();
    const { state, today, branchId } = stateWith([
      { type: "inventory.price_increased", ingredientId: "ing-milk", pct: 12.5, at: old },
      { type: "inventory.price_increased", ingredientId: "ing-milk", pct: 9, branchId: "another-branch" },
      { type: "inventory.price_increased" },
      { type: "inventory.waste", ingredientId: "ing-milk", pct: 3 },
    ]);
    expect(alerts(state, branchId, today).some((x) => x.id.startsWith("price-"))).toBe(false);
  });

  it("warns once per ingredient however many times its price rose", () => {
    const { state, today, branchId } = stateWith([
      { type: "inventory.price_increased", ingredientId: "ing-milk", pct: 12.5 },
      { type: "inventory.price_increased", ingredientId: "ing-milk", pct: 8 },
    ]);
    expect(alerts(state, branchId, today).filter((x) => x.id === "price-ing-milk")).toHaveLength(1);
  });
});
