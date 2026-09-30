/**
 * The till's own thermal printer (checklist 7.2). One printer per device — like the paper width, it is a fact about
 * this device, not about the shop — reached over USB, a serial adapter or Bluetooth. When it is connected, receipts,
 * kitchen slips and the cash drawer go straight to it; when it is not (or the browser has no such feature), everything
 * falls back to the browser's print dialog, so a sale is never held up by a printer.
 */
import { create } from "zustand";
import { createTransport, PrinterError, supportedTransports, type PrinterTransport, type TransportKind } from "./transports";

/** How a slip reaches the paper: as a picture drawn here (Thai always right) or as text in the printer's Thai code page (fast, but only for printers that have it). */
export type PrintMode = "picture" | "text";

export interface PrinterSettings {
  /** `null`: no direct printer, use the print dialog. */
  transport: TransportKind | null;
  mode: PrintMode;
  /** Print the customer's receipt by itself when a bill is paid. */
  autoReceipt: boolean;
  /** Print a slip for the kitchen when a new ticket arrives. */
  autoKitchen: boolean;
  /** Open the cash drawer (through the printer) when a bill is paid in cash. */
  drawer: boolean;
  cut: boolean;
  baudRate: number;
  /** `ESC t` number of the Thai code page, for text mode. 255 is the common "Thai 18" on cheap printers; Epson uses 20, 21, 26. */
  codepage: number;
}

export const DEFAULT_SETTINGS: PrinterSettings = { transport: null, mode: "picture", autoReceipt: false, autoKitchen: false, drawer: false, cut: true, baudRate: 9600, codepage: 255 };

const KEY = "sabai-printer";

