import { onboardingProgress } from "@sabai/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onboarding } from "../demo/selectors";
import { useSabai } from "../demo/store";
import { clearApiSession, setApiSession } from "./http-client";
import { httpDataSource as ds } from "./http-data-source";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function fakeApi(routes: Record<string, { status?: number; body: unknown } | (() => { status?: number; body: unknown })>) {
  const calls: { key: string; body: any }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL, init: any) => {
      const key = `${init?.method ?? "GET"} ${new URL(String(url)).pathname}`;
      calls.push({ key, body: init?.body ? JSON.parse(init.body) : undefined });
      const r = routes[key];
      const res = typeof r === "function" ? r() : r;
      return res ? json(res.status ?? 200, res.body) : json(404, { error: { code: "NOT_FOUND" } });
    }),
  );
  return calls;
}

const facts = (over: Partial<Parameters<typeof onboardingProgress>[0]> = {}) => ({ branchReady: false, paymentsReady: false, ingredients: 0, menuItems: 0, recipes: 0, staff: 1, hasSale: false, skipped: [] as string[], ...over });
// What GET /v1/onboarding sends: the progress, as JSON (the steps' `done` functions do not travel).
const wire = (f = facts()) => JSON.parse(JSON.stringify(onboardingProgress(f)));

describe("the first-run checklist on the API", () => {
  beforeEach(() => {
    clearApiSession();
    setApiSession({ token: "staff-token", tenantId: "t-1" });
    useSabai.getState().reset("demo");
    useSabai.getState().signIn("m-owner");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("takes the server's word for how far the shop has got, instead of working it out from what this device holds", async () => {
    // A shop that has traded for months and would look empty to a device holding only today.
    const done = wire(facts({ branchReady: true, paymentsReady: true, ingredients: 30, menuItems: 40, recipes: 40, staff: 6, hasSale: true }));
    fakeApi({ "GET /v1/onboarding": { body: done } });
    await ds.load(["onboarding"]);
    const p = onboarding(useSabai.getState().db);
    expect(p.isComplete).toBe(true);
    expect(p.percent).toBe(100);
  });

  it("keeps working it out locally in the demo, where there is no server", () => {
    useSabai.getState().reset("fresh", "ร้านใหม่");
    expect(useSabai.getState().db.onboardingProgress).toBeUndefined();
    expect(onboarding(useSabai.getState().db).completed).toBeLessThan(7);
  });

  it("reads the checklist again after a command while it is still open, and stops once it is complete", async () => {
    let progress = wire();
    const calls = fakeApi({ "GET /v1/onboarding": () => ({ body: progress }), "POST /v1/payment-methods/pm-1": { body: {} }, "PATCH /v1/payment-methods/pm-1": { body: {} }, "GET /v1/shop": { status: 500, body: {} } });
    await ds.load(["onboarding"]);
    calls.length = 0;
    progress = wire(facts({ branchReady: true }));
    await ds.updatePaymentMethod("pm-1", { active: true });
    expect(calls.map((c) => c.key)).toContain("GET /v1/onboarding");
    expect(onboarding(useSabai.getState().db).completed).toBe(1);

    progress = wire(facts({ branchReady: true, paymentsReady: true, ingredients: 1, menuItems: 1, recipes: 1, staff: 2, hasSale: true }));
    await ds.updatePaymentMethod("pm-1", { active: true });
    expect(onboarding(useSabai.getState().db).isComplete).toBe(true);
    calls.length = 0;
    await ds.updatePaymentMethod("pm-1", { active: true });
    // Nothing left to finish, so nothing is asked.
    expect(calls.map((c) => c.key)).not.toContain("GET /v1/onboarding");
  });

  it("skips an optional step, and confirms a shop that takes cash only", async () => {
    const calls = fakeApi({
      "POST /v1/onboarding/skip": { body: { ok: true } },
      "POST /v1/settings/payments/confirm-cash-only": { body: { ok: true } },
      "GET /v1/onboarding": { body: wire(facts({ skipped: ["staff"], paymentsReady: true })) },
      "GET /v1/shop": { status: 500, body: {} },
    });
    await ds.load(["onboarding"]);
    await ds.skipOnboardingStep("staff");
    await ds.confirmCashOnly();
    expect(calls.filter((c) => c.key.startsWith("POST")).map((c) => [c.key, c.body])).toEqual([
      ["POST /v1/onboarding/skip", { step: "staff" }],
      ["POST /v1/settings/payments/confirm-cash-only", undefined],
    ]);
    const p = onboarding(useSabai.getState().db);
    expect(p.steps.find((s) => s.key === "staff")!.status).toBe("skipped");
    expect(p.steps.find((s) => s.key === "payments")!.status).toBe("done");
  });

  it("passes on the server's refusal to skip a step that cannot be skipped", async () => {
    fakeApi({ "POST /v1/onboarding/skip": { status: 422, body: { error: { code: "VALIDATION" } } } });
    await expect(ds.skipOnboardingStep("branch")).rejects.toMatchObject({ code: "VALIDATION" });
  });
});
