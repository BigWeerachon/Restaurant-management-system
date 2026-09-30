import type { Tx } from "../db";
import { ApiFailure } from "../errors";

/** THB decimal string for the wire, whatever the driver handed us. */
export function money(v: unknown): string {
  if (v === null || v === undefined) return "0.00";
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : "0.00";
}

export function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function hasPermission(tx: Tx, tenantId: string, permission: string, branchId?: string | null): Promise<boolean> {
  const [row] = await tx<{ ok: boolean }[]>`select app.has_permission(${tenantId}::uuid, ${permission}, ${branchId ?? null}::uuid) as ok`;
  return !!row?.ok;
}

export async function requirePermission(tx: Tx, tenantId: string, permission: string, branchId?: string | null): Promise<void> {
  if (!(await hasPermission(tx, tenantId, permission, branchId))) {
    throw new ApiFailure("PERMISSION_DENIED", 403, { permission });
  }
}

/** Resolves a branch the actor can see (RLS) and returns its tenant. */
export async function branchTenant(tx: Tx, branchId: string): Promise<string> {
  const [b] = await tx<{ tenant_id: string }[]>`select tenant_id from app.branches where id = ${branchId}`;
  if (!b) throw new ApiFailure("NOT_FOUND", 404, { entity: "branch" });
  return b.tenant_id;
}

/** Calls a JSON-returning database command. */
export async function callJson<T = Record<string, unknown>>(tx: Tx, fn: string, arg: unknown): Promise<T> {
  if (!/^app\.[a-z_]+$/.test(fn)) throw new Error("invalid function name");
  // postgres.js serialises jsonb parameters itself — pass the object, not a string.
  const [row] = await tx.unsafe(`select ${fn}($1::jsonb) as r`, [arg as never]);
  return (row as unknown as { r: T }).r;
}
