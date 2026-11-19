/**
 * Billing notes (lib/accounting/billingRules.ts) — pure:
 *  • what makes one: a customer, at least one invoice, a due date not before it;
 *  • money received against it spread over its invoices, oldest first — the
 *    withholding by each one's services, the bank fee by amount, each one's
 *    share of its own VAT (the settling payment takes what is left) — every
 *    share adding up exactly;
 *  • where it stands, from its invoices as they are now.
 * Every figure is worked out by hand.
 */
import { describe, it, expect } from "vitest";
import {
  billingNoteProblems,
  billingStatusOf,
  cleanBillingNoteInput,
  firstBillingProblem,
  spreadBillingPayment,
  suggestedBillingWhtSatang,
  type BilledInvoice,
} from "@/app/lib/accounting/billingRules";

describe("cleanBillingNoteInput / billingNoteProblems", () => {
  it("takes each invoice once, in the order given", () => {
    const input = cleanBillingNoteInput({ companyId: "co1", invoiceIds: ["b", "a", "b", "", 5], issueDate: "2026-11-19", dueDate: "", note: " ส่งพร้อมเช็ค " });
    expect(input.invoiceIds).toEqual(["b", "a", "5"]);
    expect(input.note).toBe("ส่งพร้อมเช็ค");
  });

  it("wants a customer, an invoice, a date — and a due date not before it", () => {
    const ok = { companyId: "co1", buyerName: "", invoiceIds: ["a"], issueDate: "2026-11-19", dueDate: "2026-11-30", note: "" };
    expect(firstBillingProblem(billingNoteProblems(ok))).toBeNull();
    expect(billingNoteProblems({ ...ok, companyId: "" }).buyerName).toBe("กรุณาเลือกลูกค้า");
    expect(billingNoteProblems({ ...ok, invoiceIds: [] }).invoiceIds).toBe("กรุณาเลือกใบแจ้งหนี้อย่างน้อย 1 ใบ");
    expect(billingNoteProblems({ ...ok, issueDate: "" }).issueDate).toBe("กรุณาเลือกวันที่วางบิล");
    expect(billingNoteProblems({ ...ok, dueDate: "2026-11-18" }).dueDate).toBe("วันนัดชำระต้องไม่ก่อนวันที่วางบิล");
    expect(billingNoteProblems({ ...ok, dueDate: "2026-02-30" }).dueDate).toBe("วันนัดชำระไม่ถูกต้อง");
    expect(billingNoteProblems({ ...ok, invoiceIds: Array.from({ length: 101 }, (_, i) => `i${i}`) }).invoiceIds).toContain("ไม่เกิน 100");
  });
});

/**
 * A: goods 1,070.00 (it is the tax invoice) · B: services 535.00 (500.00 before
 * VAT) · C: services 214.00, half of it paid (with 7.00 of its VAT).
 */
const INVOICES: BilledInvoice[] = [
  { id: "A", totalSatang: 107000, vatSatang: 7000, paidSatang: 0, vatPaidSatang: 0, serviceBaseSatang: 0, receiptIsTaxInvoice: false },
  { id: "B", totalSatang: 53500, vatSatang: 3500, paidSatang: 0, vatPaidSatang: 0, serviceBaseSatang: 50000, receiptIsTaxInvoice: true },
  { id: "C", totalSatang: 21400, vatSatang: 1400, paidSatang: 10700, vatPaidSatang: 700, serviceBaseSatang: 20000, receiptIsTaxInvoice: true },
];

describe("spreadBillingPayment", () => {
  it("pays every invoice in full when it is all paid — the withholding on the services, the fee by amount, each its VAT", () => {
    const shares = spreadBillingPayment(INVOICES, { amountSatang: 171200, whtSatang: 1800, feeSatang: 30 });
    expect(shares.map((s) => [s.invoiceId, s.amountSatang, s.whtSatang, s.vatSatang, s.receiptIsTaxInvoice])).toEqual([
      ["A", 107000, 0, 7000, false],
      ["B", 53500, 1500, 3500, true],
      // The payment that settles C declares the VAT left of it.
      ["C", 10700, 300, 700, true],
    ]);
    expect(shares.reduce((s, x) => s + x.feeSatang, 0)).toBe(30);
    expect(shares.map((s) => s.feeSatang)).toEqual([19, 9, 2]);
  });

  it("pays the oldest first, and a part of the next — its share of the VAT", () => {
    const shares = spreadBillingPayment(INVOICES, { amountSatang: 120000, whtSatang: 0, feeSatang: 0 });
    // 13,000 of B's 53,500: 3,500 × 13,000 / 53,500 = 850.47 → 850
    expect(shares.map((s) => [s.invoiceId, s.amountSatang, s.vatSatang])).toEqual([["A", 107000, 7000], ["B", 13000, 850]]);
  });

  it("spreads what was withheld by amount when nothing is a service — what the customer withheld is what they withheld", () => {
    const goods = INVOICES.map((i) => ({ ...i, serviceBaseSatang: 0 }));
    const shares = spreadBillingPayment(goods, { amountSatang: 160500, whtSatang: 300, feeSatang: 0 });
    expect(shares.map((s) => s.whtSatang)).toEqual([200, 100]);
  });

  it("takes nothing from an invoice paid in full already", () => {
    const paid = [{ ...INVOICES[0], paidSatang: 107000 }, INVOICES[1]];
    expect(spreadBillingPayment(paid, { amountSatang: 1000, whtSatang: 0, feeSatang: 0 }).map((s) => s.invoiceId)).toEqual(["B"]);
  });
});

describe("suggestedBillingWhtSatang", () => {
  it("is the rate on each invoice's services, as far as the amount pays them", () => {
    expect(suggestedBillingWhtSatang(INVOICES, 171200, 3)).toBe(1800);
    // A takes 107,000 (goods); B 13,000 of 53,500 → 3% of its services' share = 364.48 → 364
    expect(suggestedBillingWhtSatang(INVOICES, 120000, 3)).toBe(364);
    expect(suggestedBillingWhtSatang(INVOICES, 171200, 0)).toBe(0);
  });
});

describe("billingStatusOf", () => {
  const inv = (totalSatang: number, paidSatang: number, billedSatang: number) => ({ totalSatang, paidSatang, billedSatang });
  it("is paid once every invoice is settled — on the note or not — and partly paid once anything came in since it was billed", () => {
    expect(billingStatusOf({ status: "issued" }, [inv(100, 100, 100), inv(50, 50, 50)])).toBe("paid");
    expect(billingStatusOf({ status: "issued" }, [inv(100, 40, 100), inv(50, 0, 50)])).toBe("partial");
    expect(billingStatusOf({ status: "issued" }, [inv(100, 0, 100)])).toBe("open");
    // Billed after half was paid: nothing has come in since.
    expect(billingStatusOf({ status: "issued" }, [inv(100, 50, 50)])).toBe("open");
    expect(billingStatusOf({ status: "void" }, [inv(100, 100, 100)])).toBe("cancelled");
  });
});
