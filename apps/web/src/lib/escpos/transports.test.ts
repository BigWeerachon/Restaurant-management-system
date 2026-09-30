import { describe, expect, it } from "vitest";
import { createBluetoothTransport, createSerialTransport, createUsbTransport, PrinterError, supportedTransports, type BleDeviceLike, type SerialPortLike, type UsbDeviceLike } from "./transports";

const domError = (name: string) => Object.assign(new Error(name), { name });

function fakeUsb(opts: { interfaces?: UsbDeviceLike["configuration"]; status?: string } = {}) {
  const calls: string[] = [];
  const sent: { endpoint: number; bytes: number }[] = [];
  const device: UsbDeviceLike = {
    productName: "TM-T82",
    manufacturerName: "EPSON",
    configuration: opts.interfaces ?? {
      interfaces: [
        { interfaceNumber: 0, alternates: [{ interfaceClass: 8, endpoints: [{ endpointNumber: 5, direction: "out", type: "bulk" }] }] },
        { interfaceNumber: 1, alternates: [{ interfaceClass: 7, endpoints: [{ endpointNumber: 1, direction: "in", type: "bulk" }, { endpointNumber: 2, direction: "out", type: "bulk" }] }] },
      ],
    },
    async open() {
      calls.push("open");
    },
    async close() {
      calls.push("close");
    },
    async selectConfiguration(n) {
      calls.push(`config ${n}`);
    },
    async claimInterface(n) {
      calls.push(`claim ${n}`);
    },
    async releaseInterface(n) {
      calls.push(`release ${n}`);
    },
    async transferOut(endpoint, data) {
      sent.push({ endpoint, bytes: (data as Uint8Array).length });
      return { status: opts.status ?? "ok" };
    },
  };
  return { device, calls, sent };
}

describe("USB printer", () => {
  it("picks the printer-class interface and its bulk-out endpoint, and names the printer", async () => {
    const { device, calls, sent } = fakeUsb();
    const t = createUsbTransport({ requestDevice: async () => device, getDevices: async () => [] });
    expect(await t.connect()).toBe(true);
    expect(calls).toEqual(["open", "claim 1"]);
    expect(t.name).toBe("EPSON TM-T82");
    await t.write(new Uint8Array(10));
    expect(sent).toEqual([{ endpoint: 2, bytes: 10 }]);
  });

  it("sends a long job in pieces the device can take", async () => {
    const { device, sent } = fakeUsb();
    const t = createUsbTransport({ requestDevice: async () => device, getDevices: async () => [] });
    await t.connect();
    await t.write(new Uint8Array(40_000));
    expect(sent.map((s) => s.bytes)).toEqual([16384, 16384, 7232]);
  });

  it("falls back to any bulk-out interface for a printer that calls itself vendor-specific", async () => {
    const { device, sent } = fakeUsb({ interfaces: { interfaces: [{ interfaceNumber: 3, alternates: [{ interfaceClass: 255, endpoints: [{ endpointNumber: 4, direction: "out", type: "bulk" }] }] }] } });
    const t = createUsbTransport({ requestDevice: async () => device, getDevices: async () => [] });
    await t.connect();
    await t.write(new Uint8Array(1));
    expect(sent[0]!.endpoint).toBe(4);
  });

  it("selects the configuration when the device has none yet", async () => {
    const { device, calls } = fakeUsb();
    let cfg = device.configuration;
    Object.defineProperty(device, "configuration", { get: () => cfg });
    device.selectConfiguration = async () => {
      calls.push("config 1");
      cfg = { interfaces: [{ interfaceNumber: 0, alternates: [{ interfaceClass: 7, endpoints: [{ endpointNumber: 1, direction: "out", type: "bulk" }] }] }] };
    };
    cfg = null;
    const t = createUsbTransport({ requestDevice: async () => device, getDevices: async () => [] });
    await t.connect();
    expect(calls).toEqual(["open", "config 1", "claim 0"]);
  });

  it("says CANCELLED when the picker is dismissed, and reconnects silently only to a printer already allowed", async () => {
    const t = createUsbTransport({
      requestDevice: async () => {
        throw domError("NotFoundError");
      },
      getDevices: async () => [],
    });
    await expect(t.connect()).rejects.toMatchObject({ code: "CANCELLED" });
    expect(await t.connect({ silent: true })).toBe(false);
    const { device } = fakeUsb();
    const known = createUsbTransport({ requestDevice: async () => device, getDevices: async () => [device] });
    expect(await known.connect({ silent: true })).toBe(true);
  });

  it("fails loudly when the printer refuses the data, and cannot write when not connected", async () => {
    const { device } = fakeUsb({ status: "stall" });
    const t = createUsbTransport({ requestDevice: async () => device, getDevices: async () => [] });
    await expect(t.write(new Uint8Array(1))).rejects.toMatchObject({ code: "NOT_CONNECTED" });
    await t.connect();
    await expect(t.write(new Uint8Array(1))).rejects.toMatchObject({ code: "FAILED" });
    await t.disconnect();
    expect(t.connected).toBe(false);
  });
});

