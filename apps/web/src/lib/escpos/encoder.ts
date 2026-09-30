import { encodeCp874, padBetween, wrap } from "./thai";

/** A 1-bit picture, packed 8 pixels to a byte, most significant bit first, 1 = black. Rows are `Math.ceil(width / 8)` bytes. */
export interface Bitmap {
  width: number;
  height: number;
  data: Uint8Array;
}

export type Align = "left" | "center" | "right";

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

/** Tall pictures go out in bands: some printers have a small receive buffer and drop what does not fit. */
const BAND_ROWS = 128;

export interface EncoderOptions {
  /** Printable width in characters of the printer's normal font (32 for 58 mm, 48 for 80 mm). */
  cols: number;
  /** The number `ESC t` needs to select a Thai code page on this printer. Only used when text is sent as text. */
  codepage?: number;
}

/**
 * Builds the byte stream of an ESC/POS receipt printer (Epson's command set, which nearly every thermal printer
 * speaks). Only what a till needs: text, alignment, emphasis, size, a picture, feeding, cutting and the cash drawer.
 */
export class EscPos {
  private out: number[] = [];
  readonly cols: number;
  private readonly codepage: number | undefined;

  constructor(opts: EncoderOptions) {
    this.cols = opts.cols;
    this.codepage = opts.codepage;
  }

  private push(...bytes: number[]) {
    for (const b of bytes) this.out.push(b);
    return this;
  }

  /** ESC @ (reset to defaults), then the Thai code page if one was given. */
  init() {
    this.push(ESC, 0x40);
    if (this.codepage !== undefined) this.push(ESC, 0x74, this.codepage & 0xff);
    return this;
  }

  align(a: Align) {
    return this.push(ESC, 0x61, a === "left" ? 0 : a === "center" ? 1 : 2);
  }

  bold(on: boolean) {
    return this.push(ESC, 0x45, on ? 1 : 0);
  }

  /** Character size, 1× to 4× each way (GS !). */
  size(width: 1 | 2 | 3 | 4, height: 1 | 2 | 3 | 4) {
    return this.push(GS, 0x21, ((width - 1) << 4) | (height - 1));
  }

  /** Text in the printer's Thai code page, no line break. */
  text(s: string) {
    for (const b of encodeCp874(s)) this.out.push(b);
    return this;
  }

  line(s = "") {
    return this.text(s).push(LF);
  }

  /** As many lines as it takes, none wider than the paper. */
  wrapped(s: string) {
    for (const l of wrap(s, this.cols)) this.line(l);
    return this;
  }

  rule(ch = "-") {
    return this.line(ch.repeat(this.cols));
  }

  /** `left` at the left edge and `right` at the right edge of one line. */
  columns(left: string, right: string) {
    return this.line(padBetween(left, right, this.cols));
  }

  feed(lines: number) {
    return this.push(ESC, 0x64, Math.min(Math.max(lines, 0), 255));
  }

  /** Feeds the paper past the cutter, then cuts (GS V: 0 = all the way, 1 = leaves a small tab). */
  cut(partial = true) {
    return this.feed(4).push(GS, 0x56, partial ? 1 : 0);
  }

  /** Pulse the cash drawer's solenoid (ESC p): pin 0 or 1, on for `onMs` and off for `offMs` (units of 2 ms). */
  drawer(pin: 0 | 1 = 0, onMs = 50, offMs = 500) {
    return this.push(ESC, 0x70, pin, Math.min(Math.round(onMs / 2), 255), Math.min(Math.round(offMs / 2), 255));
  }

  /** A picture (GS v 0), in bands so that no printer's buffer is overrun. */
  raster(bitmap: Bitmap) {
    const rowBytes = Math.ceil(bitmap.width / 8);
    for (let y = 0; y < bitmap.height; y += BAND_ROWS) {
      const rows = Math.min(BAND_ROWS, bitmap.height - y);
      this.push(GS, 0x76, 0x30, 0, rowBytes & 0xff, (rowBytes >> 8) & 0xff, rows & 0xff, (rows >> 8) & 0xff);
      const start = y * rowBytes;
      for (let i = 0; i < rows * rowBytes; i++) this.out.push(bitmap.data[start + i]!);
    }
    return this;
  }

  bytes(): Uint8Array {
    return Uint8Array.from(this.out);
  }
}

/** Packs an RGBA picture into a 1-bit bitmap: a pixel is black where it is dark and opaque. `threshold` is 0–255 luminance. */
export function packBitmap(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, threshold = 160): Bitmap {
  const rowBytes = Math.ceil(width / 8);
  const data = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const alpha = rgba[i + 3]! / 255;
      // Composite over white: paper is white, so a transparent pixel is not ink.
      const lum = (0.299 * rgba[i]! + 0.587 * rgba[i + 1]! + 0.114 * rgba[i + 2]!) * alpha + 255 * (1 - alpha);
      if (lum < threshold) data[y * rowBytes + (x >> 3)]! |= 0x80 >> (x & 7);
    }
  }
  return { width, height, data };
}
