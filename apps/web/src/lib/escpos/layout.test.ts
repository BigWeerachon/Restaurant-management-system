import { describe, expect, it } from "vitest";
import type { Branch, Tenant, Ticket } from "../demo/types";
import { buildSampleReceipt } from "../receipt";
import { decodeEscPos, printedLines } from "./decode";
import { EscPos } from "./encoder";
import { blocksToEscPos, kitchenBlocks, layoutBlocks, receiptBlocks, slipFromTicket, wrapByMeasure, type FontSpec } from "./layout";
import { displayWidth } from "./thai";

const tenant: Tenant = { name: "ครัวคุณแม่", businessType: "restaurant", vatRegistered: true, pricesIncludeVat: true, vatRate: 0.07, cashRounding: "none", plan: "pro", trialEndsAt: "", onboarding: { skipped: [], paymentsConfirmed: false }, taxId: "1101700230708", legalName: "บริษัท ครัวคุณแม่ จำกัด", receiptFooter: "ขอบคุณค่ะ" };
const branch: Branch = { id: "b1", code: "HQ", name: "สาขาอารีย์", address: "12 ซ.อารีย์ กรุงเทพฯ 10400", phone: "02-000-0000", dayCutoff: "05:00", serviceChargeRate: 0, tables: [] };

const text = (cols: number, blocks = receiptBlocks(buildSampleReceipt({ tenant, branch }))) => printedLines(decodeEscPos(blocksToEscPos(blocks, new EscPos({ cols, codepage: 255 }).init()).bytes()));

describe("a receipt as text", () => {
  it.each([32, 48])("fits a %s-column roll: no line is wider than the paper", (cols) => {
    const lines = text(cols).filter((l) => !l.startsWith("[image"));
    expect(lines.length).toBeGreaterThan(15);
    // Doubled-size lines take two columns a letter, so measure those against half the paper.
    expect(lines.every((l) => displayWidth(l) <= cols)).toBe(true);
  });

  it("puts the amounts at the right edge and the total is its own, emphasised, doubled row", () => {
    const lines = text(48);
    const total = lines.find((l) => l.startsWith("ยอดสุทธิ"))!;
    expect(total.endsWith("205.00")).toBe(true);
    expect(displayWidth(total)).toBe(24); // doubled size: half the columns
    const item = lines.find((l) => l.includes("ชาไทยเย็น"))!;
    expect(item.endsWith("55.00")).toBe(true);
    expect(displayWidth(item)).toBe(48);
  });

  it("carries every fact of the receipt model", () => {
    const joined = text(48).join("\n");
    for (const s of ["บริษัท ครัวคุณแม่ จำกัด", "1-1017-00230-70-8", "ตัวอย่างใบเสร็จ", "ทดลองพิมพ์ - ไม่ใช่ใบเสร็จจริง", "2 x ข้าวกะเพราหมูสับ ไข่ดาว", "+ เผ็ดมาก", '"หวานน้อย"', "มูลค่าก่อนภาษี", "ภาษีมูลค่าเพิ่ม 7%", "ราคาสินค้ารวมภาษีมูลค่าเพิ่มแล้ว", "เงินทอน", "ขอบคุณค่ะ"]) expect(joined).toContain(s);
  });

  it("resets the size and emphasis after every block, so one big line never makes the rest big", () => {
    const events = decodeEscPos(blocksToEscPos(receiptBlocks(buildSampleReceipt({ tenant, branch })), new EscPos({ cols: 48 })).bytes());
    let size = 1;
    let bold = false;
    let lastText: string | null = null;
    for (const e of events) {
      if (e.type === "size") size = e.width;
      if (e.type === "bold") bold = e.on;
      if (e.type === "lf" && lastText === null) continue;
      lastText = e.type === "text" ? e.text : lastText;
    }
    expect(size).toBe(1);
    expect(bold).toBe(false);
  });
});