function fakePort() {
  const written: number[][] = [];
  let locks = 0;
  let opened: { baudRate: number } | null = null;
  const port: SerialPortLike = {
    async open(o) {
      opened = o;
    },
    async close() {},
    writable: {
      getWriter() {
        locks++;
        return {
          async write(d) {
            written.push([...d]);
          },
          releaseLock() {
            locks--;
          },
        };
      },
    },
  };
  return { port, written, locks: () => locks, opened: () => opened };
}

describe("serial printer", () => {
  it("opens at the chosen baud rate, writes, and always releases the writer", async () => {
    const { port, written, locks, opened } = fakePort();
    const t = createSerialTransport({ requestPort: async () => port, getPorts: async () => [] }, { baudRate: 19200 });
    await t.connect();
    expect(opened()).toEqual({ baudRate: 19200 });
    await t.write(Uint8Array.of(1, 2, 3));
    expect(written).toEqual([[1, 2, 3]]);
    expect(locks()).toBe(0);
    port.writable!.getWriter = () => ({
      write: async () => {
        throw new Error("gone");
      },
      releaseLock: () => {
        locks_broken++;
      },
    });
    let locks_broken = 0;
    await expect(t.write(Uint8Array.of(1))).rejects.toThrow("gone");
    expect(locks_broken).toBe(1);
  });

  it("treats a port that is already open as fine, and takes a port already allowed without asking", async () => {
    const { port } = fakePort();
    port.open = async () => {
      throw domError("InvalidStateError");
    };
    const t = createSerialTransport({ requestPort: async () => port, getPorts: async () => [port] });
    expect(await t.connect({ silent: true })).toBe(true);
    expect(t.connected).toBe(true);
    const none = createSerialTransport({ requestPort: async () => port, getPorts: async () => [] });
    expect(await none.connect({ silent: true })).toBe(false);
  });

  it("reports another failure to open as FAILED and a dismissed picker as CANCELLED", async () => {
    const { port } = fakePort();
    port.open = async () => {
      throw domError("NetworkError");
    };
    await expect(createSerialTransport({ requestPort: async () => port, getPorts: async () => [] }).connect()).rejects.toBeInstanceOf(PrinterError);
    await expect(
      createSerialTransport({
        requestPort: async () => {
          throw domError("NotFoundError");
        },
        getPorts: async () => [],
      }).connect(),
    ).rejects.toMatchObject({ code: "CANCELLED" });
  });
});

function fakeBle(props: { write?: boolean; writeWithoutResponse?: boolean }[], opts: { connected?: () => boolean } = {}) {
  const written: number[][] = [];
  const characteristics = props.map((properties) => ({
    properties,
    writeValueWithoutResponse: async (d: BufferSource) => void written.push([...(d as Uint8Array)]),
    writeValueWithResponse: async (d: BufferSource) => void written.push([...(d as Uint8Array)]),
  }));
  let disconnected = 0;
  const device: BleDeviceLike = {
    name: "MTP-II",
    gatt: {
      get connected() {
        return opts.connected ? opts.connected() : true;
      },
      async connect() {
        return { getPrimaryServices: async () => [{ getCharacteristics: async () => characteristics }] };
      },
      disconnect() {
        disconnected++;
      },
    },
  };
  return { device, written, disconnected: () => disconnected };
}

describe("Bluetooth printer", () => {
  it("finds the writable characteristic and sends in small paced pieces", async () => {
    const { device, written } = fakeBle([{}, { writeWithoutResponse: true }]);
    const t = createBluetoothTransport({ requestDevice: async () => device }, { chunkSize: 4, delayMs: 0 });
    expect(await t.connect()).toBe(true);
    expect(t.name).toBe("MTP-II");
    await t.write(Uint8Array.from({ length: 10 }, (_, i) => i));
    expect(written).toEqual([[0, 1, 2, 3], [4, 5, 6, 7], [8, 9]]);
  });

  it("uses write-with-response when that is all the printer offers", async () => {
    const { device, written } = fakeBle([{ write: true }]);
    const t = createBluetoothTransport({ requestDevice: async () => device }, { chunkSize: 50, delayMs: 0 });
    await t.connect();
    await t.write(Uint8Array.of(9));
    expect(written).toEqual([[9]]);
  });

  it("cannot reconnect on its own, and says so when the link drops mid-shift", async () => {
    let up = true;
    const { device } = fakeBle([{ writeWithoutResponse: true }], { connected: () => up });
    const t = createBluetoothTransport({ requestDevice: async () => device }, { delayMs: 0 });
    expect(await t.connect({ silent: true })).toBe(false);
    await t.connect();
    up = false;
    await expect(t.write(Uint8Array.of(1))).rejects.toMatchObject({ code: "NOT_CONNECTED" });
    expect(t.connected).toBe(false);
  });

  it("gives up cleanly on a device with nothing to write to", async () => {
    const { device, disconnected } = fakeBle([{}]);
    const t = createBluetoothTransport({ requestDevice: async () => device });
    await expect(t.connect()).rejects.toMatchObject({ code: "FAILED" });
    expect(disconnected()).toBe(1);
  });
});

describe("what the browser has", () => {
  it("lists only the features that exist", () => {
    expect(supportedTransports({ usb: {}, bluetooth: {} } as unknown as Navigator)).toEqual(["usb", "bluetooth"]);
    expect(supportedTransports({} as Navigator)).toEqual([]);
    expect(supportedTransports(undefined)).toEqual([]);
  });
});
