import { describe, expect, it } from "vitest";
import { formatThaiTaxId, isValidThaiTaxId, taxBranchLabel } from "../src/tax";

describe("Thai taxpayer id", () => {
  it("accepts numbers whose check digit is right", () => {
    // 0105536000000? build valid ones with the rule: weights 13..2, check = (11 - sum % 11) % 10
    const make = (twelve: string) => {
      let sum = 0;
      for (let i = 0; i < 12; i++) sum += Number(twelve[i]) * (13 - i);
      return twelve + String((11 - (sum % 11)) % 10);
    };
    for (const twelve of ["010553600123", "123456789012", "310045678901", "000000000001"]) expect(isValidThaiTaxId(make(twelve))).toBe(true);
    expect(isValidThaiTaxId("1101700230708")).toBe(true); // a real-format example with a correct check digit
  });

  it("rejects a mistyped digit, the wrong length, and anything that is not digits", () => {
    expect(isValidThaiTaxId("1101700230705")).toBe(false);
    expect(isValidThaiTaxId("110170023070")).toBe(false);
    expect(isValidThaiTaxId("11017002307083")).toBe(false);
    expect(isValidThaiTaxId("1-1017-00230-70-8")).toBe(false);
    expect(isValidThaiTaxId("abcdefghijklm")).toBe(false);
    expect(isValidThaiTaxId("")).toBe(false);
  });

  it("prints it the way it is written on a tax document", () => {
    expect(formatThaiTaxId("1101700230708")).toBe("1-1017-00230-70-8");
    expect(formatThaiTaxId("123")).toBe("123");
  });

  it("names the branch as tax documents do: 00000 is the head office", () => {
    expect(taxBranchLabel("00000")).toBe("สำนักงานใหญ่");
    expect(taxBranchLabel(undefined)).toBe("สำนักงานใหญ่");
    expect(taxBranchLabel("00012")).toBe("สาขาที่ 00012");
    expect(taxBranchLabel("12")).toBe("สำนักงานใหญ่");
  });
});
