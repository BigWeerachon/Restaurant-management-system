"use client";

import { parsePromptPayId, promptPayPayload } from "@sabai/domain";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

/** Thai QR (PromptPay). With `amount` the customer can't change it; without, it's a static shop QR. */
export function PromptPayQr({ id, amount, className }: { id: string; amount?: number; className?: string }) {
  const [svg, setSvg] = useState<string>("");
  const target = parsePromptPayId(id);
  useEffect(() => {
    if (!target) return;
    let live = true;
    QRCode.toString(promptPayPayload(target, amount), { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#1c1b19", light: "#ffffff" } }).then((s) => live && setSvg(s));
    return () => {
      live = false;
    };
  }, [target?.kind, target?.value, amount]); // eslint-disable-line react-hooks/exhaustive-deps
  const label = amount !== undefined ? `QR พร้อมเพย์ ยอด ${amount.toFixed(2)} บาท` : "QR พร้อมเพย์ของร้าน (ลูกค้าใส่ยอดเอง)";
  return (
    <div className={cn("mx-auto w-56 rounded-3xl bg-white p-3 shadow-md ring-1 ring-line", className)}>
      <div className="mb-2 flex items-center justify-center gap-1.5 rounded-xl bg-[#113566] py-1.5 text-xs font-semibold text-white">THAI QR PAYMENT · PromptPay</div>
      {target && svg ? <div className="aspect-square" dangerouslySetInnerHTML={{ __html: svg }} aria-label={label} role="img" /> : <div className="skeleton aspect-square rounded-xl" />}
    </div>
  );
}
