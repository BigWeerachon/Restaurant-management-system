/**
 * A slip as a list of blocks — centred lines, left/right rows, rules, gaps — and the two ways of putting it on a
 * thermal printer: as text in the printer's own Thai code page, or as a picture drawn here (`raster.ts`). Blocks are
 * plain data, so what a receipt or a kitchen slip says is settled (and tested) before any printer is involved.
 */
import type { ReceiptData } from "../receipt";
import type { Ticket } from "../demo/types";
import { EscPos, type Align } from "./encoder";
import { displayWidth, padBetween, wrap } from "./thai";

export type Block =
  | { t: "text"; text: string; align?: Align; bold?: boolean; scale?: 1 | 2 | 3 }
  | { t: "row"; left: string; right: string; bold?: boolean; scale?: 1 | 2 }
  | { t: "rule"; ch?: "-" | "=" }
  | { t: "gap"; lines?: number };

// ---------------------------------------------------------------------------
// What each slip says
// ---------------------------------------------------------------------------
export function receiptBlocks(data: ReceiptData): Block[] {
  const { seller, meta } = data;
  const b: Block[] = [{ t: "text", text: seller.legalName ?? seller.name, align: "center", bold: true, scale: 2 }];
  if (seller.legalName) b.push({ t: "text", text: seller.name, align: "center" });
  if (seller.branchLabel) b.push({ t: "text", text: seller.branchLabel, align: "center" });
  if (seller.address) b.push({ t: "text", text: seller.address, align: "center" });
  if (seller.phone) b.push({ t: "text", text: `โทร ${seller.phone}`, align: "center" });
  if (seller.taxId) b.push({ t: "text", text: `เลขประจำตัวผู้เสียภาษี ${seller.taxId}`, align: "center" });
  b.push({ t: "gap", lines: 1 }, { t: "text", text: data.title, align: "center", bold: true });
  if (data.banner) b.push({ t: "text", text: `*** ${data.banner} ***`, align: "center", bold: true });
  b.push({ t: "rule" });
  if (meta.receiptNo) b.push({ t: "row", left: "เลขที่", right: meta.receiptNo });
  b.push({ t: "row", left: "บิล", right: `#${meta.orderNo}` }, { t: "row", left: "วันที่", right: `${meta.date} ${meta.time}` });
  const where = [meta.channel, meta.table ? `โต๊ะ ${meta.table}` : ""].filter(Boolean).join(" · ");
  if (where) b.push({ t: "row", left: "ช่องทาง", right: where });
  if (meta.cashier) b.push({ t: "row", left: "พนักงาน", right: meta.cashier });
  b.push({ t: "rule" });
  for (const l of data.lines) {
    b.push({ t: "row", left: `${l.qty} × ${l.name}`, right: l.amount });
    for (const m of l.modifiers) b.push({ t: "text", text: `   + ${m}` });
    if (l.note) b.push({ t: "text", text: `   “${l.note}”` });
  }
  b.push({ t: "rule" });
  for (const r of data.summary) b.push({ t: "row", left: r.label, right: r.amount, bold: r.strong, scale: r.strong ? 2 : 1 });
  if (data.payments.length) {
    b.push({ t: "rule" });
    for (const r of data.payments) b.push({ t: "row", left: r.label, right: r.amount });
  }
  for (const n of data.notes) b.push({ t: "text", text: n, align: "center" });
  b.push({ t: "gap", lines: 1 });
  for (const f of data.footer) b.push({ t: "text", text: f, align: "center" });
  return b;
}

/** What the kitchen needs to cook, and nothing else: where it goes, what, how, and since when. */
export interface KitchenSlip {
  stationName?: string;
  ticketNo: string;
  channel: string;
  table?: string;
  time: string;
  items: { qty: number; name: string; modifiers?: string; note?: string }[];
  /** Order-level note. */
  note?: string;
  /** "เพิ่มรายการ" when the slip is only the items added to a bill already in the kitchen. */
  banner?: string;
}

export function kitchenBlocks(slip: KitchenSlip): Block[] {
  const b: Block[] = [];
  if (slip.stationName) b.push({ t: "text", text: slip.stationName, align: "center", bold: true });
  b.push({ t: "text", text: slip.table ? `โต๊ะ ${slip.table}` : slip.channel, align: "center", bold: true, scale: 3 });
  b.push({ t: "row", left: `#${slip.ticketNo}`, right: slip.time });
  if (slip.table) b.push({ t: "text", text: slip.channel });
  if (slip.banner) b.push({ t: "text", text: `*** ${slip.banner} ***`, align: "center", bold: true });
  b.push({ t: "rule", ch: "=" });
  for (const i of slip.items) {
    b.push({ t: "text", text: `${i.qty} × ${i.name}`, bold: true, scale: 2 });
    if (i.modifiers) b.push({ t: "text", text: `   ${i.modifiers}` });
    if (i.note) b.push({ t: "text", text: `   “${i.note}”`, bold: true });
    b.push({ t: "gap", lines: 0.5 });
  }
  if (slip.note) b.push({ t: "rule" }, { t: "text", text: slip.note, bold: true });
  return b;
}

/** A KDS ticket as a slip. */
export function slipFromTicket(t: Ticket, stationName?: string): KitchenSlip {
  return {
    stationName,
    ticketNo: t.ticketNo,
    channel: t.channelName,
    table: t.tableName,
    time: new Date(t.firedAt).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Bangkok" }),
    items: t.items.filter((i) => i.status !== "voided").map((i) => ({ qty: i.qty, name: i.name, modifiers: i.modifiers || undefined, note: i.note })),
  };
}

