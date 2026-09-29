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
