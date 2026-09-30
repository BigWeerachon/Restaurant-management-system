/**
 * Thai taxpayer identification number: 13 digits, the last a check digit
 * (weights 13…2 over the first twelve, then (11 − sum mod 11) mod 10).
 * A receipt or tax invoice with a mistyped number is worthless, so it is checked where it is typed.
 */
export function isValidThaiTaxId(value: string): boolean {
  if (!/^\d{13}$/.test(value)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(value[i]) * (13 - i);
  return (11 - (sum % 11)) % 10 === Number(value[12]);
}

/** "1234567890123" → "1-2345-67890-12-3", the way it is printed. Anything else comes back unchanged. */
export function formatThaiTaxId(value: string): string {
  const m = /^(\d)(\d{4})(\d{5})(\d{2})(\d)$/.exec(value);
  return m ? `${m[1]}-${m[2]}-${m[3]}-${m[4]}-${m[5]}` : value;
}

/** Branch number as printed on a tax document: "00000" is the head office. */
export function taxBranchLabel(branchNo: string | null | undefined): string {
  const no = branchNo && /^\d{5}$/.test(branchNo) ? branchNo : "00000";
  return no === "00000" ? "สำนักงานใหญ่" : `สาขาที่ ${no}`;
}

/**
 * The amount a tax document shows as "before VAT": what the customer owes for goods and service, less the VAT
 * inside it when prices include VAT (when they do not, VAT is added on top of this figure). The database computes the
 * same thing when it issues a tax invoice (`app.issue_tax_invoice`); a parity test keeps the two together.
 * All amounts in satang (or baht) — the same unit in, the same unit out.
 */
export function amountBeforeVat(o: { itemsTotal: number; discountTotal: number; serviceCharge: number; vatAmount: number; pricesIncludeVat: boolean }): number {
  return o.itemsTotal - o.discountTotal + o.serviceCharge - (o.pricesIncludeVat ? o.vatAmount : 0);
}

/**
 * A buyer's address and name are free text; the taxpayer number and branch are not. Returns what is wrong, by field —
 * the same checks run in the browser, the API and the database, so a document is never issued with a number that
 * cannot be right.
 */
export function checkTaxInvoiceBuyer(b: { name: string; taxId: string; address: string; branchNo?: string }): Partial<Record<"name" | "taxId" | "address" | "branchNo", string>> {
  const errors: Partial<Record<"name" | "taxId" | "address" | "branchNo", string>> = {};
  if (b.name.trim().length < 1 || b.name.trim().length > 200) errors.name = "ใส่ชื่อผู้ซื้อ (ไม่เกิน 200 ตัวอักษร)";
  if (!isValidThaiTaxId(b.taxId)) errors.taxId = "เลขประจำตัวผู้เสียภาษีต้องมี 13 หลักและตัวเลขถูกต้อง ตรวจอีกครั้ง";
  if (b.address.trim().length < 1 || b.address.trim().length > 400) errors.address = "ใส่ที่อยู่ผู้ซื้อ (ไม่เกิน 400 ตัวอักษร)";
  if (b.branchNo !== undefined && !/^\d{5}$/.test(b.branchNo)) errors.branchNo = "เลขที่สาขาต้องเป็นตัวเลข 5 หลัก (สำนักงานใหญ่ = 00000)";
  return errors;
}

const THAI_DIGITS = ["ศูนย์", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า"];
const THAI_PLACES = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน"];

/** 1–999,999 in Thai words. `hasHigher`: something is said before this part ("หนึ่งล้าน" + …), so a final 1 is "เอ็ด". */
function thaiBelowMillion(n: number, hasHigher: boolean): string {
  const s = String(n);
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const d = Number(s[i]);
    const place = s.length - i - 1;
    if (d === 0) continue;
    if (place === 0 && d === 1 && (s.length > 1 || hasHigher)) out += "เอ็ด";
    else if (place === 1 && d === 2) out += "ยี่สิบ";
    else if (place === 1 && d === 1) out += "สิบ";
    else out += THAI_DIGITS[d]! + THAI_PLACES[place]!;
  }
  return out;
}

function thaiInteger(n: number): string {
  if (n === 0) return THAI_DIGITS[0]!;
  const millions = Math.floor(n / 1_000_000);
  const rest = n % 1_000_000;
  return (millions > 0 ? `${thaiInteger(millions)}ล้าน` : "") + (rest > 0 ? thaiBelowMillion(rest, millions > 0) : "");
}

/**
 * An amount in Thai words, as written on tax invoices: 14500 satang → "หนึ่งร้อยสี่สิบห้าบาทถ้วน",
 * 13551 → "หนึ่งร้อยสามสิบห้าบาทห้าสิบเอ็ดสตางค์".
 */
export function bahtText(satang: number): string {
  const abs = Math.abs(Math.round(satang));
  const baht = Math.floor(abs / 100);
  const st = abs % 100;
  const sign = satang < 0 ? "ลบ" : "";
  if (baht === 0 && st > 0) return `${sign}${thaiInteger(st)}สตางค์`;
  return `${sign}${thaiInteger(baht)}บาท${st > 0 ? `${thaiInteger(st)}สตางค์` : "ถ้วน"}`;
}
