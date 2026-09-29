import { describe, expect, it } from "vitest";
import { decodeEscPos, mergeRasters, printedLines } from "./decode";
import { EscPos, packBitmap } from "./encoder";
import { encodeCp874 } from "./thai";
import { Cp874 } from "./thai-decode";

const hex = (b: Uint8Array | number[]) => [...b].map((x) => x.toString(16).padStart(2, "0")).join(" ");

describe("ESC/POS commands", () => {
  it("initialises and picks the Thai code page", () => {
    expect(hex(new EscPos({ cols: 48, codepage: 255 }).init().bytes())).toBe("1b 40 1b 74 ff");
    expect(hex(new EscPos({ cols: 48 }).init().bytes())).toBe("1b 40"); // no page chosen: the printer's own
  });

  it("aligns, embolds and sizes", () => {
    const e = new EscPos({ cols: 48 });
    e.align("left").align("center").align("right").bold(true).bold(false).size(1, 1).size(2, 2).size(4, 3);
    expect(hex(e.bytes())).toBe("1b 61 00 1b 61 01 1b 61 02 1b 45 01 1b 45 00 1d 21 00 1d 21 11 1d 21 32");
  });

  it("feeds, cuts (feeding first so the last line clears the blade) and pulses the drawer", () => {
    expect(hex(new EscPos({ cols: 48 }).feed(3).bytes())).toBe("1b 64 03");
    expect(hex(new EscPos({ cols: 48 }).cut().bytes())).toBe("1b 64 04 1d 56 01");
    expect(hex(new EscPos({ cols: 48 }).cut(false).bytes())).toBe("1b 64 04 1d 56 00");
    // 50 ms on, 500 ms off, in the printer's 2 ms units; pin 0 is the usual drawer connector.
    expect(hex(new EscPos({ cols: 48 }).drawer().bytes())).toBe("1b 70 00 19 fa");
    expect(hex(new EscPos({ cols: 48 }).drawer(1, 100, 200).bytes())).toBe("1b 70 01 32 64");
  });

  it("clamps what does not fit a byte", () => {
    expect(hex(new EscPos({ cols: 48 }).feed(999).bytes())).toBe("1b 64 ff");
    expect(hex(new EscPos({ cols: 48 }).drawer(0, 9999, 9999).bytes())).toBe("1b 70 00 ff ff");
  });

  it("writes lines, rules and left/right columns to the paper width", () => {
    const e = new EscPos({ cols: 20 });
    e.line("abc").rule("=").columns("Total", "12.00");
    const lines = printedLines(decodeEscPos(e.bytes()));
    expect(lines).toEqual(["abc", "=".repeat(20), "Total" + " ".repeat(10) + "12.00"]);
    expect(lines.every((l) => l.length <= 20)).toBe(true);
  });
});

describe("Thai in the printer's code page", () => {
  it("maps Thai letters, vowels, tone marks and ฿ to their Windows-874 bytes", () => {
    expect(hex(encodeCp874("กขค"))).toBe("a1 a2 a4"); // ก ข (ฃ is a3) ค
    expect(hex(encodeCp874("ฮ"))).toBe("ce"); // U+0E2E
    expect(hex(encodeCp874("ะ่๋"))).toBe("d0 e8 eb"); // sara a, mai ek, mai jattawa
    expect(hex(encodeCp874("฿"))).toBe("df");
    expect(hex(encodeCp874("๙"))).toBe("f9");
    expect(hex(encodeCp874("Total 12.00"))).toBe(hex([...Buffer.from("Total 12.00")]));
  });

  it("writes punctuation the code page may lack as its plain look-alike (and × as x)", () => {
    expect(Cp874.decode(encodeCp874("2 × “ก” — ‘ข’ · …"))).toBe('2 x "ก" - \'ข\' - ...');
  });

  it("replaces what the page has no character for with ?", () => {
    expect(hex(encodeCp874("☕ 😀"))).toBe("3f 20 3f");
  });

  it("round-trips a Thai sentence", () => {
    const s = "ข้าวกะเพราหมูสับ ไข่ดาว ฿75.00 ๒๕๖๙";
    expect(Cp874.decode(encodeCp874(s))).toBe(s);
  });

  it("sends text in the chosen page: init + text + line feed reads back as the same words", () => {
    const e = new EscPos({ cols: 32, codepage: 255 }).init().line("ขอบคุณที่มาอุดหนุน");
    const events = decodeEscPos(e.bytes());
    expect(events).toEqual([{ type: "init" }, { type: "codepage", n: 255 }, { type: "text", text: "ขอบคุณที่มาอุดหนุน" }, { type: "lf" }]);
  });
});

