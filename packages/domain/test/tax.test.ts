import { describe, expect, it } from "vitest";
import { amountBeforeVat, bahtText, checkTaxInvoiceBuyer, formatThaiTaxId, isValidThaiTaxId, taxBranchLabel } from "../src/tax";

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

describe("the amount before VAT on a tax document", () => {
  it("takes the VAT out of prices that include it, and leaves prices that do not", () => {
    // 107.00 incl. 7.00 VAT
    expect(amountBeforeVat({ itemsTotal: 10700, discountTotal: 0, serviceCharge: 0, vatAmount: 700, pricesIncludeVat: true })).toBe(10000);
    // The same bill the database test issues an invoice for (145.00 with 9.49 VAT inside): 135.51 before VAT.
    expect(amountBeforeVat({ itemsTotal: 14500, discountTotal: 0, serviceCharge: 0, vatAmount: 949, pricesIncludeVat: true })).toBe(13551);
    // 100.00 + 7.00 VAT on top
    expect(amountBeforeVat({ itemsTotal: 10000, discountTotal: 0, serviceCharge: 0, vatAmount: 700, pricesIncludeVat: false })).toBe(10000);
  });

  it("counts discount and service charge the way the receipt does", () => {
    expect(amountBeforeVat({ itemsTotal: 20000, discountTotal: 2000, serviceCharge: 1800, vatAmount: 1273, pricesIncludeVat: true })).toBe(18527);
    expect(amountBeforeVat({ itemsTotal: 20000, discountTotal: 2000, serviceCharge: 1800, vatAmount: 1386, pricesIncludeVat: false })).toBe(19800);
  });
});

describe("a buyer on a full tax invoice", () => {
  const ok = { name: "บริษัท ตัวอย่าง จำกัด", taxId: "1101700230708", address: "99 ถ.สุขุมวิท กรุงเทพฯ 10110", branchNo: "00000" };
  it("passes when everything is right", () => expect(checkTaxInvoiceBuyer(ok)).toEqual({}));
  it("names each thing that is wrong", () => {
    expect(Object.keys(checkTaxInvoiceBuyer({ name: " ", taxId: "1101700230705", address: "", branchNo: "12" })).sort()).toEqual(["address", "branchNo", "name", "taxId"]);
  });
  it("does not insist on a branch number when none is given", () => expect(checkTaxInvoiceBuyer({ ...ok, branchNo: undefined })).toEqual({}));
  it("limits the length of free text", () => {
    expect(checkTaxInvoiceBuyer({ ...ok, name: "ก".repeat(201) }).name).toBeDefined();
    expect(checkTaxInvoiceBuyer({ ...ok, address: "ก".repeat(401) }).address).toBeDefined();
  });
});

describe("an amount in Thai words", () => {
  it.each([
    [14500, "หนึ่งร้อยสี่สิบห้าบาทถ้วน"],
    [100, "หนึ่งบาทถ้วน"],
    [1100, "สิบเอ็ดบาทถ้วน"],
    [1000, "สิบบาทถ้วน"],
    [2000, "ยี่สิบบาทถ้วน"],
    [2100, "ยี่สิบเอ็ดบาทถ้วน"],
    [10100, "หนึ่งร้อยเอ็ดบาทถ้วน"],
    [13551, "หนึ่งร้อยสามสิบห้าบาทห้าสิบเอ็ดสตางค์"],
    [25, "ยี่สิบห้าสตางค์"],
    [1, "หนึ่งสตางค์"],
    [0, "ศูนย์บาทถ้วน"],
    [1234567, "หนึ่งหมื่นสองพันสามร้อยสี่สิบห้าบาทหกสิบเจ็ดสตางค์"],
    [100_000_000, "หนึ่งล้านบาทถ้วน"],
    [100_000_100, "หนึ่งล้านเอ็ดบาทถ้วน"],
    [250_000_075, "สองล้านห้าแสนบาทเจ็ดสิบห้าสตางค์"],
    [2_100_000_000, "ยี่สิบเอ็ดล้านบาทถ้วน"],
    [-14500, "ลบหนึ่งร้อยสี่สิบห้าบาทถ้วน"],
  ])("%i satang is %s", (satang, words) => expect(bahtText(satang)).toBe(words));
});
