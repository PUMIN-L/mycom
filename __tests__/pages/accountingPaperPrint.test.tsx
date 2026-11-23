/**
 * The accounting papers, as printed (the owner, 2026-11-23):
 * 1. the addresses — ours and the customer's — with a space after each label
 *    word ("อำเภอเมือง" → "อำเภอ เมือง"), on every paper, documents already
 *    issued included (it is done when the paper is drawn, not in the data);
 * 2. no date, time or page title at the top of the sheet: the browser prints
 *    those in the page's margin, so the page has none — the paper keeps its
 *    10 mm inside instead, on every page it runs to.
 */
import { render, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import type { ReactElement } from "react";
import InvoicePaper from "@/app/accounting/invoices/InvoicePaper";
import ReceiptPaper from "@/app/accounting/receipts/ReceiptPaper";
import BillingNotePaper from "@/app/accounting/billing-notes/BillingNotePaper";
import CreditNotePaper from "@/app/accounting/credit-notes/CreditNotePaper";
import { PAPER_PRINT_CSS } from "@/app/accounting/paperPrint";

const SELLER = {
  name: "บริษัท โปรฟิน แล็บสเกล จำกัด",
  address: "93 ถนนงามวงศ์วาน ตำบลบางเขน อำเภอเมืองนนทบุรี จ.นนทบุรี 11000",
  taxId: "0125569024424",
  branchCode: "00000",
  phone: "",
  email: "",
};
const BUYER = {
  buyerName: "บริษัท หมีน้อย จำกัด",
  buyerAddress: "เลขที่ 88 หมู่ 8 ซอย8 ถนนวงเวียนกลาง ตำบลบนบก อำเภอมีไก่ จังหวัดนอนมา 88888",
  buyerTaxId: "1232222222222",
  buyerBranch: "00000",
};
const OURS = "93 ถนน งามวงศ์วาน ตำบล บางเขน อำเภอ เมืองนนทบุรี จ. นนทบุรี 11000";
const THEIRS = "เลขที่ 88 หมู่ 8 ซอย 8 ถนน วงเวียนกลาง ตำบล บนบก อำเภอ มีไก่ จังหวัด นอนมา 88888";
const LINE = { lineType: "goods" as const, productId: "", name: "COMETECH QC-548M1F", qty: 1, unit: "เครื่อง", unitPriceSatang: 5000000, discountSatang: 100000, isMachine: false, serials: "", warrantyMonths: null, amountSatang: 4900000 };

const PAPERS: [string, () => ReactElement][] = [
  [
    "invoice / tax invoice",
    () => (
      <InvoicePaper
        printable
        seller={SELLER}
        copyLabel="ต้นฉบับ"
        doc={{
          docNo: "INV2026110001", isTaxInvoice: true, issueDate: "2026-11-19", dueDate: "2026-12-19", creditDays: 30, ...BUYER,
          customerPoNo: "v v v v", projectName: "", note: "", priceMode: "exclusive", vatRate: 7,
          subtotalSatang: 4900000, discountSatang: 0, depositSatang: 0, vatBaseSatang: 4900000, vatSatang: 343000, totalSatang: 5243000,
          lines: [LINE],
        }}
      />
    ),
  ],
  [
    "receipt",
    () => (
      <ReceiptPaper
        seller={SELLER}
        copyLabel="ต้นฉบับ"
        payment={null}
        invoice={null}
        doc={{ docNo: "RE2026110001", status: "issued", isTaxInvoice: true, issueDate: "2026-11-20", ...BUYER, customerPoNo: "", projectName: "", vatRate: 7, vatBaseSatang: 4900000, vatSatang: 343000, totalSatang: 5243000 }}
      />
    ),
  ],
  [
    "billing note",
    () => (
      <BillingNotePaper
        seller={SELLER}
        copyLabel="ต้นฉบับ"
        invoices={[{ id: "i1", docNo: "INV2026110001", issueDate: "2026-11-19", dueDate: "2026-12-19", billedSatang: 5243000 }]}
        doc={{ docNo: "BN2026110001", status: "issued", issueDate: "2026-11-20", dueDate: "2026-12-19", ...BUYER, totalSatang: 5243000, note: "" }}
      />
    ),
  ],
  [
    "credit note",
    () => (
      <CreditNotePaper
        seller={SELLER}
        copyLabel="ต้นฉบับ"
        invoice={{ docNo: "INV2026110001", issueDate: "2026-11-19", isTaxInvoice: true }}
        doc={{
          docNo: "CN2026110001", status: "issued", isTaxInvoice: true, issueDate: "2026-11-21", ...BUYER,
          priceMode: "exclusive", vatRate: 7, refValueSatang: 4900000, vatBaseSatang: 100000, vatSatang: 7000, totalSatang: 107000, note: "",
          lines: [{ ...LINE, name: "ส่วนลดเพิ่ม", unitPriceSatang: 100000, discountSatang: 0, amountSatang: 100000 }],
        }}
      />
    ),
  ],
];

afterEach(cleanup);

describe("the addresses on the papers: a space after each label word", () => {
  it.each(PAPERS)("%s — ours and the customer's", (_name, paper) => {
    const { container } = render(paper());
    const text = container.textContent ?? "";
    expect(text).toContain(OURS);
    expect(text).toContain(THEIRS);
    // And never the joined form.
    expect(text).not.toContain("อำเภอเมืองนนทบุรี");
    expect(text).not.toContain("ตำบลบนบก");
  });
});

describe("no date, time or page title at the top of the printed sheet", () => {
  it("the page has no margin for the browser to print them in; the paper keeps its 10 mm inside, on every page", () => {
    expect(PAPER_PRINT_CSS).toMatch(/@page\s*\{\s*size:\s*A4;\s*margin:\s*0;\s*\}/);
    expect(PAPER_PRINT_CSS).not.toMatch(/@page[^}]*margin:\s*10mm/);
    expect(PAPER_PRINT_CSS).toMatch(/\[data-print-root\][^{]*\{[^}]*padding:\s*10mm !important/);
    expect(PAPER_PRINT_CSS).toMatch(/box-decoration-break:\s*clone/);
    // Only on paper: the screen is untouched.
    expect(PAPER_PRINT_CSS.trim().startsWith("@media print")).toBe(true);
  });

  it.each(PAPERS)("%s prints with it", (_name, paper) => {
    const { container } = render(paper());
    const styles = [...container.querySelectorAll("style")].map((s) => s.textContent);
    expect(styles).toEqual([PAPER_PRINT_CSS]);
  });
});
