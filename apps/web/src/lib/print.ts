/**
 * Printing on paper through the browser's print dialog (checklist 7.1). `printReceipt` asks; `<PrintRoot />`
 * (components/app/print-root.tsx) draws just the receipt and prints it, so the till's own screen never ends up on the roll.
 */
import { create } from "zustand";

export type PaperWidth = 58 | 80;

const WIDTH_KEY = "sabai-paper-width";

/** This device's roll: 80 mm unless it was set to 58. Each till has its own printer, so this is per device, not per shop. */
export function getPaperWidth(): PaperWidth {
  if (typeof localStorage === "undefined") return 80;
  try {
    return localStorage.getItem(WIDTH_KEY) === "58" ? 58 : 80;
  } catch {
    return 80;
  }
}

export function setPaperWidth(width: PaperWidth) {
  try {
    localStorage.setItem(WIDTH_KEY, String(width));
  } catch {
    // Storage blocked: the choice lasts until the page is closed, through `getPaperWidth`'s default.
  }
}

export type PrintJob =
  | {
      kind: "receipt";
      orderId: string;
      /** A second printing of a receipt already handed over. */
      copy: boolean;
    }
  | { kind: "sample" };

interface PrintStore {
  job: PrintJob | null;
  start(job: PrintJob): void;
  done(): void;
}

export const usePrintJob = create<PrintStore>((set) => ({
  job: null,
  start: (job) => set({ job }),
  done: () => set({ job: null }),
}));

/** Prints the receipt of an order. The first printing is the original; a later one is marked as a copy. */
export function printReceipt(orderId: string, opts: { copy?: boolean } = {}) {
  usePrintJob.getState().start({ kind: "receipt", orderId, copy: !!opts.copy });
}

/** A made-up receipt, to check the printer and the roll. */
export function printSampleReceipt() {
  usePrintJob.getState().start({ kind: "sample" });
}
