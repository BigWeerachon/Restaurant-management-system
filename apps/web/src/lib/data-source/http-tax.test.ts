import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSabai } from "../demo/store";
import { clearApiSession, setApiSession } from "./http-client";
import { httpDataSource } from "./http-data-source";
import { mapTaxInvoice, type TaxInvoiceApi } from "./http-tax";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const api: TaxInvoiceApi = {
  id: "ti-1",
  invoiceNo: "HQ-TI-2609-00001",
  orderId: "o-1",
  branchId: "br-1",
  receiptNo: "HQ-T1-2609-00001",
  issuedAt: "2026-09-29T05:30:00.000Z",
  issuedByName: "น้องแคช",
  seller: { name: "บริษัท สบายคาเฟ่ จำกัด", taxId: "1101700230708", branchNo: "00000", address: "12 ซ.อารีย์" },
  buyer: { name: "บริษัท ผู้ซื้อ จำกัด", taxId: "0105536001239", branchNo: "00003", address: "99 ถ.สุขุมวิท" },
  lines: [{ name: "ลาเต้เย็น", qty: 2, unitPrice: "65.00", modifiersTotal: "15.00", amount: "160.00", modifiers: ["นมโอ๊ต"] }],
  itemsTotal: "160.00",
  discountTotal: "0.00",
  discountReason: null,
  serviceCharge: "0.00",
  amountBeforeVat: "149.53",
  vatRate: 0.07,
  vatAmount: "10.47",
  rounding: "0.00",
  total: "160.00",
  pricesIncludeVat: true,
};
const buyer = { name: "บริษัท ผู้ซื้อ จำกัด", taxId: "0105536001239", address: "99 ถ.สุขุมวิท", branchNo: "00003" };

describe("full tax invoices over the API", () => {
  beforeEach(() => {
    clearApiSession();
    setApiSession({ token: "staff", tenantId: "t-1" });
    useSabai.getState().reset("demo");
    useSabai.getState().patch((d) => {
      d.orders = [{ id: "o-1", branchId: "br-1", channelId: "c", orderNo: "001", receiptNo: "HQ-T1-2609-00001", status: "paid", businessDate: "2026-09-29", openedAt: "2026-09-29T05:00:00.000Z", items: [], payments: [], totals: { itemsTotal: 16000, discountTotal: 0, serviceCharge: 0, vatAmount: 1047, rounding: 0, total: 16000, commission: 0, commissionVat: 0, netSales: 16000 }, commissionRate: 0 }];
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("turns the wire's baht strings into satang, with each line's unit price including its modifiers", () => {
    const inv = mapTaxInvoice(api);
    expect(inv).toMatchObject({ total: 16000, vatAmount: 1047, amountBeforeVat: 14953, receiptNo: "HQ-T1-2609-00001", issuedByName: "น้องแคช", buyer: { branchNo: "00003" } });
    expect(inv.lines).toEqual([{ name: "ลาเต้เย็น", qty: 2, modifiers: ["นมโอ๊ต"], unitPrice: 8000, amount: 16000 }]);
    expect(inv.discountReason).toBeUndefined();
  });

  it("issues one with the buyer as the API names it, and keeps it and the bill's number", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(201, api));
    vi.stubGlobal("fetch", fetchMock);
    const inv = await httpDataSource.issueTaxInvoice("o-1", buyer);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/v1/orders/o-1/tax-invoice");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ buyerName: buyer.name, buyerTaxId: buyer.taxId, buyerAddress: buyer.address, buyerBranchNo: "00003" });
    expect(inv.invoiceNo).toBe("HQ-TI-2609-00001");
    const { db } = useSabai.getState();
    expect(db.taxInvoices.map((i) => i.invoiceNo)).toEqual(["HQ-TI-2609-00001"]);
    expect(db.orders[0]!.taxInvoiceNo).toBe("HQ-TI-2609-00001");
  });

  it("says why when the server refuses, and keeps nothing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(409, { error: { code: "TAX_INVOICE_EXISTS", details: { invoice_no: "HQ-TI-2609-00001" } } })));
    await expect(httpDataSource.issueTaxInvoice("o-1", buyer)).rejects.toMatchObject({ code: "TAX_INVOICE_EXISTS", params: { invoice_no: "HQ-TI-2609-00001" } });
    expect(useSabai.getState().db.taxInvoices).toEqual([]);
  });

  it("reads an invoice once and then uses the copy it has (an issued invoice never changes)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, api));
    vi.stubGlobal("fetch", fetchMock);
    expect((await httpDataSource.getTaxInvoice("o-1"))?.invoiceNo).toBe("HQ-TI-2609-00001");
    expect((await httpDataSource.getTaxInvoice("o-1"))?.invoiceNo).toBe("HQ-TI-2609-00001");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(useSabai.getState().db.orders[0]!.taxInvoiceNo).toBe("HQ-TI-2609-00001");
  });

  it("answers null for a bill that never had one, but not for a real failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(404, { error: { code: "NOT_FOUND" } })));
    expect(await httpDataSource.getTaxInvoice("o-1")).toBeNull();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(403, { error: { code: "PERMISSION_DENIED" } })));
    await expect(httpDataSource.getTaxInvoice("o-1")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });
});
