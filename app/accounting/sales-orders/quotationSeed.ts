// A customer PO opened from the quotation the customer accepted — pure: the
// quotation's own arithmetic (quotationToSale.buildLineDrafts, which folds the
// bill discount into each line's) turned into the PO's lines and customer.
import { CUSTOM_PRODUCT_SENTINEL, buildLineDrafts, type QuotationLine } from "../../lib/quotationToSale";
import type { DocLineInput, InvoiceInput } from "../../lib/accounting/invoiceRules";
import { companyAddressText } from "../../customers/companyAddress";
import type { LookupCompany } from "../useAccountingLookups";

export interface QuotationRecordView {
  id: string;
  docNo: string;
  data: {
    items?: QuotationLine[];
    discount?: unknown;
    discountType?: unknown;
    totalsVersion?: unknown;
    companyId?: string;
    customerId?: string;
    customerCompany?: string;
    customerContact?: string;
    [key: string]: unknown;
  };
}

export type OrderSeed = Partial<InvoiceInput> & { lines: DocLineInput[] };

const satang = (baht: number) => Math.max(0, Math.round((Number(baht) || 0) * 100));

export function orderSeedFromQuotation(rec: QuotationRecordView, products: readonly { id: string }[], companies: readonly LookupCompany[]): OrderSeed {
  const data = rec.data ?? {};
  const drafts = buildLineDrafts({
    items: data.items,
    products: products.map((p) => ({ id: p.id })),
    discount: data.discount,
    discountType: data.discountType,
    totalsVersion: data.totalsVersion,
  });
  const lines: DocLineInput[] = drafts.map((d) => {
    const productId = d.productId && d.productId !== CUSTOM_PRODUCT_SENTINEL && !d.productMissing ? d.productId : "";
    return {
      // A catalog product is goods (and, as on the invoice, a machine to track); anything else is taken as a service — the admin checks.
      lineType: productId ? "goods" : "service",
      productId,
      name: d.productName,
      qty: d.qty,
      unit: d.unit,
      unitPriceSatang: satang(d.unitPrice),
      discountSatang: satang(d.discountAmount),
      isMachine: Boolean(productId),
      serials: "",
      warrantyMonths: null,
    };
  });
  const company = data.companyId ? companies.find((c) => c.id === data.companyId) : undefined;
  return {
    companyId: company?.id ?? "",
    customerId: company ? String(data.customerId ?? "") : "",
    buyerName: company?.name ?? String(data.customerCompany || data.customerContact || ""),
    buyerAddress: company ? companyAddressText(company as Parameters<typeof companyAddressText>[0]) : "",
    buyerTaxId: company?.taxId ?? "",
    buyerBranch: company?.branchCode ?? "",
    note: rec.docNo ? `อ้างอิงใบเสนอราคา ${rec.docNo}` : "",
    lines,
  };
}
