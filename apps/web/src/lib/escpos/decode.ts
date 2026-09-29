import type { Bitmap } from "./encoder";
import { Cp874 } from "./thai-decode";

export type EscPosEvent =
  | { type: "init" }
  | { type: "codepage"; n: number }
  | { type: "align"; value: "left" | "center" | "right" }
  | { type: "bold"; on: boolean }
  | { type: "size"; width: number; height: number }
  | { type: "text"; text: string }
  | { type: "lf" }
  | { type: "feed"; lines: number }
  | { type: "cut"; partial: boolean }
  | { type: "drawer"; pin: number; onMs: number; offMs: number }
  | { type: "raster"; bitmap: Bitmap };

/**
 * Reads an ESC/POS byte stream back into what it says — the printer's side of the conversation. Used to check what
 * the till sends (tests, and the browser test's "virtual printer"), and to turn a picture-mode receipt back into an
 * image to look at. Throws on a command it does not know or one cut short: a stream a real printer would choke on.
 */
export function decodeEscPos(bytes: Uint8Array): EscPosEvent[] {
  const events: EscPosEvent[] = [];
  let i = 0;
  let text: number[] = [];
  const flush = () => {
    if (text.length) events.push({ type: "text", text: Cp874.decode(text) });
    text = [];
  };
  const need = (n: number, what: string) => {
    if (i + n > bytes.length) throw new Error(`ESC/POS stream ends inside ${what} at byte ${i}`);
  };
  while (i < bytes.length) {
    const b = bytes[i]!;
    if (b === 0x0a) {
      flush();
      events.push({ type: "lf" });
      i++;
    } else if (b === 0x1b) {
      flush();
      need(2, "an ESC command");
      const c = bytes[i + 1]!;
      if (c === 0x40) (events.push({ type: "init" }), (i += 2));
      else if (c === 0x74) (need(3, "ESC t"), events.push({ type: "codepage", n: bytes[i + 2]! }), (i += 3));
      else if (c === 0x61) (need(3, "ESC a"), events.push({ type: "align", value: (["left", "center", "right"] as const)[bytes[i + 2]!] ?? "left" }), (i += 3));
      else if (c === 0x45) (need(3, "ESC E"), events.push({ type: "bold", on: (bytes[i + 2]! & 1) === 1 }), (i += 3));
      else if (c === 0x64) (need(3, "ESC d"), events.push({ type: "feed", lines: bytes[i + 2]! }), (i += 3));
      else if (c === 0x70) (need(5, "ESC p"), events.push({ type: "drawer", pin: bytes[i + 2]!, onMs: bytes[i + 3]! * 2, offMs: bytes[i + 4]! * 2 }), (i += 5));
      else throw new Error(`unknown ESC command 0x${c.toString(16)} at byte ${i}`);
    } else if (b === 0x1d) {
      flush();
      need(2, "a GS command");
      const c = bytes[i + 1]!;
      if (c === 0x21) (need(3, "GS !"), events.push({ type: "size", width: (bytes[i + 2]! >> 4) + 1, height: (bytes[i + 2]! & 0x0f) + 1 }), (i += 3));
      else if (c === 0x56) (need(3, "GS V"), events.push({ type: "cut", partial: bytes[i + 2]! === 1 }), (i += 3));
      else if (c === 0x76) {
        need(8, "GS v 0");
        if (bytes[i + 2] !== 0x30) throw new Error(`unknown GS v mode at byte ${i}`);
        const rowBytes = bytes[i + 4]! | (bytes[i + 5]! << 8);
        const rows = bytes[i + 6]! | (bytes[i + 7]! << 8);
        need(8 + rowBytes * rows, "a raster image");
        events.push({ type: "raster", bitmap: { width: rowBytes * 8, height: rows, data: bytes.slice(i + 8, i + 8 + rowBytes * rows) } });
        i += 8 + rowBytes * rows;
      } else throw new Error(`unknown GS command 0x${c.toString(16)} at byte ${i}`);
    } else {
      text.push(b);
      i++;
    }
  }
  flush();
  return events;
}

/** Bands of one picture that follow each other are one picture again. */
export function mergeRasters(events: EscPosEvent[]): EscPosEvent[] {
  const out: EscPosEvent[] = [];
  for (const e of events) {
    const last = out.at(-1);
    if (e.type === "raster" && last?.type === "raster" && last.bitmap.width === e.bitmap.width) {
      const data = new Uint8Array(last.bitmap.data.length + e.bitmap.data.length);
      data.set(last.bitmap.data);
      data.set(e.bitmap.data, last.bitmap.data.length);
      out[out.length - 1] = { type: "raster", bitmap: { width: e.bitmap.width, height: last.bitmap.height + e.bitmap.height, data } };
    } else out.push(e);
  }
  return out;
}

/** The text a stream prints, one string per line (pictures show as "[image WxH]"). */
export function printedLines(events: EscPosEvent[]): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const e of mergeRasters(events)) {
    if (e.type === "text") cur += e.text;
    else if (e.type === "lf") (lines.push(cur), (cur = ""));
    else if (e.type === "raster") (cur && lines.push(cur), (cur = ""), lines.push(`[image ${e.bitmap.width}x${e.bitmap.height}]`));
  }
  if (cur) lines.push(cur);
  return lines;
}