// ---------------------------------------------------------------------------
// As text, in the printer's own code page
// ---------------------------------------------------------------------------
/** Scaled text takes `scale` columns per character, so a doubled line has half the room. */
const colsFor = (cols: number, scale: number) => Math.max(Math.floor(cols / scale), 1);

export function blocksToEscPos(blocks: Block[], e: EscPos): EscPos {
  for (const blk of blocks) {
    if (blk.t === "gap") e.feed(Math.max(Math.round(blk.lines ?? 1), 1));
    else if (blk.t === "rule") e.rule(blk.ch ?? "-");
    else if (blk.t === "text") {
      const scale = blk.scale ?? 1;
      const cols = colsFor(e.cols, scale);
      e.align(blk.align ?? "left");
      if (blk.bold) e.bold(true);
      if (scale > 1) e.size(scale, scale);
      for (const l of wrap(blk.text, cols)) e.line(l);
      if (scale > 1) e.size(1, 1);
      if (blk.bold) e.bold(false);
      e.align("left");
    } else {
      const scale = blk.scale ?? 1;
      const cols = colsFor(e.cols, scale);
      if (blk.bold) e.bold(true);
      if (scale > 1) e.size(scale, scale);
      const rw = displayWidth(blk.right);
      const leftLines = wrap(blk.left, Math.max(cols - rw - 1, 8));
      leftLines.forEach((l, i) => e.line(i === 0 ? padBetween(l, blk.right, cols) : l));
      if (scale > 1) e.size(1, 1);
      if (blk.bold) e.bold(false);
    }
  }
  return e;
}

// ---------------------------------------------------------------------------
// As a picture: where everything goes, before any pixel is drawn
// ---------------------------------------------------------------------------
export interface FontSpec {
  px: number;
  bold: boolean;
}

export type DrawOp = { type: "text"; x: number; y: number; text: string; font: FontSpec } | { type: "rule"; y: number; ch: "-" | "=" };

export interface Layout {
  width: number;
  height: number;
  ops: DrawOp[];
}

export interface LayoutOptions {
  width: number;
  /** Width in dots of `text` set in `font`. */
  measure: (text: string, font: FontSpec) => number;
  /** Type size in dots at scale 1: 24 is the printer's normal character height. */
  basePx?: number;
}

const LINE = 1.32;
const MARGIN = 4;
/** Extra room above the first line: Thai tone marks and vowels rise above the letters and must not be clipped by the edge of the picture. */
const TOP = 6;

/** Breaks `text` into lines no wider than `maxWidth` dots, at spaces where there are any and between letters where there are not. */
export function wrapByMeasure(text: string, maxWidth: number, font: FontSpec, measure: LayoutOptions["measure"]): string[] {
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    const push = () => {
      out.push(line.trimEnd());
      line = "";
    };
    /** A run longer than a whole line (Thai has no spaces): cut it, keeping a letter with the marks stacked on it. */
    const cut = (word: string) => {
      let piece = "";
      for (const cluster of clusters(word)) {
        if (piece && measure(piece + cluster, font) > maxWidth) {
          out.push(piece);
          piece = "";
        }
        piece += cluster;
      }
      line = piece;
    };
    for (const word of paragraph.split(/(?<= )/)) {
      if (line !== "" && measure(line + word, font) <= maxWidth) line += word;
      else {
        if (line !== "") push();
        if (measure(word, font) <= maxWidth) line = word;
        else cut(word);
      }
    }
    if (line || paragraph === "") push();
  }
  return out;
}

/** Letters with the vowels and tone marks that sit on them, so a cut never separates a mark from its letter. */
function clusters(text: string): string[] {
  const out: string[] = [];
  for (const ch of text) {
    const u = ch.codePointAt(0)!;
    const combining = u === 0x0e31 || (u >= 0x0e34 && u <= 0x0e3a) || (u >= 0x0e47 && u <= 0x0e4e);
    if (combining && out.length) out[out.length - 1] += ch;
    else out.push(ch);
  }
  return out;
}

export function layoutBlocks(blocks: Block[], { width, measure, basePx = 24 }: LayoutOptions): Layout {
  const ops: DrawOp[] = [];
  const inner = width - MARGIN * 2;
  let y = MARGIN + TOP;
  for (const blk of blocks) {
    if (blk.t === "gap") {
      y += Math.round(basePx * (blk.lines ?? 1) * 0.6);
    } else if (blk.t === "rule") {
      ops.push({ type: "rule", y: y + Math.round(basePx * 0.5), ch: blk.ch ?? "-" });
      y += Math.round(basePx * 0.9);
    } else if (blk.t === "text") {
      const font: FontSpec = { px: basePx * (blk.scale ?? 1), bold: !!blk.bold };
      for (const l of wrapByMeasure(blk.text, inner, font, measure)) {
        const w = measure(l, font);
        const x = blk.align === "center" ? Math.round((width - w) / 2) : blk.align === "right" ? width - MARGIN - w : MARGIN;
        ops.push({ type: "text", x, y, text: l, font });
        y += Math.round(font.px * LINE);
      }
    } else {
      const font: FontSpec = { px: basePx * (blk.scale ?? 1), bold: !!blk.bold };
      const rw = measure(blk.right, font);
      const leftLines = wrapByMeasure(blk.left, Math.max(inner - rw - Math.round(basePx * 0.5), inner / 3), font, measure);
      leftLines.forEach((l, i) => {
        ops.push({ type: "text", x: MARGIN, y, text: l, font });
        if (i === 0) ops.push({ type: "text", x: width - MARGIN - rw, y, text: blk.right, font });
        y += Math.round(font.px * LINE);
      });
    }
  }
  return { width, height: y + MARGIN * 2, ops };
}
