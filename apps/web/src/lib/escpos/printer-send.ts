/**
 * Turning a receipt, a kitchen slip or a cash-drawer pulse into bytes, and sending them (checklist 7.2). Kept apart from
 * `printer.ts` — the printer's state, which every till screen reads — because the layout, the drawing of Thai text and
 * the encoder are wanted only at the moment something is printed, and are a download of their own until then
 * (`loadPrinterSend`).
 */
import type { ReceiptData } from "../receipt";
import { EscPos } from "./encoder";
import { blocksToEscPos, kitchenBlocks, receiptBlocks, type Block, type KitchenSlip } from "./layout";
import { sendBytes, usePrinter, type PrinterSettings } from "./printer";
import { renderBlocksToBitmap } from "./raster";

export interface PrintOptions {
  widthMm: 58 | 80;
}

/** Printable dots across: 384 on a 58 mm roll, 576 on 80 mm (the printer's full print width at 203 dpi). */
export const dotsFor = (widthMm: 58 | 80) => (widthMm === 58 ? 384 : 576);
export const colsForWidth = (widthMm: 58 | 80) => (widthMm === 58 ? 32 : 48);

/** The bytes for a set of blocks, in the mode the printer is set to. */
export async function encodeBlocks(blocks: Block[], s: Pick<PrinterSettings, "mode" | "cut" | "codepage">, o: PrintOptions): Promise<Uint8Array> {
  const e = new EscPos({ cols: colsForWidth(o.widthMm), codepage: s.mode === "text" ? s.codepage : undefined });
  e.init();
  if (s.mode === "picture") e.align("left").raster(await renderBlocksToBitmap(blocks, dotsFor(o.widthMm)));
  else blocksToEscPos(blocks, e);
  if (s.cut) e.cut();
  else e.feed(4);
  return e.bytes();
}

/** Sends a receipt straight to the printer. Rejects on failure so the caller can fall back to the print dialog. */
export async function printReceiptDirect(data: ReceiptData, o: PrintOptions) {
  await sendBytes(await encodeBlocks(receiptBlocks(data), usePrinter.getState().settings, o));
}

export async function printKitchenDirect(slip: KitchenSlip, o: PrintOptions) {
  await sendBytes(await encodeBlocks(kitchenBlocks(slip), usePrinter.getState().settings, o));
}

/** Only the drawer pulse: no paper. */
export async function openDrawerDirect() {
  await sendBytes(new EscPos({ cols: 32 }).init().drawer().bytes());
}
