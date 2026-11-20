/**
 * The company logo in front of our company's name on every paper the
 * accounting module prints — invoice / tax invoice, receipt, billing note,
 * credit note. The website's own logo (the owner, 2026-11-20).
 */
import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import InvoicePaper from "@/app/accounting/invoices/InvoicePaper";
import ReceiptPaper from "@/app/accounting/receipts/ReceiptPaper";
import BillingNotePaper from "@/app/accounting/billing-notes/BillingNotePaper";
import CreditNotePaper from "@/app/accounting/credit-notes/CreditNotePaper";
import { SELLER_LOGO_SRC } from "@/app/accounting/SellerLogo";

const SELLER = { name: "บริษัท โปรฟิน แล็บ จำกัด", address: "93 นนทบุรี", taxId: "0107537000114", branchCode: "00000", phone: "", email: "" };
const BUYER = { buyerName: "บริษัท เอ จำกัด", buyerAddress: "1 ถนนงามวงศ์วาน", buyerTaxId: "0107537000114", buyerBranch: "00000" };

afterEach(cleanup);

/** The logo, and that it comes before our company's name on the paper. */
function expectLogoBeforeSellerName() {
  const logo = screen.getByRole("img", { name: "โลโก้บริษัท" });
  expect(logo).toHaveAttribute("src", SELLER_LOGO_SRC);
  const name = screen.getByText(SELLER.name);
  // DOCUMENT_POSITION_FOLLOWING: the name comes after the logo.
  expect(logo.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  // Side by side, not stacked: they share the seller block.
  expect(logo.parentElement!.contains(name)).toBe(true);
}

describe("the company logo on the accounting papers", () => {
  it("is the website's own logo, the same file the site's header shows", () => {
    expect(SELLER_LOGO_SRC).toBe("/images/profin-logo-3.png");
  });

  it("an invoice / tax invoice", () => {
    render(
      <InvoicePaper
        seller={SELLER}
        copyLabel={null}
        doc={{
          docNo: "INV2026110009", isTaxInvoice: true, issueDate: "2026-11-19", dueDate: null, creditDays: 0, ...BUYER,
          customerPoNo: "", projectName: "", note: "", priceMode: "exclusive", vatRate: 7,
          subtotalSatang: 100000, discountSatang: 0, depositSatang: 0, vatBaseSatang: 100000, vatSatang: 7000, totalSatang: 107000,
          lines: [{ lineType: "goods", productId: "", name: "ปั๊มน้ำ", qty: 1, unit: "ชิ้น", unitPriceSatang: 100000, discountSatang: 0, isMachine: false, serials: "", warrantyMonths: null, amountSatang: 100000 }],
        }}
      />
    );
    expectLogoBeforeSellerName();
  });

  it("a receipt", () => {
    render(
      <ReceiptPaper
        seller={SELLER}
        copyLabel={null}
        payment={null}
        invoice={null}
        doc={{
          docNo: "RE2026110006", status: "issued", isTaxInvoice: true, issueDate: "2026-11-12", ...BUYER,
          customerPoNo: "", projectName: "", vatRate: 7, vatBaseSatang: 46729, vatSatang: 3271, totalSatang: 50000,
        }}
      />
    );
    expectLogoBeforeSellerName();
  });

  it("a billing note", () => {
    render(
      <BillingNotePaper
        seller={SELLER}
        copyLabel={null}
        invoices={[{ id: "i1", docNo: "INV2026110001", issueDate: "2026-11-01", dueDate: "2026-12-01", billedSatang: 107000 }]}
        doc={{ docNo: "BN2026110001", status: "issued", issueDate: "2026-11-20", dueDate: "2026-12-01", ...BUYER, totalSatang: 107000, note: "" }}
      />
    );
    expectLogoBeforeSellerName();
  });

  it("a credit note", () => {
    render(
      <CreditNotePaper
        seller={SELLER}
        copyLabel={null}
        invoice={{ docNo: "INV2026110001", issueDate: "2026-11-01", isTaxInvoice: true }}
        doc={{
          docNo: "CN2026110001", status: "issued", isTaxInvoice: true, issueDate: "2026-11-20", ...BUYER,
          priceMode: "exclusive", vatRate: 7, refValueSatang: 100000, vatBaseSatang: 10000, vatSatang: 700, totalSatang: 10700, note: "",
          lines: [{ lineType: "goods", productId: "", name: "ส่วนลดเพิ่ม", qty: 1, unit: "รายการ", unitPriceSatang: 10000, discountSatang: 0, isMachine: false, serials: "", warrantyMonths: null, amountSatang: 10000 }],
        }}
      />
    );
    expectLogoBeforeSellerName();
  });
});
