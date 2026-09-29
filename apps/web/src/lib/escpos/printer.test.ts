import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeEscPos, printedLines } from "./decode";
import { DEFAULT_SETTINGS, colsForWidth, describePrinterError, dotsFor, encodeBlocks, loadSettings, openDrawerDirect, printKitchenDirect, setTransportFactory, usePrinter } from "./printer";
import { PrinterError, type PrinterTransport, type TransportKind } from "./transports";

vi.mock("./raster", () => ({
  // A 16×2 picture: enough to see that a picture, not text, went to the printer.
  renderBlocksToBitmap: async (_blocks: unknown, width: number) => ({ width, height: 2, data: new Uint8Array(Math.ceil(width / 8) * 2).fill(0xff) }),
}));

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), clear: () => m.clear() };
}

function fakeTransport(kind: TransportKind, log: Uint8Array[], over: Partial<PrinterTransport> = {}): PrinterTransport {
  const t: PrinterTransport = {
    kind,
    name: "เครื่องทดสอบ",
    connected: false,
    async connect({ silent } = {}) {
      if (silent && kind === "bluetooth") return false;
      t.connected = true;
      return true;
    },
    async write(d) {
      log.push(d);
    },
    async disconnect() {
      t.connected = false;
    },
    ...over,
  };
  return t;
}

const slip = { ticketNo: "12", channel: "ทานที่ร้าน", table: "A1", time: "12:30", items: [{ qty: 2, name: "ข้าวผัดกุ้ง" }] };

beforeEach(async () => {
  vi.stubGlobal("localStorage", memoryStorage());
  await usePrinter.getState().disconnect();
  usePrinter.setState({ settings: { ...DEFAULT_SETTINGS, transport: "usb" }, status: "off", name: "", error: null, loaded: true });
});
afterEach(() => {
  setTransportFactory(null);
  vi.unstubAllGlobals();
});

