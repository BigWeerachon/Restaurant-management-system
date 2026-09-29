import type { ReceiptData } from "@/lib/receipt";

/**
 * A receipt as the roll shows it: black on white, one narrow column, numbers lined up on the right. It is drawn for
 * paper, so it does not use the app's colours or spacing; `widthMm` is the printable width of the roll (58 or 80).
 */
export function ReceiptView({ data, widthMm }: { data: ReceiptData; widthMm: number }) {
  const { seller, meta } = data;
  return (
    <article className="receipt" style={{ width: `${widthMm}mm` }} aria-label={data.title}>
      <header className="receipt-center">
        <p className="receipt-name">{seller.legalName ?? seller.name}</p>
        {seller.legalName && <p>{seller.name}</p>}
        {seller.branchLabel && <p>{seller.branchLabel}</p>}
        {seller.address && <p>{seller.address}</p>}
        {seller.phone && <p>โทร {seller.phone}</p>}
        {seller.taxId && <p>เลขประจำตัวผู้เสียภาษี {seller.taxId}</p>}
        <p className="receipt-title">{data.title}</p>
        {data.banner && <p className="receipt-banner">{data.banner}</p>}
      </header>

      <dl className="receipt-meta">
        {meta.receiptNo && (
          <div>
            <dt>เลขที่</dt>
            <dd>{meta.receiptNo}</dd>
          </div>
        )}
        <div>
          <dt>บิล</dt>
          <dd>#{meta.orderNo}</dd>
        </div>
        <div>
          <dt>วันที่</dt>
          <dd>
            {meta.date} {meta.time}
          </dd>
        </div>
        {(meta.channel || meta.table) && (
          <div>
            <dt>ช่องทาง</dt>
            <dd>{[meta.channel, meta.table ? `โต๊ะ ${meta.table}` : ""].filter(Boolean).join(" · ")}</dd>
          </div>
        )}
        {meta.cashier && (
          <div>
            <dt>พนักงาน</dt>
            <dd>{meta.cashier}</dd>
          </div>
        )}
      </dl>

      <hr />
      <ul className="receipt-lines">
        {data.lines.map((l, i) => (
          <li key={i}>
            <div className="receipt-row">
              <span>
                {l.qty} × {l.name}
              </span>
              <span className="receipt-num">{l.amount}</span>
            </div>
            {l.modifiers.map((m) => (
              <p key={m} className="receipt-sub">
                + {m}
              </p>
            ))}
            {l.note && <p className="receipt-sub">“{l.note}”</p>}
          </li>
        ))}
      </ul>
      <hr />

      <div className="receipt-summary">
        {data.summary.map((r) => (
          <div key={r.label} className={r.strong ? "receipt-row receipt-strong" : "receipt-row"}>
            <span>{r.label}</span>
            <span className="receipt-num">{r.amount}</span>
          </div>
        ))}
      </div>
      {data.payments.length > 0 && (
        <>
          <hr />
          <div>
            {data.payments.map((r, i) => (
              <div key={`${r.label}-${i}`} className="receipt-row">
                <span>{r.label}</span>
                <span className="receipt-num">{r.amount}</span>
              </div>
            ))}
          </div>
        </>
      )}
      {data.notes.map((n) => (
        <p key={n} className="receipt-note">
          {n}
        </p>
      ))}
      <footer className="receipt-center">
        {data.footer.map((f) => (
          <p key={f}>{f}</p>
        ))}
      </footer>
    </article>
  );
}
