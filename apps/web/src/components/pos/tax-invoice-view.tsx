import type { TaxInvoiceDoc } from "@/lib/tax-invoice";

/**
 * The full tax invoice as A4 paper shows it: black on white, one page per copy (the original for the buyer, a copy
 * for the seller). Drawn for paper, so it uses no app colours; `@page` and the page breaks are in globals.css.
 */
export function TaxInvoicePages({ doc }: { doc: TaxInvoiceDoc }) {
  return (
    <div className="tax-invoice-pages">
      {doc.copies.map((copy) => (
        <section key={copy} className="tax-invoice" aria-label={`${doc.title} ${copy}`}>
          <header className="ti-head">
            <div className="ti-seller">
              <p className="ti-name">{doc.seller.name}</p>
              <p>{doc.seller.address}</p>
              <p>
                เลขประจำตัวผู้เสียภาษี {doc.seller.taxId} · {doc.seller.branchLabel}
              </p>
            </div>
            <div className="ti-box">
              <p className="ti-title">{doc.title}</p>
              <p className="ti-copy">{copy}</p>
              <dl>
                <div>
                  <dt>เลขที่</dt>
                  <dd>{doc.invoiceNo}</dd>
                </div>
                <div>
                  <dt>วันที่</dt>
                  <dd>{doc.date}</dd>
                </div>
              </dl>
            </div>
          </header>

          <div className="ti-buyer">
            <p className="ti-label">ผู้ซื้อ</p>
            <p className="ti-buyer-name">{doc.buyer.name}</p>
            <p>{doc.buyer.address}</p>
            <p>
              เลขประจำตัวผู้เสียภาษี {doc.buyer.taxId} · {doc.buyer.branchLabel}
            </p>
          </div>

          <table className="ti-lines">
            <thead>
              <tr>
                <th scope="col" className="ti-c">ลำดับ</th>
                <th scope="col">รายการ</th>
                <th scope="col" className="ti-r">จำนวน</th>
                <th scope="col" className="ti-r">ราคา/หน่วย</th>
                <th scope="col" className="ti-r">จำนวนเงิน</th>
              </tr>
            </thead>
            <tbody>
              {doc.lines.map((l) => (
                <tr key={l.no}>
                  <td className="ti-c">{l.no}</td>
                  <td>
                    {l.name}
                    {l.modifiers.length > 0 && <span className="ti-sub"> ({l.modifiers.join(", ")})</span>}
                  </td>
                  <td className="ti-r">{l.qty}</td>
                  <td className="ti-r">{l.unitPrice}</td>
                  <td className="ti-r">{l.amount}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="ti-foot">
            <div className="ti-words">
              <p className="ti-label">จำนวนเงินเป็นตัวอักษร</p>
              <p className="ti-words-text">({doc.words})</p>
              {doc.notes.map((n) => (
                <p key={n} className="ti-sub">
                  {n}
                </p>
              ))}
              {doc.receiptNo && <p className="ti-sub">อ้างอิงใบเสร็จรับเงิน/ใบกำกับภาษีอย่างย่อ เลขที่ {doc.receiptNo}</p>}
            </div>
            <table className="ti-summary">
              <tbody>
                {doc.summary.map((r) => (
                  <tr key={r.label} className={r.strong ? "ti-strong" : undefined}>
                    <th scope="row">{r.label}</th>
                    <td className="ti-r">{r.amount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <footer className="ti-sign">
            <p>{doc.issuedBy ? `ผู้ออกเอกสาร ${doc.issuedBy}` : " "}</p>
            <p>ผู้รับเงิน / ผู้มีอำนาจลงนาม ____________________</p>
          </footer>
        </section>
      ))}
    </div>
  );
}
