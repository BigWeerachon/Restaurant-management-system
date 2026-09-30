/** Team commands for the API adapter: add staff, change a person or a role's rights, reset a PIN. */
import { DomainError } from "../demo/engine";
import { useSabai } from "../demo/store";
import { apiFetch } from "./http-client";
import { refresh } from "./http-context";
import type { DataSource } from "./types";

export const teamCommands = {
  async addMember(input) {
    const r = await apiFetch<{ id: string }>("/v1/members", {
      method: "POST",
      body: {
        displayName: input.name.trim(),
        roleKey: input.roleKey,
        pin: input.pin,
        // No list means every branch.
        branchIds: input.branchIds === "all" ? undefined : input.branchIds,
        maxDiscountRate: input.maxDiscountRate,
      },
    });
    await refresh(["team"]);
    const created = useSabai.getState().db.members.find((m) => m.id === r.id);
    if (!created) throw new DomainError("INTERNAL", { feature: "addMember: not in the reloaded team" });
    // The server keeps only a hash of the PIN. The one just chosen goes back to the screen so it can be handed to the person.
    return { ...created, pin: input.pin };
  },

  async updateMember(id, patch) {
    const body: Record<string, unknown> = {};
    if (patch.name !== undefined) body.displayName = patch.name.trim();
    if (patch.roleKey !== undefined) body.roleKey = patch.roleKey;
    if (patch.maxDiscountRate !== undefined) body.maxDiscountRate = patch.maxDiscountRate;
    if (patch.active !== undefined) body.status = patch.active ? "active" : "suspended";
    if (patch.branchIds !== undefined) {
      if (patch.branchIds === "all") body.allBranches = true;
      else body.branchIds = patch.branchIds;
    }
    if (Object.keys(body).length === 0) return;
    await apiFetch(`/v1/members/${id}`, { method: "PATCH", body });
    await refresh(["team"]);
  },

  async resetMemberPin(id, pin) {
    await apiFetch(`/v1/members/${id}/pin`, { method: "POST", body: { pin } });
    // Nothing on screen changes (PINs are never sent back), so there is nothing to reload.
  },

  async setRolePermissions(roleKey, permissions) {
    const role = useSabai.getState().db.roles.find((r) => r.key === roleKey);
    if (!role?.id) throw new DomainError("NOT_FOUND", { entity: "role" });
    await apiFetch(`/v1/roles/${role.id}/permissions`, { method: "PUT", body: { permissions } });
    // What this person themself may do can change with it, and so can the menu they see.
    await refresh(["team"]);
  },
} satisfies Partial<DataSource>;
