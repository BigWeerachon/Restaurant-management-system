import { DevicePinBody, RegisterDeviceBody } from "@sabai/contracts";
import { createHash } from "node:crypto";
import type { Hono } from "hono";
import { mintStaffToken } from "../auth";
import { ApiFailure } from "../errors";
import { route, type Deps, type Env } from "../http";
import { RateLimiter } from "../rate-limit";

// A wrong PIN on a till: few tries a minute per device, so a stolen tablet cannot be used to guess its way in.
const devicePinLimiter = new RateLimiter(10, 60_000);
const rosterLimiter = new RateLimiter(60, 60_000);

const hashOf = (secret: string) => createHash("sha256").update(secret).digest("hex");

/** The secret a registered device sends in `X-Device-Token`. Missing or malformed reads the same as revoked: the device must be registered again. */
function deviceHash(header: string | undefined): string {
  if (!header || header.length < 20 || header.length > 200) throw new ApiFailure("DEVICE_REVOKED", 401);
  return hashOf(header);
}

/**
 * Registered tills (checklist 6.3). The owner or a manager registers a device in Settings; from then on staff sign in on
 * it with a PIN and no account. Registration, listing and revoking run as the signed-in person like any other command.
 * The two device-side calls run before anyone is signed in, so they go through narrow database functions and never
 * see more than the PIN screen shows.
 */
export function registerDevices(app: Hono<Env>, deps: Deps) {
  route(app, deps, { method: "POST", path: "/v1/devices", tag: "Devices", summary: "ลงทะเบียนเครื่องร้าน (พนักงานเข้าด้วย PIN บนเครื่องนี้ได้ ไม่ต้องมีอีเมล)", tenant: true, body: RegisterDeviceBody, permission: "settings.manage", status: 201 }, async ({ body, tx }) =>
    tx(async (t) => {
      const [row] = await t<{ id: string }[]>`
        select app.register_device(${body.branchId}, ${body.name}, ${body.kind}, ${body.tokenHash}, ${body.stationId ?? null}) as id`;
      return { id: row!.id, name: body.name, kind: body.kind, branchId: body.branchId };
    }),
  );

  route(app, deps, { method: "GET", path: "/v1/devices", tag: "Devices", summary: "เครื่องที่ลงทะเบียนไว้ในร้าน", tenant: true, permission: "settings.manage" }, async ({ tenantId, tx }) =>
    tx(async (t) => {
      // Reading devices is open to anyone in the shop as far as row security goes; who registered what and when is for those who manage settings.
      await t`select app.assert_permission(${tenantId}, 'settings.manage')`;
      return t`
      select d.id, d.name, d.kind, d.branch_id, d.station_id, d.is_active, d.last_seen_at, d.registered_at, d.revoked_at, d.receipt_code,
             m.display_name as registered_by_name
        from app.devices d left join app.memberships m on m.tenant_id = d.tenant_id and m.id = d.registered_by
       where d.tenant_id = ${tenantId} and d.registered_at is not null
       order by d.revoked_at nulls first, d.registered_at desc`;
    }),
  );

  route(app, deps, { method: "DELETE", path: "/v1/devices/{id}", tag: "Devices", summary: "ยกเลิกเครื่อง (เครื่องหาย/เลิกใช้ — เครื่องนั้นใช้ต่อไม่ได้ทันที)", tenant: true, permission: "settings.manage" }, async ({ params, tx }) =>
    tx(async (t) => {
      await t`select app.revoke_device(${params.id})`;
      return { ok: true };
    }),
  );

  route(app, deps, { method: "GET", path: "/v1/device/roster", tag: "Devices", summary: "หน้าจอเลือกพนักงานของเครื่องที่ลงทะเบียนแล้ว (ใช้รหัสเครื่องใน X-Device-Token)", auth: false }, async ({ c }) => {
    const hash = deviceHash(c.req.header("x-device-token"));
    rosterLimiter.check(`${c.req.header("x-forwarded-for") ?? "local"}:${hash}`);
    const [row] = await deps.sql<{ r: DeviceRoster | null }[]>`select app.device_roster(${hash}) as r`;
    if (!row?.r) throw new ApiFailure("DEVICE_REVOKED", 401);
    const r = row.r;
    c.header("Cache-Control", "no-store");
    return {
      device: r.device,
      tenant: r.tenant,
      branch: r.branch,
      staff: r.staff.map((s) => ({ id: s.id, displayName: s.display_name, nickname: s.nickname, roleKey: s.role_key, roleName: s.role_name, color: s.color })),
    };
  });

  route(app, deps, { method: "POST", path: "/v1/auth/device-pin", tag: "Identity", summary: "เข้าด้วย PIN บนเครื่องร้านที่ลงทะเบียนแล้ว (ไม่ต้องมีบัญชีอีเมลบนเครื่อง)", auth: false, body: DevicePinBody, idempotent: false }, async ({ c, body }) => {
    const hash = deviceHash(c.req.header("x-device-token"));
    devicePinLimiter.check(`${c.req.header("x-forwarded-for") ?? "local"}:${hash}`);
    const [row] = await deps.sql<{ r: DevicePinResult }[]>`select app.device_pin_login(${hash}, ${body.pin}) as r`;
    const r = row!.r;
    if (!r.device) throw new ApiFailure("DEVICE_REVOKED", 401);
    if (!r.membership_id) throw new ApiFailure("PIN_INVALID", 401);
    const token = await mintStaffToken({
      secret: deps.config.jwtSecret,
      membershipId: r.membership_id,
      tenantId: r.tenant_id!,
      branchId: r.branch_id!,
      ttlSeconds: deps.config.staffTokenTtlSeconds,
      deviceId: r.device_id!,
    });
    return { ...token, tenantId: r.tenant_id, branchId: r.branch_id, membership: { id: r.membership_id, displayName: r.display_name, role: r.role_key, home: r.home } };
  });
}

interface DeviceRoster {
  device: { id: string; name: string; kind: string };
  tenant: { id: string; name: string };
  branch: { id: string; name: string };
  staff: { id: string; display_name: string; nickname: string | null; role_key: string; role_name: string; color: string | null }[];
}

interface DevicePinResult {
  device: boolean;
  membership_id: string | null;
  display_name?: string;
  role_key?: string;
  home?: string;
  tenant_id?: string;
  branch_id?: string;
  device_id?: string;
}
