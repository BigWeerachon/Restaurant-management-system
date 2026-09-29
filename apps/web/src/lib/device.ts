/**
 * This browser as a registered till (checklist 6.3). The owner registers it once in Settings; from then on staff open
 * the app, tap their name and enter a PIN — no e-mail on the device. The secret that proves the device is generated
 * here and never leaves as anything but its SHA-256 (at registration); it is sent in `X-Device-Token` afterwards.
 */
export interface DeviceRegistration {
  token: string;
  deviceId: string;
  name: string;
  tenantId: string;
  branchId: string;
}

const KEY = "sabai-device";
let cached: DeviceRegistration | null | undefined;

export function getDevice(): DeviceRegistration | null {
  if (cached !== undefined) return cached;
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    cached = raw ? (JSON.parse(raw) as DeviceRegistration) : null;
  } catch {
    cached = null;
  }
  return cached;
}

export function setDevice(next: DeviceRegistration | null) {
  cached = next;
  if (typeof localStorage === "undefined") return;
  try {
    if (next) localStorage.setItem(KEY, JSON.stringify(next));
    else localStorage.removeItem(KEY);
  } catch {
    // Private browsing / storage disabled: the device cannot stay registered, and asks again next time.
  }
}

const toHex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
const toBase64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** A new secret (256 random bits) and the SHA-256 of it, which is all the server is ever told. */
export async function newDeviceSecret(): Promise<{ secret: string; hash: string }> {
  const secret = `sbd_${toBase64Url(crypto.getRandomValues(new Uint8Array(32)))}`;
  const hash = toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)));
  return { secret, hash };
}

/** For tests. */
export function resetDeviceForTests() {
  cached = undefined;
  if (typeof localStorage !== "undefined") localStorage.removeItem(KEY);
}