describe("pictures", () => {
  it("packs pixels 8 to a byte, most significant bit first, black = 1, padding with white", () => {
    // 10 px wide, 2 rows: row 0 = black, black, white, ... row 1 = all white but the last (10th) pixel black
    const w = 10;
    const rgba = new Uint8ClampedArray(w * 2 * 4).fill(255);
    const black = (x: number, y: number) => rgba.fill(0, (y * w + x) * 4, (y * w + x) * 4 + 3);
    black(0, 0);
    black(1, 0);
    black(9, 1);
    const bmp = packBitmap(rgba, w, 2);
    expect(bmp.width).toBe(10);
    expect(bmp.height).toBe(2);
    expect(hex(bmp.data)).toBe("c0 00 00 40");
  });

  it("treats transparent pixels as paper, and grey by its darkness", () => {
    const rgba = new Uint8ClampedArray([0, 0, 0, 0, 200, 200, 200, 255, 100, 100, 100, 255, 0, 0, 0, 255]);
    expect(hex(packBitmap(rgba, 4, 1).data)).toBe("30"); // transparent: white; light grey: white; dark grey: black; black: black
  });

  it("goes out as GS v 0 in bands of at most 128 rows, which read back as the same picture", () => {
    const width = 16;
    const height = 300;
    const data = new Uint8Array((width / 8) * height).map((_, i) => (i * 37) & 0xff);
    const bytes = new EscPos({ cols: 48 }).raster({ width, height, data }).bytes();
    const events = decodeEscPos(bytes);
    expect(events.map((e) => e.type)).toEqual(["raster", "raster", "raster"]);
    expect(events.map((e) => (e.type === "raster" ? e.bitmap.height : 0))).toEqual([128, 128, 44]);
    const merged = mergeRasters(events);
    expect(merged).toHaveLength(1);
    const m = merged[0]!;
    expect(m.type === "raster" && m.bitmap.height).toBe(300);
    expect(m.type === "raster" && hex(m.bitmap.data) === hex(data)).toBe(true);
  });

  it("the header of a picture says its width in bytes and its rows, little-endian", () => {
    const bytes = new EscPos({ cols: 48 }).raster({ width: 576, height: 3, data: new Uint8Array(72 * 3) }).bytes();
    expect(hex(bytes.slice(0, 8))).toBe("1d 76 30 00 48 00 03 00");
  });
});

describe("the decoder itself", () => {
  it("refuses a stream a printer would choke on", () => {
    expect(() => decodeEscPos(Uint8Array.from([0x1b, 0x99]))).toThrow(/unknown ESC/);
    expect(() => decodeEscPos(Uint8Array.from([0x1d, 0x99, 0x00]))).toThrow(/unknown GS/);
    expect(() => decodeEscPos(Uint8Array.from([0x1d, 0x76, 0x30, 0x00, 0x02, 0x00, 0x02, 0x00, 0xff]))).toThrow(/ends inside a raster image/);
    expect(() => decodeEscPos(Uint8Array.from([0x1b, 0x70, 0x00]))).toThrow(/ends inside ESC p/);
  });
});
