"use client";

import { checkTaxInvoiceBuyer, formatThaiTaxId, isValidThaiTaxId } from "@sabai/domain";
import { FileText, Printer } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { Button, LinkButton } from "@/components/ui/button";
import { Dialog } from "@/components/ui/overlay";
import { Callout, Field, Input, Segmented, Textarea } from "@/components/ui/primitives";
import { useDsAction } from "@/hooks/use-data-source";
import { getDataSource } from "@/lib/data-source";
import { formatBaht } from "@/lib/demo/selectors";
import { useSabai } from "@/lib/demo/store";
import type { TaxInvoice } from "@/lib/demo/types";
import { printTaxInvoice } from "@/lib/print";
import { dateOf } from "@/lib/receipt";
import { taxInvoiceBlocker } from "@/lib/tax-invoice";

type FieldKey = "name" | "taxId" | "address" | "branchNo";

/**
 * A customer asks for a full tax invoice (ใบกำกับภาษีเต็มรูป): who it is made out to, then print it on A4. If the bill
 * already has one, this opens on it, ready to print again. The same checks run here, in the API and in the database.
 */
export function TaxInvoiceDialog({ orderId, open, onOpenChange }: { orderId: string | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const db = useSabai((s) => s.db);
  const order = db.orders.find((o) => o.id === orderId);
  const branch = db.branches.find((b) => b.id === order?.branchId);
  const { exec, pending } = useDsAction();
  const ids = { name: useId(), taxId: useId(), address: useId(), branchNo: useId() };

  const [name, setName] = useState("");
  const [taxId, setTaxId] = useState("");
  const [address, setAddress] = useState("");
  const [headOffice, setHeadOffice] = useState(true);
  const [branchNo, setBranchNo] = useState("");
  const [touched, setTouched] = useState<Partial<Record<FieldKey, boolean>>>({});
  const [invoice, setInvoice] = useState<TaxInvoice | null>(null);
  const [looking, setLooking] = useState(false);

  // Each opening starts clean; a bill that already has an invoice shows it instead of a form.
  useEffect(() => {
    if (!open) return;
    setName("");
    setTaxId("");
    setAddress("");
    setHeadOffice(true);
    setBranchNo("");
    setTouched({});
    setInvoice(null);
    if (!orderId || !db.orders.find((o) => o.id === orderId)?.taxInvoiceNo) return;
    let live = true;
    setLooking(true);
    getDataSource()
      .getTaxInvoice(orderId)
      .then((i) => live && setInvoice(i))
      .catch(() => undefined)
      .finally(() => live && setLooking(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, orderId]);

  const blocker = useMemo(() => taxInvoiceBlocker(db.tenant, branch, isValidThaiTaxId), [db.tenant, branch]);
  const errors = checkTaxInvoiceBuyer({ name, taxId, address, branchNo: headOffice ? "00000" : branchNo });
  const shown = (k: FieldKey) => (touched[k] ? errors[k] : undefined);
  const touch = (k: FieldKey) => setTouched((t) => ({ ...t, [k]: true }));

  const submit = async () => {
    setTouched({ name: true, taxId: true, address: true, branchNo: true });
    if (!order || Object.keys(errors).length > 0) return;
    const res = await exec((ds) => ds.issueTaxInvoice(order.id, { name: name.trim(), taxId, address: address.trim(), branchNo: headOffice ? "00000" : branchNo }));
    if (res.ok) setInvoice(res.value);
    // Another till got there first: show the one that exists.
    else if (res.code === "TAX_INVOICE_EXISTS") setInvoice(await getDataSource().getTaxInvoice(order.id));
  };

  const title = invoice ? "ใบกำกับภาษีเต็มรูป" : "ขอใบกำกับภาษีเต็มรูป";
  return (
    <Dialog
      open={open && !!order}
      onOpenChange={onOpenChange}
      title={title}
      description={order ? `บิล #${order.orderNo}${order.receiptNo ? ` · ใบเสร็จ ${order.receiptNo}` : ""}` : undefined}
      size="md"
      footer={
        invoice ? (
          <>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              ปิด
            </Button>
            <Button icon={<Printer className="h-4 w-4" />} onClick={() => void printTaxInvoice(invoice.orderId)}>
              พิมพ์ใบกำกับภาษี (A4)
            </Button>
          </>
        ) : blocker ? (
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            ปิด
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              ยกเลิก
            </Button>
            <Button icon={<FileText className="h-4 w-4" />} loading={pending} onClick={() => void submit()}>
              ออกใบกำกับภาษี
            </Button>
          </>
        )
      }
    >
      {looking ? (
        <p className="py-6 text-center text-sm text-ink-3" role="status">
          กำลังเปิดใบกำกับภาษี…
        </p>
      ) : invoice ? (
        <div className="space-y-4 pb-2">
          <Callout tone="success" title={`ออกใบกำกับภาษีแล้ว เลขที่ ${invoice.invoiceNo}`}>
            พิมพ์ได้ 2 หน้า คือต้นฉบับให้ลูกค้าและสำเนาเก็บไว้ที่ร้าน ออกแล้วแก้ไขไม่ได้
          </Callout>
          <dl className="divide-y divide-line rounded-2xl border border-line text-sm">
            {[
              ["ผู้ซื้อ", invoice.buyer.name],
              ["เลขประจำตัวผู้เสียภาษี", formatThaiTaxId(invoice.buyer.taxId)],
              ["ยอดรวม", formatBaht(invoice.total)],
              ["วันที่ออก", dateOf(invoice.issuedAt)],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 px-4 py-2.5">
                <dt className="text-ink-3">{k}</dt>
                <dd className="text-right font-medium text-ink">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : blocker ? (
        <div className="space-y-3 pb-2">
          <Callout tone="warning" title="ยังออกใบกำกับภาษีเต็มรูปไม่ได้">
            {blocker.text}
          </Callout>
          <LinkButton href={blocker.code === "no_address" ? "/settings?tab=branches" : blocker.code === "not_vat" ? "/settings?tab=business" : "/settings?tab=receipt"} variant="secondary">
            ไปที่ตั้งค่า
          </LinkButton>
        </div>
      ) : (
        <form
          className="space-y-4 pb-2"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Field label="ชื่อผู้ซื้อ (บุคคลหรือบริษัท)" htmlFor={ids.name} required error={shown("name")}>
            <Input id={ids.name} value={name} onChange={(e) => setName(e.target.value)} onBlur={() => touch("name")} invalid={!!shown("name")} autoComplete="off" placeholder="เช่น บริษัท ตัวอย่าง จำกัด" maxLength={200} />
          </Field>
          <Field label="เลขประจำตัวผู้เสียภาษี 13 หลัก" htmlFor={ids.taxId} required error={shown("taxId")} hint="ของบริษัท หรือเลขบัตรประชาชนถ้าเป็นบุคคลธรรมดา">
            <Input id={ids.taxId} value={taxId} onChange={(e) => setTaxId(e.target.value.replace(/\D/g, "").slice(0, 13))} onBlur={() => touch("taxId")} invalid={!!shown("taxId")} inputMode="numeric" autoComplete="off" placeholder="0000000000000" className="tabular" />
          </Field>
          <div className="space-y-1.5">
            <Segmented
              label="สำนักงานของผู้ซื้อ"
              className="w-full"
              value={headOffice ? "head" : "branch"}
              onChange={(v) => setHeadOffice(v === "head")}
              options={[
                { value: "head", label: "สำนักงานใหญ่" },
                { value: "branch", label: "สาขา" },
              ]}
            />
          </div>
          {!headOffice && (
            <Field label="เลขที่สาขา 5 หลัก" htmlFor={ids.branchNo} required error={shown("branchNo")}>
              <Input id={ids.branchNo} value={branchNo} onChange={(e) => setBranchNo(e.target.value.replace(/\D/g, "").slice(0, 5))} onBlur={() => touch("branchNo")} invalid={!!shown("branchNo")} inputMode="numeric" placeholder="00001" className="max-w-40 tabular" />
            </Field>
          )}
          <Field label="ที่อยู่ผู้ซื้อ" htmlFor={ids.address} required error={shown("address")}>
            <Textarea id={ids.address} value={address} onChange={(e) => setAddress(e.target.value)} onBlur={() => touch("address")} aria-invalid={!!shown("address") || undefined} rows={3} maxLength={400} placeholder="เลขที่ ถนน แขวง/ตำบล เขต/อำเภอ จังหวัด รหัสไปรษณีย์" />
          </Field>
        </form>
      )}
    </Dialog>
  );
}
