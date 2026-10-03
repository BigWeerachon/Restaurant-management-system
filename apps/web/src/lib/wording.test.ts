import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The words staff read follow one glossary (docs/02-ux-principles.md §8 Copywriting). This keeps the replaced words
 * from coming back: it reads every web and domain source file (tests aside) and fails on a word the glossary retired.
 */
const ROOT = join(__dirname, "../../../..");
const SOURCES = ["apps/web/src", "packages/domain/src"];

const RETIRED: { word: RegExp; use: string }[] = [
  { word: /เปิดวันใหม่/, use: "เปิดยอดอีกครั้ง (“เปิดวันใหม่” reads as starting a new day)" },
  { word: /กำไรจริง/, use: "เงินเหลือจริง" },
  { word: /ช่องทางรับเงิน|ช่องทางชำระเงิน/, use: "วิธีรับเงิน" },
  { word: /ลองใหม่อีกครั้ง/, use: "ลองอีกครั้ง" },
  { word: /ที่ระบบคาด/, use: "ควรมี" },
  { word: /ได้รับแจ้งแล้ว/, use: "nothing — no one is alerted yet; say what the person should do instead" },
  // "ถูก…" only for things that went wrong for the reader (ถูกลบ, ถูกยกเลิก); ordinary events are said plainly.
  { word: /ถูก(บันทึก|ปิด|ส่ง|ใช้|เพิ่ม|ซ่อน|แทนที่|จับคู่|เปลี่ยน|แก้ไข|พิมพ์|ตัด|ปรับ|ชำระ|คืนเงิน)/, use: "the active form (“เมนูนี้ปิดขายแล้ว”, not “ถูกปิดขาย”)" },
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

describe("wording", () => {
  it("uses the glossary's word, not a retired one, in every screen and message", () => {
    const found: string[] = [];
    for (const file of SOURCES.flatMap((s) => files(join(ROOT, s)))) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          for (const { word, use } of RETIRED) {
            const hit = line.match(word);
            if (hit) found.push(`${relative(ROOT, file)}:${i + 1} “${hit[0]}” → use ${use}`);
          }
        });
    }
    expect(found).toEqual([]);
  });
});