describe("settings", () => {
  it("survive a reload, and junk in storage falls back to the defaults", () => {
    usePrinter.getState().set({ transport: "serial", mode: "text", drawer: true, codepage: 26 });
    expect(loadSettings()).toMatchObject({ transport: "serial", mode: "text", drawer: true, codepage: 26, cut: true, autoKitchen: false });
    localStorage.setItem("sabai-printer", JSON.stringify({ transport: "parallel", mode: 5, codepage: 999, baudRate: -1 }));
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    localStorage.setItem("sabai-printer", "{not json");
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("know the dots and columns of each roll", () => {
    expect([dotsFor(58), dotsFor(80), colsForWidth(58), colsForWidth(80)]).toEqual([384, 576, 32, 48]);
  });
});

describe("connecting", () => {
  it("becomes ready with the printer's name, and disconnects", async () => {
    setTransportFactory((k) => fakeTransport(k, []));
    expect(await usePrinter.getState().connect()).toBe(true);
    expect(usePrinter.getState()).toMatchObject({ status: "ready", name: "เครื่องทดสอบ", error: null });
    await usePrinter.getState().disconnect();
    expect(usePrinter.getState().status).toBe("off");
  });

  it("a silent reconnect that finds nothing is not an error", async () => {
    usePrinter.getState().set({ transport: "bluetooth" });
    setTransportFactory((k) => fakeTransport(k, []));
    expect(await usePrinter.getState().reconnect()).toBe(false);
    expect(usePrinter.getState()).toMatchObject({ status: "off", error: null });
  });

  it("a dismissed picker explains what to do but is not a fault; a real failure is", async () => {
    setTransportFactory((k) =>
      fakeTransport(k, [], {
        connect: async () => {
          throw new PrinterError("CANCELLED", "x");
        },
      }),
    );
    await usePrinter.getState().connect();
    expect(usePrinter.getState().status).toBe("off");
    expect(usePrinter.getState().error).toContain("เลือกเครื่องพิมพ์");
    setTransportFactory((k) =>
      fakeTransport(k, [], {
        connect: async () => {
          throw Object.assign(new Error("Access denied. at claimInterface"), { name: "SecurityError" });
        },
      }),
    );
    await usePrinter.getState().connect();
    expect(usePrinter.getState().status).toBe("error");
    // Words for the person — never the browser's own message.
    expect(usePrinter.getState().error).not.toContain("claimInterface");
  });

  it("choosing another kind of connection drops the old printer", async () => {
    const log: Uint8Array[] = [];
    let first: PrinterTransport | null = null;
    setTransportFactory((k) => (first ??= fakeTransport(k, log)));
    await usePrinter.getState().connect();
    usePrinter.getState().set({ transport: "serial" });
    expect(first!.connected).toBe(false);
    expect(usePrinter.getState().status).toBe("off");
  });
});

describe("sending", () => {
  it("a kitchen slip goes out as one job that starts with a reset and ends with a cut", async () => {
    const log: Uint8Array[] = [];
    setTransportFactory((k) => fakeTransport(k, log));
    await usePrinter.getState().connect();
    usePrinter.getState().set({ mode: "text" });
    await printKitchenDirect(slip, { widthMm: 80 });
    expect(log).toHaveLength(1);
    const events = decodeEscPos(log[0]!);
    expect(events[0]).toMatchObject({ type: "init" });
    expect(printedLines(events).join("\n")).toContain("โต๊ะ A1");
    expect(printedLines(events).join("\n")).toContain("2 x ข้าวผัดกุ้ง");
    expect(events.at(-1)).toMatchObject({ type: "cut" });
  });

  it("picture mode sends a raster picture the width of the roll, no text", async () => {
    const log: Uint8Array[] = [];
    setTransportFactory((k) => fakeTransport(k, log));
    await usePrinter.getState().connect();
    await printKitchenDirect(slip, { widthMm: 58 });
    const events = decodeEscPos(log[0]!);
    expect(events.some((e) => e.type === "raster")).toBe(true);
    expect(printedLines(events).some((l) => l.includes("ข้าวผัด"))).toBe(false);
    const raster = events.find((e) => e.type === "raster");
    expect(raster?.type === "raster" && raster.bitmap.width).toBe(384);
  });

  it("text mode selects the configured Thai code page; no cut when the printer has no blade", async () => {
    const bytes = await encodeBlocks([{ t: "text", text: "ก" }], { mode: "text", cut: false, codepage: 26 }, { widthMm: 80 });
    expect([...bytes.slice(0, 5)]).toEqual([0x1b, 0x40, 0x1b, 0x74, 26]);
    expect(decodeEscPos(bytes).some((e) => e.type === "cut")).toBe(false);
  });

  it("opens the drawer with a pulse and no paper", async () => {
    const log: Uint8Array[] = [];
    setTransportFactory((k) => fakeTransport(k, log));
    await usePrinter.getState().connect();
    await openDrawerDirect();
    expect([...log[0]!]).toEqual([0x1b, 0x40, 0x1b, 0x70, 0x00, 0x19, 0xfa]);
  });

  it("two jobs never mix on the wire, even when the first is slow", async () => {
    const order: string[] = [];
    setTransportFactory((k) =>
      fakeTransport(k, [], {
        async write(d) {
          order.push(`start ${d.length}`);
          await new Promise((r) => setTimeout(r, d.length > 10 ? 20 : 0));
          order.push(`end ${d.length}`);
        },
      }),
    );
    await usePrinter.getState().connect();
    const slow = openDrawerDirect();
    const quick = printKitchenDirect(slip, { widthMm: 80 });
    await Promise.all([slow, quick]);
    // Each job finishes before the next begins.
    for (let i = 0; i < order.length; i += 2) expect(order[i]!.replace("start", "")).toBe(order[i + 1]!.replace("end", ""));
  });

  it("a failed write says the printer needs attention, and rejects so the caller can fall back", async () => {
    setTransportFactory((k) =>
      fakeTransport(k, [], {
        async write() {
          throw new PrinterError("FAILED", "stall");
        },
      }),
    );
    await usePrinter.getState().connect();
    await expect(openDrawerDirect()).rejects.toBeInstanceOf(PrinterError);
    expect(usePrinter.getState().status).toBe("error");
    expect(usePrinter.getState().error).toContain("ตรวจสายและกระดาษ");
  });

  it("sending with no printer connected rejects", async () => {
    await expect(openDrawerDirect()).rejects.toMatchObject({ code: "NOT_CONNECTED" });
  });
});

describe("error words", () => {
  it("never pass the browser's own message through", () => {
    for (const e of [new Error("Failed to execute 'claimInterface' on 'USBDevice'"), Object.assign(new Error("x"), { name: "NetworkError" }), new PrinterError("UNSUPPORTED", "x")]) {
      const s = describePrinterError(e);
      expect(s).not.toMatch(/claimInterface|USBDevice|Failed to execute/);
      expect(s.length).toBeGreaterThan(10);
    }
  });
});
