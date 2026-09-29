import { describe, expect, it } from "vitest";
import { displayWidth, padBetween, wrap } from "./thai";

describe("columns on a thermal printer", () => {
  it("counts a Thai letter as one column and the vowel or tone mark stacked on it as none", () => {
    expect(displayWidth("abc")).toBe(3);
    expect(displayWidth("กา")).toBe(2);
    expect(displayWidth("ก่")).toBe(1); // ก + mai ek
    expect(displayWidth("น้ำ")).toBe(2); // น + mai tho + sara am (sara am takes a column)
    expect(displayWidth("ข้าวกะเพรา")).toBe(9); // 10 code points, one of them a stacked tone mark
    expect(displayWidth("ผู้ชาย")).toBe(4);
  });

  it("wraps at spaces, and never wider than the paper", () => {
    expect(wrap("one two three four", 9)).toEqual(["one two", "three", "four"]);
    expect(wrap("abc", 10)).toEqual(["abc"]);
    expect(wrap("a\nb", 10)).toEqual(["a", "b"]);
  });

  it("cuts a long run with no spaces (Thai) at the column limit, and never between a letter and its mark", () => {
    const lines = wrap("ผู้ชายผู้หญิงผู้ใหญ่", 6);
    expect(lines.every((l) => displayWidth(l) <= 6)).toBe(true);
    expect(lines.join("")).toBe("ผู้ชายผู้หญิงผู้ใหญ่");
    // A line never starts with a stacked mark.
    expect(lines.every((l) => !/^[ัิ-ฺ็-๎]/.test(l))).toBe(true);
  });

  it("puts one thing at each edge of a line, and keeps the right side when they do not fit", () => {
    expect(padBetween("Total", "12.00", 16)).toBe("Total      12.00");
    expect(padBetween("ก่อน", "5.00", 10)).toHaveLength(10 + 1); // "ก่อน" is 3 columns wide but 4 code points
    const tight = padBetween("a very long item name", "99.00", 20);
    expect(tight.endsWith("99.00")).toBe(true);
    expect(displayWidth(tight)).toBe(20);
  });
});