export function loadSettings(): PrinterSettings {
  if (typeof localStorage === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (!raw || typeof raw !== "object") return DEFAULT_SETTINGS;
    const s = raw as Partial<PrinterSettings>;
    return {
      transport: s.transport === "usb" || s.transport === "serial" || s.transport === "bluetooth" ? s.transport : null,
      mode: s.mode === "text" ? "text" : "picture",
      autoReceipt: s.autoReceipt === true,
      autoKitchen: s.autoKitchen === true,
      drawer: s.drawer === true,
      cut: s.cut !== false,
      baudRate: typeof s.baudRate === "number" && s.baudRate > 0 ? s.baudRate : DEFAULT_SETTINGS.baudRate,
      codepage: typeof s.codepage === "number" && s.codepage >= 0 && s.codepage <= 255 ? Math.round(s.codepage) : DEFAULT_SETTINGS.codepage,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(s: PrinterSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Storage blocked: the choice lasts until the page is closed.
  }
}

export type PrinterStatus = "off" | "connecting" | "ready" | "error";

interface PrinterStore {
  settings: PrinterSettings;
  status: PrinterStatus;
  /** What the connected printer calls itself. */
  name: string;
  /** In words a person can act on. */
  error: string | null;
  /** Which of USB / serial / Bluetooth this browser has. */
  supported: TransportKind[];
  /** Saved settings and browser support have been read (they can only be, in the browser). */
  loaded: boolean;
  /** The first attempt to reach the printer has finished, one way or the other: before that "not connected" only means "not yet". */
  settled: boolean;
  set(patch: Partial<PrinterSettings>): void;
  /** Asks the person to pick a printer. Needs a tap. */
  connect(): Promise<boolean>;
  /** Picks up a printer already allowed, without asking. Returns whether one was found. */
  reconnect(): Promise<boolean>;
  disconnect(): Promise<void>;
}

let transport: PrinterTransport | null = null;
/** Injected in tests and in the browser check; the app itself uses the browser's real features. */
let factory: (kind: TransportKind, opts: { baudRate?: number }) => PrinterTransport = createTransport;
export function setTransportFactory(f: typeof factory | null) {
  factory = f ?? createTransport;
}

/** The words shown for a failure: what happened and what to do, never a raw error. */
export function describePrinterError(e: unknown): string {
  if (e instanceof PrinterError) {
    if (e.code === "CANCELLED") return "ยังไม่ได้เลือกเครื่องพิมพ์ กด เชื่อมต่อ แล้วเลือกเครื่องพิมพ์จากรายการ";
    if (e.code === "UNSUPPORTED") return "เบราว์เซอร์นี้ต่อเครื่องพิมพ์ตรงไม่ได้ ใช้ Chrome หรือ Edge บนคอมพิวเตอร์/แอนดรอยด์ หรือพิมพ์ผ่านหน้าต่างพิมพ์แทน";
    if (e.code === "NOT_CONNECTED") return "เครื่องพิมพ์หลุด เสียบสายหรือเปิดเครื่องพิมพ์ แล้วกดเชื่อมต่อใหม่";
    return `${e.message} ตรวจสายและกระดาษ แล้วลองใหม่`;
  }
  const name = (e as { name?: string } | null)?.name;
  if (name === "SecurityError") return "เบราว์เซอร์ไม่ให้ใช้เครื่องพิมพ์ ต้องเปิดผ่านที่อยู่ https และกดเชื่อมต่อด้วยตัวเอง";
  if (name === "NetworkError") return "เครื่องพิมพ์ถูกใช้อยู่โดยโปรแกรมอื่น หรือหลุดไป ปิดโปรแกรมอื่นที่ใช้เครื่องพิมพ์แล้วลองใหม่";
  return "ต่อเครื่องพิมพ์ไม่สำเร็จ ตรวจสายหรือบลูทูธ แล้วลองใหม่";
}

export const usePrinter = create<PrinterStore>((set, get) => {
  const ensure = async (interactive: boolean): Promise<boolean> => {
    const { settings } = get();
    if (!settings.transport) {
      set({ settled: true });
      return false;
    }
    if (transport && transport.kind !== settings.transport) {
      await transport.disconnect();
      transport = null;
    }
    set({ status: "connecting", error: null });
    try {
      transport ??= factory(settings.transport, { baudRate: settings.baudRate });
      const ok = await transport.connect({ silent: !interactive });
      if (!ok) {
        set({ status: "off", name: "", settled: true });
        return false;
      }
      set({ status: "ready", name: transport.name, error: null, settled: true });
      return true;
    } catch (e) {
      transport = null;
      // Cancelling the picker is not a fault.
      if (e instanceof PrinterError && e.code === "CANCELLED") set({ status: "off", name: "", error: interactive ? describePrinterError(e) : null, settled: true });
      else set({ status: "error", name: "", error: describePrinterError(e), settled: true });
      return false;
    }
  };
  return {
    settings: DEFAULT_SETTINGS,
    status: "off",
    name: "",
    error: null,
    supported: [],
    loaded: false,
    settled: false,
    set(patch) {
      const next = { ...get().settings, ...patch };
      saveSettings(next);
      set({ settings: next });
      // A different kind of connection is a different printer.
      if (patch.transport !== undefined && transport && transport.kind !== patch.transport) {
        void transport.disconnect();
        transport = null;
        set({ status: "off", name: "", error: null });
      }
    },
    connect: () => ensure(true),
    reconnect: () => ensure(false),
    async disconnect() {
      await transport?.disconnect();
      transport = null;
      set({ status: "off", name: "", error: null });
    },
  };
});

/** Reads the saved settings and what this browser can do. Called once, in the browser. */
export function initPrinter() {
  usePrinter.setState({ settings: loadSettings(), supported: supportedTransports(), loaded: true });
}

export const directReady = () => usePrinter.getState().status === "ready";

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------
/** Jobs go out one at a time: two slips must never interleave on the wire. */
let chain: Promise<unknown> = Promise.resolve();

/** Puts bytes on the wire, in order with every other job. Rejects if the printer is not there, and marks it as needing a reconnect. */
export async function sendBytes(bytes: Uint8Array): Promise<void> {
  const run = async () => {
    if (!transport || !transport.connected) throw new PrinterError("NOT_CONNECTED", "not connected");
    await transport.write(bytes);
  };
  const p = chain.then(run, run);
  chain = p.catch(() => undefined);
  try {
    await p;
  } catch (e) {
    // A write that fails leaves the printer in an unknown state: show it as needing a reconnect instead of pretending.
    usePrinter.setState({ status: "error", error: describePrinterError(e) });
    throw e;
  }
}

/**
 * The part that turns a receipt or a slip into bytes (the layout, the Thai drawing, the encoder) is a download of its own,
 * fetched when something is first printed — or a moment after the till opens, when a printer is set up — so a till that
 * never prints direct never carries it.
 */
export const loadPrinterSend = () => import("./printer-send");