describe("a kitchen slip", () => {
  const ticket: Ticket = {
    id: "t1",
    branchId: "b1",
    orderId: "o1",
    stationId: "s1",
    ticketNo: "A12",
    status: "new",
    firedAt: "2026-09-29T05:40:00.000Z",
    channelName: "ทานที่ร้าน",
    channelKind: "dine_in",
    tableName: "A3",
    items: [
      { orderItemId: "i1", name: "ข้าวกะเพราหมูสับ", qty: 2, modifiers: "เผ็ดมาก · ไข่ดาว", note: "ไม่ใส่พริก", status: "pending" },
      { orderItemId: "i2", name: "ของที่ยกเลิก", qty: 1, modifiers: "", status: "voided" },
      { orderItemId: "i3", name: "ชาไทยเย็น", qty: 1, modifiers: "", status: "pending" },
    ],
  };

  it("names the table in big letters, then each item with its options and notes — leaving out what was voided", () => {
    const slip = slipFromTicket(ticket, "ครัวร้อน");
    expect(slip).toMatchObject({ stationName: "ครัวร้อน", ticketNo: "A12", table: "A3", channel: "ทานที่ร้าน", time: "12:40" });
    expect(slip.items).toEqual([
      { qty: 2, name: "ข้าวกะเพราหมูสับ", modifiers: "เผ็ดมาก · ไข่ดาว", note: "ไม่ใส่พริก" },
      { qty: 1, name: "ชาไทยเย็น", modifiers: undefined, note: undefined },
    ]);
    const lines = text(48, kitchenBlocks(slip));
    // (In text mode × and curly quotes are printed as x and " — the code page has no × and many printers no curly quotes.)
    expect(lines).toEqual(expect.arrayContaining(["ครัวร้อน", "โต๊ะ A3", "2 x ข้าวกะเพราหมูสับ", "   เผ็ดมาก - ไข่ดาว", '   "ไม่ใส่พริก"', "1 x ชาไทยเย็น"]));
    expect(lines.join("\n")).not.toContain("ของที่ยกเลิก");
    // The table is tripled in size; the items doubled.
    const events = decodeEscPos(blocksToEscPos(kitchenBlocks(slip), new EscPos({ cols: 48 })).bytes());
    expect(events.filter((e) => e.type === "size").map((e) => (e.type === "size" ? e.width : 0))).toContain(3);
  });

  it("names the channel when there is no table, and says when it is only what was added", () => {
    const lines = text(48, kitchenBlocks({ ticketNo: "7", channel: "GrabFood", time: "12:40", items: [{ qty: 1, name: "ชาไทย" }], banner: "เพิ่มรายการ" }));
    expect(lines).toEqual(expect.arrayContaining(["GrabFood", "*** เพิ่มรายการ ***"]));
  });
});

describe("laying a slip out as a picture", () => {
  const measure = (t: string, f: FontSpec) => [...t].length * f.px * 0.5;
  const plain = { px: 24, bold: false };

  it("wraps text to the width, keeps Thai runs whole where they fit and cuts long ones between clusters", () => {
    expect(wrapByMeasure("aaa bbb ccc", 60, plain, measure)).toEqual(["aaa", "bbb", "ccc"]); // 60 dots = 5 chars
    expect(wrapByMeasure("short", 600, plain, measure)).toEqual(["short"]);
    const cut = wrapByMeasure("ผู้ชายผู้หญิงผู้ใหญ่", 96, plain, measure); // 8 chars a line
    expect(cut.join("")).toBe("ผู้ชายผู้หญิงผู้ใหญ่");
    expect(cut.every((l) => !/^[ัิ-ฺ็-๎]/.test(l))).toBe(true);
  });

  it("centres, aligns rows to both edges, draws rules, and stacks lines downwards", () => {
    const layout = layoutBlocks([{ t: "text", text: "HELLO", align: "center" }, { t: "row", left: "Total", right: "12.00" }, { t: "rule" }, { t: "row", left: "Change", right: "1.00", bold: true }], { width: 384, measure });
    const texts = layout.ops.filter((o) => o.type === "text") as Extract<(typeof layout.ops)[number], { type: "text" }>[];
    const hello = texts.find((o) => o.text === "HELLO")!;
    expect(hello.x).toBe(Math.round((384 - 5 * 12) / 2));
    const total = texts.find((o) => o.text === "Total")!;
    const amount = texts.find((o) => o.text === "12.00")!;
    expect(total.x).toBe(4);
    expect(amount.x).toBe(384 - 4 - 5 * 12);
    expect(amount.y).toBe(total.y);
    expect(layout.ops.some((o) => o.type === "rule")).toBe(true);
    const ys = texts.map((o) => o.y);
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
    expect(layout.height).toBeGreaterThan(Math.max(...ys) + 24);
    expect(texts.find((o) => o.text === "Change")!.font.bold).toBe(true);
  });

  it("puts a long left side on several lines while the amount stays on the first", () => {
    const layout = layoutBlocks([{ t: "row", left: "a very long item name that will not fit on one line at all", right: "99.00" }], { width: 384, measure });
    const texts = layout.ops.filter((o) => o.type === "text") as Extract<(typeof layout.ops)[number], { type: "text" }>[];
    expect(texts.filter((o) => o.text !== "99.00").length).toBeGreaterThan(1);
    expect(texts.find((o) => o.text === "99.00")!.y).toBe(texts[0]!.y);
    const maxRight = Math.max(...texts.map((o) => o.x + measure(o.text, o.font)));
    expect(maxRight).toBeLessThanOrEqual(384 - 4);
  });

  it("scales type: a doubled line is twice as tall", () => {
    const layout = layoutBlocks([{ t: "text", text: "A", scale: 1 }, { t: "text", text: "B", scale: 2 }, { t: "text", text: "C" }], { width: 384, measure });
    const [a, b, c] = layout.ops as Extract<(typeof layout.ops)[number], { type: "text" }>[];
    expect(b!.font.px).toBe(2 * a!.font.px);
    expect(c!.y - b!.y).toBeGreaterThan((b!.y - a!.y) * 1.8);
  });
});
