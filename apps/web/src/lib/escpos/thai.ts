/**
 * Thai text for a thermal printer's own character set (checklist 7.2, "text" mode).
 *
 * Printers do not speak Unicode: they take one byte per character from a code page, and for Thai that is TIS-620 /
 * Windows-874. The bytes are the same for every Thai code page the printer offers; which page number selects it
 * (`ESC t n`) differs by make, which is why it is a setting and why "image" mode exists as the safe default.
 */

/**
 * Punctuation the Thai code pages do not all have, written the way a printer can print it: curly quotes and dashes
 * become their ASCII look-alikes (the slot Windows-874 gives them, 0x80–0x9F, is empty on many printers).
 */
const LOOKALIKE: Record<number, string> = {
  0x00d7: "x", // ×
  0x00b7: "-", // ·
  0x2018: "'",
  0x2019: "'",
  0x201c: '"',
  0x201d: '"',
  0x2013: "-",
  0x2014: "-",
  0x2022: "*",
  0x2026: "...",
};

/** Windows-874: U+0E01…U+0E3A → A1…DA, ฿ → DF, U+0E40…U+0E5B → E0…FB, ASCII as it is. Anything else → "?". */
export function encodeCp874(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    const u = ch.codePointAt(0)!;
    if (LOOKALIKE[u] !== undefined) {
      for (const c of LOOKALIKE[u]!) out.push(c.charCodeAt(0));
    } else if (u === 0x0a) out.push(0x0a);
    else if (u >= 0x20 && u <= 0x7e) out.push(u);
    else if (u >= 0x0e01 && u <= 0x0e3a) out.push(0xa1 + (u - 0x0e01));
    else if (u === 0x0e3f) out.push(0xdf);
    else if (u >= 0x0e40 && u <= 0x0e5b) out.push(0xe0 + (u - 0x0e40));
    else if (u === 0x00a0) out.push(0xa0);
    else if (u === 0x20ac) out.push(0x80);
    else out.push(0x3f);
  }
  return out;
}

/** Thai vowels and tone marks that sit above or below a consonant: they take no column of their own. */
const isCombining = (u: number) => u === 0x0e31 || (u >= 0x0e34 && u <= 0x0e3a) || (u >= 0x0e47 && u <= 0x0e4e);

/** How many printer columns a string takes: combining Thai marks are stacked on the previous letter, everything else is one. */
export function displayWidth(text: string): number {
  let n = 0;
  for (const ch of text) if (!isCombining(ch.codePointAt(0)!)) n++;
  return n;
}

/**
 * Breaks a string into lines no wider than `cols`, at spaces where there are any. Thai has no spaces between words, so
 * a long run is cut at the column limit — never between a letter and the mark stacked on it.
 */
export function wrap(text: string, cols: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    let width = 0;
    const flush = () => {
      lines.push(line.trimEnd());
      line = "";
      width = 0;
    };
    for (const word of paragraph.split(/(?<= )/)) {
      const w = displayWidth(word);
      if (width + w <= cols || width === 0 && w <= cols) {
        line += word;
        width += w;
        continue;
      }
      if (width > 0) flush();
      if (w <= cols) {
        line = word;
        width = w;
        continue;
      }
      // A single run wider than a line: cut it by columns.
      for (const ch of word) {
        const cw = displayWidth(ch);
        if (width + cw > cols) flush();
        line += ch;
        width += cw;
      }
    }
    if (line || paragraph === "") flush();
  }
  return lines;
}

/** Pads `left` and `right` apart to exactly `cols` columns (the right side wins if they do not fit; the left is cut). */
export function padBetween(left: string, right: string, cols: number): string {
  const rw = displayWidth(right);
  const room = Math.max(cols - rw - 1, 0);
  let l = left;
  if (displayWidth(l) > room) {
    let cut = "";
    let w = 0;
    for (const ch of l) {
      const cw = displayWidth(ch);
      if (w + cw > room) break;
      cut += ch;
      w += cw;
    }
    l = cut;
  }
  return l + " ".repeat(Math.max(cols - displayWidth(l) - rw, 1)) + right;
}
