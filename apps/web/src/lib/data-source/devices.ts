/**
 * Registered tills (checklist 6.3): registering this browser, listing and revoking devices (Settings), and what a
 * registered device does before anyone is signed in — show who can sign in, and take a PIN.
 */
import { DomainError } from "../demo/engine";
import { useSabai } from "../demo/store";
import type { Member } from "../demo/types";
import { getDevice, newDeviceSecret, setDevice, type DeviceRegistration } from "../device";
import { apiFetch, getApiSession, setApiSession } from "./http-client";
import { loadShop } from "./http-context";

export type DeviceKind = "pos" | "kds" | "kiosk" | "printer_hub";

export const DEVICE_KINDS: { value: DeviceKind; label: string }[] = [
  { value: "pos", label: "เครื่องขาย (POS)" },
  { value: "kds", label: "จอครัว" },
  { value: "kiosk", label: "ตู้สั่งอาหาร" },
  { value: "printer_hub", label: "เครื่องพิมพ์กลาง" },
];

export interface DeviceRow {
  id: string;
  name: string;
  kind: DeviceKind;
  branch_id: string;
  is_active: boolean;
  last_seen_at: string | null;
  registered_at: string | null;
  revoked_at: string | null;
  registered_by_name: string | null;
  /** "T1": this till's own receipt series (HQ-T1-2609-00001). Given at its first sale, so empty until then. */
  receipt_code?: string | null;
}

export interface RosterStaff {
  id: string;
  displayName: string;
  nickname: string | null;
  roleKey: string;
  roleName: string;
  color: string | null;
}

export interface DeviceRoster {
  device: { id: string; name: string; kind: DeviceKind };
  tenant: { id: string; name: string };
  branch: { id: string; name: string };
  staff: RosterStaff[];
}

/** Registers this browser as a till of the current shop and remembers its secret here. */
export async function registerThisDevice(input: { name: string; kind: DeviceKind; branchId: string }): Promise<DeviceRegistration> {
  const { tenantId } = getApiSession();
  if (!tenantId) throw new DomainError("AUTH_REQUIRED");
  const { secret, hash } = await newDeviceSecret();
  const r = await apiFetch<{ id: string }>("/v1/devices", { method: "POST", body: { ...input, tokenHash: hash } });
  const device: DeviceRegistration = { token: secret, deviceId: r.id, name: input.name, tenantId, branchId: input.branchId };
  setDevice(device);
  return device;
}

export const listDevices = () => apiFetch<DeviceRow[]>("/v1/devices");

/** Cancels a till. If it is this one, it forgets its secret too. */
export async function revokeDevice(id: string): Promise<void> {
  await apiFetch(`/v1/devices/${id}`, { method: "DELETE" });
  if (getDevice()?.deviceId === id) setDevice(null);
}

/** The PIN screen's content for a registered device. A refused secret means the device was cancelled: it forgets it. */
export async function fetchRoster(): Promise<DeviceRoster> {
  const device = getDevice();
  if (!device) throw new DomainError("DEVICE_REVOKED");
  try {
    return await apiFetch<DeviceRoster>("/v1/device/roster", { deviceToken: device.token });
  } catch (e) {
    if (e instanceof DomainError && e.code === "DEVICE_REVOKED") setDevice(null);
    throw e;
  }
}

interface DevicePinResponse {
  token: string;
  tenantId: string;
  branchId: string;
  membership: { id: string; displayName: string; role: string; home: string };
}

/** A PIN entered on this registered device: no account involved. Returns the member now signed in. */
export async function devicePinSignIn(pin: string): Promise<Member> {
  const device = getDevice();
  if (!device) throw new DomainError("DEVICE_REVOKED");
  let r: DevicePinResponse;
  try {
    r = await apiFetch<DevicePinResponse>("/v1/auth/device-pin", { method: "POST", body: { pin }, deviceToken: device.token });
  } catch (e) {
    if (e instanceof DomainError && e.code === "DEVICE_REVOKED") setDevice(null);
    throw e;
  }
  const fresh = getApiSession().tenantId !== r.tenantId;
  setApiSession({ token: r.token, tenantId: r.tenantId });
  // First sign-in on this browser (or after another shop's data was here): start from this shop's own.
  await loadShop({ reset: fresh });
  const member = useSabai.getState().db.members.find((m) => m.id === r.membership.id);
  if (!member) throw new DomainError("INTERNAL", { feature: "devicePinSignIn: member missing from shop" });
  useSabai.getState().signIn(member.id, r.branchId);
  return member;
}
