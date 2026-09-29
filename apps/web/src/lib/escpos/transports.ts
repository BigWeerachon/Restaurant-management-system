/**
 * The three ways a browser can talk to a receipt printer (checklist 7.2): a cable to USB (WebUSB), a serial or
 * USB-serial adapter (Web Serial), or Bluetooth (Web Bluetooth). All three are Chromium features — Safari/iPad have
 * none of them, which is why the print dialog stays available. Each is a small `PrinterTransport`, so the rest of
 * the app only ever says "write these bytes".
 */
export type TransportKind = "usb" | "serial" | "bluetooth";

export interface PrinterTransport {
  kind: TransportKind;
  /** What to call it on screen once connected ("EPSON TM-T82", "COM3"). */
  name: string;
  connected: boolean;
  /** Asks the person to pick a printer (needs a tap) — or reconnects to one already allowed, without asking. */
  connect(opts?: { silent?: boolean }): Promise<boolean>;
  write(data: Uint8Array): Promise<void>;
  disconnect(): Promise<void>;
}

/** `message` is always a sentence written for the person at the till (Thai), never the browser's own wording. */
export class PrinterError extends Error {
  constructor(
    readonly code: "UNSUPPORTED" | "CANCELLED" | "NOT_CONNECTED" | "FAILED",
    message: string,
  ) {
    super(message);
    this.name = "PrinterError";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// WebUSB
// ---------------------------------------------------------------------------
interface UsbEndpoint {
  endpointNumber: number;
  direction: "in" | "out";
  type: "bulk" | "interrupt" | "isochronous";
}
interface UsbAlternate {
  interfaceClass: number;
  endpoints: UsbEndpoint[];
}
interface UsbInterface {
  interfaceNumber: number;
  alternates: UsbAlternate[];
}
export interface UsbDeviceLike {
  productName?: string | null;
  manufacturerName?: string | null;
  configuration: { interfaces: UsbInterface[] } | null;
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration(n: number): Promise<void>;
  claimInterface(n: number): Promise<void>;
  releaseInterface?(n: number): Promise<void>;
  transferOut(endpoint: number, data: BufferSource): Promise<{ status: string }>;
}
export interface UsbApi {
  requestDevice(opts: { filters: { classCode?: number }[] }): Promise<UsbDeviceLike>;
  getDevices(): Promise<UsbDeviceLike[]>;
}

const USB_CHUNK = 16 * 1024;

export function createUsbTransport(api: UsbApi): PrinterTransport {
  let device: UsbDeviceLike | null = null;
  let endpoint = 0;
  let iface = 0;
  const t: PrinterTransport = {
    kind: "usb",
    name: "",
    connected: false,
    async connect({ silent } = {}) {
      let picked: UsbDeviceLike | undefined;
      if (silent) {
        // A printer the person already allowed: no dialog. (`classCode: 7` = the USB printer class.)
        picked = (await api.getDevices()).find((d) => d.configuration?.interfaces.some((i) => i.alternates.some((a) => a.interfaceClass === 7)) ?? true);
        if (!picked) return false;
      } else {
        try {
          picked = await api.requestDevice({ filters: [{ classCode: 7 }] });
        } catch (e) {
          if ((e as { name?: string }).name === "NotFoundError") throw new PrinterError("CANCELLED", "ไม่ได้เลือกเครื่องพิมพ์");
          throw new PrinterError("FAILED", "เลือกเครื่องพิมพ์ไม่สำเร็จ");
        }
      }
      await picked.open();
      if (picked.configuration === null) await picked.selectConfiguration(1);
      // The printer-class interface if there is one; some cheap printers say "vendor specific" instead, so any bulk-out will do.
      const interfaces = picked.configuration?.interfaces ?? [];
      const pick = (want: (a: UsbAlternate) => boolean) => {
        for (const i of interfaces) for (const a of i.alternates) if (want(a)) return { number: i.interfaceNumber, ep: a.endpoints.find((e) => e.direction === "out" && e.type === "bulk") };
        return null;
      };
      const found = pick((a) => a.interfaceClass === 7 && a.endpoints.some((e) => e.direction === "out" && e.type === "bulk")) ?? pick((a) => a.endpoints.some((e) => e.direction === "out" && e.type === "bulk"));
      if (!found?.ep) throw new PrinterError("FAILED", "ไม่พบช่องส่งข้อมูลของเครื่องพิมพ์");
      iface = found.number;
      endpoint = found.ep.endpointNumber;
      await picked.claimInterface(iface);
      device = picked;
      t.name = [picked.manufacturerName, picked.productName].filter(Boolean).join(" ") || "เครื่องพิมพ์ USB";
      t.connected = true;
      return true;
    },
    async write(data) {
      if (!device || !t.connected) throw new PrinterError("NOT_CONNECTED", "ยังไม่ได้เชื่อมต่อเครื่องพิมพ์");
      for (let i = 0; i < data.length; i += USB_CHUNK) {
        const r = await device.transferOut(endpoint, data.slice(i, i + USB_CHUNK));
        if (r.status !== "ok") throw new PrinterError("FAILED", "เครื่องพิมพ์ไม่รับข้อมูล");
      }
    },
    async disconnect() {
      const d = device;
      device = null;
      t.connected = false;
      try {
        await d?.releaseInterface?.(iface);
        await d?.close();
      } catch {
        // Unplugged already.
      }
    },
  };
  return t;
}

// ---------------------------------------------------------------------------
// Web Serial
// ---------------------------------------------------------------------------
export interface SerialPortLike {
  open(opts: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  writable: { getWriter(): { write(data: Uint8Array): Promise<void>; releaseLock(): void } } | null;
  getInfo?(): { usbVendorId?: number; usbProductId?: number };
}
export interface SerialApi {
  requestPort(): Promise<SerialPortLike>;
  getPorts(): Promise<SerialPortLike[]>;
}

export function createSerialTransport(api: SerialApi, opts: { baudRate?: number } = {}): PrinterTransport {
  let port: SerialPortLike | null = null;
  const t: PrinterTransport = {
    kind: "serial",
    name: "",
    connected: false,
    async connect({ silent } = {}) {
      let picked: SerialPortLike | undefined;
      if (silent) {
        picked = (await api.getPorts())[0];
        if (!picked) return false;
      } else {
        try {
          picked = await api.requestPort();
        } catch (e) {
          if ((e as { name?: string }).name === "NotFoundError") throw new PrinterError("CANCELLED", "ไม่ได้เลือกเครื่องพิมพ์");
          throw new PrinterError("FAILED", "เลือกเครื่องพิมพ์ไม่สำเร็จ");
        }
      }
      try {
        await picked.open({ baudRate: opts.baudRate ?? 9600 });
      } catch (e) {
        // "Already open" is fine: another tab or an earlier connection left it so.
        if ((e as { name?: string }).name !== "InvalidStateError") throw new PrinterError("FAILED", "เปิดพอร์ตของเครื่องพิมพ์ไม่ได้");
      }
      port = picked;
      const info = picked.getInfo?.();
      t.name = info?.usbVendorId ? `พอร์ตอนุกรม (USB ${info.usbVendorId.toString(16)}:${(info.usbProductId ?? 0).toString(16)})` : "พอร์ตอนุกรม";
      t.connected = true;
      return true;
    },
    async write(data) {
      if (!port?.writable || !t.connected) throw new PrinterError("NOT_CONNECTED", "ยังไม่ได้เชื่อมต่อเครื่องพิมพ์");
      const writer = port.writable.getWriter();
      try {
        await writer.write(data);
      } finally {
        writer.releaseLock();
      }
    },
    async disconnect() {
      const p = port;
      port = null;
      t.connected = false;
      try {
        await p?.close();
      } catch {
        // Already closed or unplugged.
      }
    },
  };
  return t;
}

// ---------------------------------------------------------------------------
// Web Bluetooth
// ---------------------------------------------------------------------------
/** GATT services receipt printers commonly use for raw data. Which one a given printer has is only known by asking it. */
export const BLUETOOTH_PRINTER_SERVICES = ["000018f0-0000-1000-8000-00805f9b34fb", "e7810a71-73ae-499d-8c15-faa9aef0c3f2", "49535343-fe7d-4ae5-8fa9-9fafd205e455", "0000ff00-0000-1000-8000-00805f9b34fb", "0000fee7-0000-1000-8000-00805f9b34fb"];

export interface BleCharacteristicLike {
  properties: { write?: boolean; writeWithoutResponse?: boolean };
  writeValueWithoutResponse?(data: BufferSource): Promise<void>;
  writeValueWithResponse?(data: BufferSource): Promise<void>;
  writeValue?(data: BufferSource): Promise<void>;
}
export interface BleServiceLike {
  getCharacteristics(): Promise<BleCharacteristicLike[]>;
}
export interface BleDeviceLike {
  name?: string;
  gatt: { connect(): Promise<{ getPrimaryServices(): Promise<BleServiceLike[]> }>; disconnect(): void; connected?: boolean };
}
export interface BluetoothApi {
  requestDevice(opts: { filters?: { services: string[] }[]; acceptAllDevices?: boolean; optionalServices?: string[] }): Promise<BleDeviceLike>;
}

export function createBluetoothTransport(api: BluetoothApi, opts: { chunkSize?: number; delayMs?: number } = {}): PrinterTransport {
  const chunk = opts.chunkSize ?? 100;
  const delay = opts.delayMs ?? 12;
  let device: BleDeviceLike | null = null;
  let characteristic: BleCharacteristicLike | null = null;
  const t: PrinterTransport = {
    kind: "bluetooth",
    name: "",
    connected: false,
    async connect({ silent } = {}) {
      // Bluetooth cannot reconnect on its own: the browser wants a tap every time.
      if (silent) return false;
      let picked: BleDeviceLike;
      try {
        picked = await api.requestDevice({ acceptAllDevices: true, optionalServices: BLUETOOTH_PRINTER_SERVICES });
      } catch (e) {
        if ((e as { name?: string }).name === "NotFoundError") throw new PrinterError("CANCELLED", "ไม่ได้เลือกเครื่องพิมพ์");
        throw new PrinterError("FAILED", "เลือกเครื่องพิมพ์ไม่สำเร็จ");
      }
      const server = await picked.gatt.connect();
      let found: BleCharacteristicLike | null = null;
      for (const service of await server.getPrimaryServices()) {
        for (const c of await service.getCharacteristics()) {
          if (c.properties.write || c.properties.writeWithoutResponse) {
            found = c;
            break;
          }
        }
        if (found) break;
      }
      if (!found) {
        picked.gatt.disconnect();
        throw new PrinterError("FAILED", "ไม่พบช่องส่งข้อมูลของเครื่องพิมพ์บลูทูธนี้");
      }
      device = picked;
      characteristic = found;
      t.name = picked.name || "เครื่องพิมพ์บลูทูธ";
      t.connected = true;
      return true;
    },
    async write(data) {
      if (!characteristic || !device || !t.connected) throw new PrinterError("NOT_CONNECTED", "ยังไม่ได้เชื่อมต่อเครื่องพิมพ์");
      if (device.gatt.connected === false) {
        t.connected = false;
        throw new PrinterError("NOT_CONNECTED", "บลูทูธหลุด เชื่อมต่อเครื่องพิมพ์ใหม่");
      }
      for (let i = 0; i < data.length; i += chunk) {
        const part = data.slice(i, i + chunk);
        if (characteristic.properties.writeWithoutResponse && characteristic.writeValueWithoutResponse) await characteristic.writeValueWithoutResponse(part);
        else if (characteristic.writeValueWithResponse) await characteristic.writeValueWithResponse(part);
        else await characteristic.writeValue!(part);
        // A printer's receive buffer is small: pace the pieces.
        await sleep(delay);
      }
    },
    async disconnect() {
      const d = device;
      device = null;
      characteristic = null;
      t.connected = false;
      try {
        d?.gatt.disconnect();
      } catch {
        // Gone already.
      }
    },
  };
  return t;
}

/** Which of the three this browser has. */
export function supportedTransports(nav: Navigator | undefined = typeof navigator === "undefined" ? undefined : navigator): TransportKind[] {
  if (!nav) return [];
  const n = nav as unknown as { usb?: unknown; serial?: unknown; bluetooth?: unknown };
  return (["usb", "serial", "bluetooth"] as const).filter((k) => !!n[k]);
}

/** A transport for `kind` on the real browser APIs. */
export function createTransport(kind: TransportKind, opts: { baudRate?: number } = {}): PrinterTransport {
  const n = navigator as unknown as { usb?: UsbApi; serial?: SerialApi; bluetooth?: BluetoothApi };
  const api = n[kind];
  if (!api) throw new PrinterError("UNSUPPORTED", "เบราว์เซอร์นี้ไม่รองรับการส่งตรงเครื่องพิมพ์แบบนี้");
  if (kind === "usb") return createUsbTransport(api as UsbApi);
  if (kind === "serial") return createSerialTransport(api as SerialApi, opts);
  return createBluetoothTransport(api as BluetoothApi);
}
