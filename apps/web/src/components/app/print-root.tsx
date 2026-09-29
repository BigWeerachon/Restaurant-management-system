"use client";

import { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { ReceiptView } from "@/components/pos/receipt-view";
import { getPaperWidth, usePrintJob } from "@/lib/print";
import { buildReceipt, buildSampleReceipt } from "@/lib/receipt";
import { useSabai } from "@/lib/demo/store";

/**
 * Where paper output is drawn. It sits directly under <body>, invisible on screen; while printing, the stylesheet hides
 * everything else, so the roll gets the receipt and nothing of the till's screen. One job at a time: asked for by
 * `printReceipt`, printed once the receipt is on the page, cleared when the print dialog closes.
 */
export function PrintRoot() {
  const job = usePrintJob((s) => s.job);
  const done = usePrintJob((s) => s.done);
  const db = useSabai((s) => s.db);
  const widthMm = job ? getPaperWidth() : 80;

  const data = useMemo(() => {
    if (!job) return null;
    if (job.kind === "sample") return buildSampleReceipt({ tenant: db.tenant, branch: db.branches.find((b) => b.id === useSabai.getState().session.branchId) ?? db.branches[0]! });
    const order = db.orders.find((o) => o.id === job.orderId);
    const branch = order && db.branches.find((b) => b.id === order.branchId);
    if (!order || !branch) return null;
    return buildReceipt({ order, tenant: db.tenant, branch, channel: db.channels.find((c) => c.id === order.channelId), methods: db.paymentMethods, members: db.members, copy: job.copy });
  }, [job, db]);

  useEffect(() => {
    if (!job) return;
    if (!data) {
      toast.error("พิมพ์ไม่ได้ ไม่พบบิลนี้แล้ว", { description: "ลองเปิดบิลจากรายการบิลวันนี้อีกครั้ง" });
      done();
      return;
    }
    // The roll's own page size, so a 58 mm printer does not scale an 80 mm page down (or cut it off).
    const style = document.createElement("style");
    style.id = "receipt-page-size";
    style.textContent = `@page { size: ${widthMm}mm auto; margin: 0; }`;
    document.head.appendChild(style);
    // Two frames: the receipt must be laid out before the print dialog takes its picture.
    let cancelled = false;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (cancelled) return;
        try {
          window.print();
        } finally {
          done();
        }
      }),
    );
    return () => {
      cancelled = true;
      style.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.kind, job?.kind === "receipt" ? job.orderId : "", job?.kind === "receipt" ? job.copy : false, !!data]);

  if (typeof document === "undefined" || !job || !data) return null;
  return createPortal(
    <div id="print-root" aria-hidden="true">
      <ReceiptView data={data} widthMm={widthMm} />
    </div>,
    document.body,
  );
}
