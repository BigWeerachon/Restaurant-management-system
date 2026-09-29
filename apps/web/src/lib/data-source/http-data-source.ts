/**
 * The API adapter (ADR-0009). Session and shop loading are real; every other
 * command is filled in alongside the page that uses it (checklist phase 4) and
 * until then fails loudly with `INTERNAL` rather than quietly changing only the
 * local copy of the shop.
 */
import { DomainError } from "../demo/engine";
import { useSabai } from "../demo/store";
import type { Member } from "../demo/types";
import { apiFetch, clearApiSession, setApiSession } from "./http-client";
import { loadShop, loadSlices } from "./http-context";
import { kdsCommands } from "./http-kds";
import { menuCommands } from "./http-menu";
import { posCommands } from "./http-pos";
import { purchasingCommands } from "./http-purchasing";
import { stockCommands } from "./http-stock";
import type { DataSource, Slice } from "./types";

export { loadShop };

interface PinSwitchResponse {
  token: string;
  expiresAt: string;
  membership: { id: string; displayName: string; role: string; home: string };
}

const implemented = {
  async load(slices: Slice[]) {
    const live = slices.filter((s) => s !== "bootstrap");
    await Promise.all([slices.includes("bootstrap") ? loadShop({ reset: false }) : undefined, live.length ? loadSlices(live) : undefined]);
  },

  async signIn(memberId: string, branchId?: string) {
    // Signing in as a member needs a token for that member, which only a PIN gives (pinSwitch).
    void memberId;
    void branchId;
    throw new DomainError("AUTH_REQUIRED");
  },

  async signOut() {
    clearApiSession();
    useSabai.getState().signOut();
  },

  async setBranch(branchId: string) {
    useSabai.getState().setBranch(branchId);
  },

  async pinSwitch(branchId: string, pin: string): Promise<Member> {
    const r = await apiFetch<PinSwitchResponse>("/v1/auth/pin", { method: "POST", body: { branchId, pin }, tenant: false });
    setApiSession({ token: r.token });
    let member = useSabai.getState().db.members.find((m) => m.id === r.membership.id);
    if (!member) {
      // Added on another device since this one last loaded the shop.
      await loadShop({ reset: false });
      member = useSabai.getState().db.members.find((m) => m.id === r.membership.id);
    }
    if (!member) throw new DomainError("INTERNAL", { feature: "pinSwitch: member missing from shop" });
    useSabai.getState().signIn(member.id, branchId);
    return member;
  },

  async approve(permission: string, pin: string, target?: { type: string; id: string }, reason?: string) {
    const { db, session } = useSabai.getState();
    const branchId = session.branchId ?? db.branches[0]!.id;
    // The API checks the PIN against people who hold this permission and returns a one-time id for the command to carry.
    const r = await apiFetch<{ approvalId: string; expiresAt: string }>("/v1/approvals", {
      method: "POST",
      body: { branchId, permission, pin, targetType: target?.type, targetId: target?.id, reason },
    });
    return { value: r.approvalId };
  },

  ...posCommands,
  ...kdsCommands,
  ...stockCommands,
  ...menuCommands,
  ...purchasingCommands,
} satisfies Partial<DataSource>;

const NOT_YET = [
  "closeDay",
  "addExpense",
  "payBill",
  "matchStatementLine",
  "ignoreStatementLine",
  "addMember",
  "updateMember",
  "resetMemberPin",
  "setRolePermissions",
  "updateTenant",
  "addBranch",
  "updateBranch",
  "updateChannel",
  "setChannelCommission",
  "updatePaymentMethod",
  "skipOnboardingStep",
  "confirmCashOnly",
  "changePlan",
  "reportSummary",
  "today",
] as const satisfies readonly Exclude<keyof DataSource, keyof typeof implemented>[];

const notYet = Object.fromEntries(
  NOT_YET.map((name) => [
    name,
    async () => {
      throw new DomainError("INTERNAL", { feature: name });
    },
  ]),
) as Record<(typeof NOT_YET)[number], () => Promise<never>>;

// Fails to compile if a DataSource method is neither implemented above nor listed in NOT_YET.
export const httpDataSource: DataSource = { ...implemented, ...notYet };
