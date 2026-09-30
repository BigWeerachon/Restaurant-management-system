"use client";

import { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { ReceiptView } from "@/components/pos/receipt-view";
import { TaxInvoicePages } from "@/components/pos/tax-invoice-view";
import { directReady, loadPrinterSend } from "@/lib/escpos/printer";
import { getPaperWidth, usePrintJob } from "@/lib/print";
import { buildReceipt, buildSampleReceipt } from "@/lib/receipt";
import { buildTaxInvoiceDoc } from "@/lib/tax-invoice";
import { useSabai } from "@/lib/demo/store";

/**
 * The one paper job, drawn and printed: the receipt or tax invoice as a page, and the print dialog (or the till's own
 * printer) asked to take it. A download of its own (`print-root.tsx` loads it when there is a job, and a little after the
 * till opens so it is already here when the line is down): most screens never print.
 *
 * Where paper output is drawn. It sits directly under <body>, invisible on screen; while printing, the stylesheet hides
 * everything else, so the paper gets the document and nothing of the till's screen. One job at a time: asked for by
 * `printReceipt` / `printTaxInvoice`, printed once the document is on the page, cleared when the print dialog closes.
 * Receipts go to the till's own printer when one is connected; a tax invoice is A4 and always uses the print dialog.
 */
export default function PrintJob() {
  const job = usePrintJob((s) => s.job);
  const done = usePrintJob((s) => s.done);
  const db = useSabai((s) => s.db);
  const a4 = job?.kind === "taxInvoice";
  const widthMm = job && !a4 ? getPaperWidth() : 80;

  const receipt = useMemo(() => {
    if (!job || job.kind === "taxInvoice") return null;
    if (job.kind === "sample") return buildSampleReceipt({ tenant: db.tenant, branch: db.branches.find((b) => b.id === useSabai.getState().session.branchId) ?? db.branches[0]! });
    const order = db.orders.find((o) => o.id === job.orderId);
    const branch = order && db.branches.find((b) => b.id === order.branchId);
    if (!order || !branch) return null;
    return buildReceipt({ order, tenant: db.tenant, branch, channel: db.channels.find((c) => c.id === order.channelId), methods: db.paymentMethods, members: db.members, copy: job.copy });
  }, [job, db]);

  const invoice = useMemo(() => {
    if (!job || job.kind !== "taxInvoice") return null;
    const found = db.taxInvoices.find((i) => i.orderId === job.orderId);
    return found ? buildTaxInvoiceDoc(found) : null;
  }, [job, db.taxInvoices]);

  const ready = a4 ? !!invoice : !!receipt;

  useEffect(() => {
    if (!job) return;
    if (!ready) {
      toast.error("พิมพ์ไม่ได้ ไม่พบบิลนี้แล้ว", { description: "ลองเปิดบิลจากรายการบิลวันนี้อีกครั้ง" });
      done();
      return;
    }
    // The paper's own page size: a 58 mm printer must not scale an 80 mm page down (or cut it off), and a tax invoice is A4.
    const style = document.createElement("style");
    style.id = "receipt-page-size";
    style.textContent = a4 ? "@page { size: A4; margin: 12mm; }" : `@page { size: ${widthMm}mm auto; margin: 0; }`;
    document.head.appendChild(style);
    let cancelled = false;
    const openDialog = () =>
      // Two frames: the document must be laid out before the print dialog takes its picture.
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
    if (!a4 && receipt && directReady()) {
      // The till's own printer: no dialog. If it fails the receipt is still on the page, so the dialog takes over.
      loadPrinterSend()
        .then(({ printReceiptDirect }) => printReceiptDirect(receipt, { widthMm }))
        .then(() => {
          toast.success(job.kind === "sample" ? "ส่งใบทดลองไปเครื่องพิมพ์แล้ว" : "ส่งใบเสร็จไปเครื่องพิมพ์แล้ว");
          done();
        })
        .catch(() => {
          toast.error("เครื่องพิมพ์ไม่ตอบ ใช้หน้าต่างพิมพ์แทน", { description: "ตรวจสายและกระดาษ แล้วเชื่อมต่อเครื่องพิมพ์ใหม่ในหน้า ตั้งค่า → ใบเสร็จและเครื่องพิมพ์" });
          openDialog();
        });
    } else openDialog();
    return () => {
      cancelled = true;
      style.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.kind, job && "orderId" in job ? job.orderId : "", job?.kind === "receipt" ? job.copy : false, ready]);

  if (typeof document === "undefined" || !job || !ready) return null;
  return createPortal(
    <div id="print-root" aria-hidden="true">
      {a4 ? <TaxInvoicePages doc={invoice!} /> : <ReceiptView data={receipt!} widthMm={widthMm} />}
    </div>,
    document.body,
  );
}
