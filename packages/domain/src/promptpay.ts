/**
 * PromptPay QR (Thai QR Payment, EMVCo merchant-presented mode).
 * Generates the payload string; the app renders it as a QR code.
 * A per-bill amount turns it into a dynamic QR, so customers can't mistype.
 */
const GUID_PROMPTPAY = "A000000677010111";

function field(id: string, value: string): string {
  return `${id}${String(value.length).padStart(2, "0")}${value}`;
}

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) as required by EMVCo. */
export function crc16(data: string): string {
  let crc = 0xffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

export type PromptPayTarget =
  | { kind: "phone"; value: string }
  | { kind: "tax_id"; value: string }
  | { kind: "ewallet"; value: string };

/** Detects the target type from what the owner typed ("081-234-5678", "0105561234567"). */
export function parsePromptPayId(input: string): PromptPayTarget | null {
  const digits = input.replace(/\D/g, "");
  if (/^0\d{9}$/.test(digits)) return { kind: "phone", value: digits };
  if (/^66\d{9}$/.test(digits)) return { kind: "phone", value: `0${digits.slice(2)}` };
  if (/^\d{13}$/.test(digits)) return { kind: "tax_id", value: digits };
  if (/^\d{15}$/.test(digits)) return { kind: "ewallet", value: digits };
  return null;
}

/** @param amount baht, e.g. 145.5; omit for a static (any amount) QR. */
export function promptPayPayload(target: PromptPayTarget, amount?: number): string {
  const account =
    target.kind === "phone"
      ? field("01", `0066${target.value.slice(1)}`)
      : target.kind === "tax_id"
        ? field("02", target.value)
        : field("03", target.value);

  const parts = [
    field("00", "01"),
    field("01", amount ? "12" : "11"),
    field("29", field("00", GUID_PROMPTPAY) + account),
    field("53", "764"),
    field("58", "TH"),
  ];
  if (amount) parts.push(field("54", amount.toFixed(2)));
  const withoutCrc = parts.join("") + "6304";
  return withoutCrc + crc16(withoutCrc);
}
