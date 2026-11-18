// @vitest-environment node
/**
 * The rules of a payment (lib/accounting/paymentRules.ts), worked by hand:
 *  • what the API takes, and what is wrong with it in Thai;
 *  • withholding on the SERVICES before VAT only, in proportion to what is
 *    paid (goods are not withheld);
 *  • the VAT each receipt declares adds up to the invoice's, to the satang;
 *  • receivables by customer and by age.
 */
import { describe, it, expect } from "vitest";
import {
  ageingBucketOf,
  cleanPaymentInput,
  daysOverdue,
  firstPaymentProblem,
  groupReceivables,
  methodLabel,
  netReceivedSatang,
  paymentProblems,
  receiptTitle,
  receiptVatSatang,
  serviceBaseSatang,
  suggestedWhtSatang,
  vatShareSatang,
  type PaymentInput,
  type ReceivableInvoice,
} from "@/app/lib/accounting/paymentRules";

const payment = (over: Partial<PaymentInput> = {}): PaymentInput => ({
  paidDate: "2026-11-18", method: "transfer", bankAccountId: "b1", amountSatang: 2033000, whtPercent: 3, whtSatang: 57000,
  feeSatang: 0, cert50Received: false, cert50Note: "", externalReceiptNo: "", note: "", ...over,
});
const ctx = { outstandingSatang: 2033000, today: "2026-11-18" };

describe("cleanPaymentInput", () => {
  it("coerces numbers, trims text, and drops the account for cash", () => {
    expect(cleanPaymentInput({ paidDate: " 2026-11-18 ", method: "cash", bankAccountId: "b1", amountSatang: "2033000", whtPercent: "3", whtSatang: "57000", note: "  ok " }))
      .toMatchObject({ paidDate: "2026-11-18", method: "cash", bankAccountId: "", amountSatang: 2033000, whtPercent: 3, whtSatang: 57000, note: "ok" });
  });

  it("an unknown method is a transfer; a missing amount is not a payment", () => {
    const p = cleanPaymentInput({ method: "bitcoin" });
    expect(p.method).toBe("transfer");
    expect(p.amountSatang).toBe(-1);
  });

  it("no withholding means no rate and no certificate", () => {
    expect(cleanPaymentInput({ amountSatang: 100, whtPercent: 3, whtSatang: 0, cert50Received: true, cert50Note: "แฟ้ม" }))
      .toMatchObject({ whtPercent: 0, cert50Received: false, cert50Note: "" });
  });

  it("keeps a too-long text one character past its limit, so the check can say so instead of cutting it", () => {
    expect(cleanPaymentInput({ note: "ก".repeat(900) }).note).toHaveLength(501);
  });
});

describe("paymentProblems", () => {
  it("passes a full payment with 3% withheld", () => {
    expect(paymentProblems(payment(), ctx)).toEqual({});
  });

  it("refuses money that arrives tomorrow, and a payment with no date", () => {
    expect(paymentProblems(payment({ paidDate: "2026-11-19" }), ctx).paidDate).toBe("วันที่รับเงินต้องไม่เกินวันนี้");
    expect(paymentProblems(payment({ paidDate: "" }), ctx).paidDate).toBe("กรุณาเลือกวันที่รับเงิน");
  });

  it("refuses nothing paid, and more than is still owed", () => {
    expect(paymentProblems(payment({ amountSatang: 0 }), ctx).amountSatang).toBe("กรุณากรอกยอดที่ลูกค้าชำระ");
    expect(paymentProblems(payment({ amountSatang: 2033001 }), ctx).amountSatang).toBe("ยอดเกินยอดค้างชำระของใบนี้");
    expect(paymentProblems(payment({ amountSatang: 100 }), { ...ctx, outstandingSatang: 0 }).amountSatang).toBe("ใบนี้ไม่มียอดค้างชำระแล้ว");
  });

  it("refuses withholding above the payment, or without a rate", () => {
    expect(paymentProblems(payment({ whtSatang: 2033001 }), ctx).whtSatang).toBe("ยอดหัก ณ ที่จ่ายมากกว่ายอดที่ชำระ");
    expect(paymentProblems(payment({ whtPercent: 0 }), ctx).whtPercent).toBe("กรุณาเลือกอัตราหัก ณ ที่จ่าย");
    expect(paymentProblems(payment({ whtSatang: -1 }), ctx).whtSatang).toBe("ยอดหัก ณ ที่จ่ายติดลบไม่ได้");
  });

  it("refuses a bank fee larger than what arrived", () => {
    expect(paymentProblems(payment({ feeSatang: 2033000 - 57000 + 1 }), ctx).feeSatang).toBe("ค่าธรรมเนียมมากกว่าเงินที่ได้รับ");
    expect(paymentProblems(payment({ feeSatang: 2033000 - 57000 }), ctx).feeSatang).toBeUndefined();
  });

  it("refuses an outside receipt number shaped like the system's own", () => {
    expect(paymentProblems(payment({ externalReceiptNo: "RE2026110001" }), ctx).externalReceiptNo).toMatch(/รูปแบบเดียวกับเลขที่ระบบออกเอง/);
    expect(paymentProblems(payment({ externalReceiptNo: "เล่ม 3 เลขที่ 45" }), ctx).externalReceiptNo).toBeUndefined();
  });

  it("names the first problem in the dialog's order", () => {
    expect(firstPaymentProblem(paymentProblems(payment({ paidDate: "", amountSatang: 0 }), ctx))).toBe("กรุณาเลือกวันที่รับเงิน");
    expect(firstPaymentProblem({})).toBeNull();
  });
});

describe("money of a payment", () => {
  it("what arrived = paid − withheld − bank fee", () => {
    expect(netReceivedSatang({ amountSatang: 2033000, whtSatang: 57000, feeSatang: 1000 })).toBe(1975000);
  });

  it("labels the methods in Thai", () => {
    expect(methodLabel("transfer")).toBe("โอนเงิน");
    expect(methodLabel("cheque")).toBe("เช็ค");
  });

  it("the service base: the services' share of the VAT base (the bill discount shared over the lines)", () => {
    // goods 10,000 + service 5,000, bill discount 1,500 → base 13,500 → services 4,500
    expect(serviceBaseSatang({ vatBaseSatang: 1350000, lines: [{ lineType: "goods", amountSatang: 1000000 }, { lineType: "service", amountSatang: 500000 }] })).toBe(450000);
    expect(serviceBaseSatang({ vatBaseSatang: 1900000, lines: [{ lineType: "service", amountSatang: 1900000 }] })).toBe(1900000);
    expect(serviceBaseSatang({ vatBaseSatang: 0, lines: [] })).toBe(0);
  });

  it("withholds 3% of the services before VAT — all of it on a full payment, half on half", () => {
    // services 19,000 + VAT 1,330 = 20,330
    expect(suggestedWhtSatang(2033000, 2033000, 1900000, 3)).toBe(57000);
    expect(suggestedWhtSatang(1016500, 2033000, 1900000, 3)).toBe(28500);
    // goods 10,000 + service 5,000 → total 16,050: 3% of 5,000 only
    expect(suggestedWhtSatang(1605000, 1605000, 500000, 3)).toBe(15000);
    // nothing withheld on goods alone, or at 0%
    expect(suggestedWhtSatang(1605000, 1605000, 0, 3)).toBe(0);
    expect(suggestedWhtSatang(2033000, 2033000, 1900000, 0)).toBe(0);
  });

  it("rounds withholding half up at the satang", () => {
    // 3% of 0.50 = 0.015 → 0.02
    expect(suggestedWhtSatang(100, 100, 50, 3)).toBe(2);
  });

  it("rounds exactly on a bill so large the product passes 2^53 (a float would land either side of the half)", () => {
    // Half of an invoice whose VAT is odd: exactly x.5 satang → up.
    expect(vatShareSatang(10000000001, { totalSatang: 20000000002, vatSatang: 1400000001 })).toBe(700000001);
    expect(suggestedWhtSatang(10000000001, 20000000002, 18000000001, 3)).toBe(270000000);
  });

  it("every receipt of an invoice adds up to the invoice's VAT exactly — the settling one takes what is left", () => {
    const invoice = { totalSatang: 100000, vatSatang: 6542 };
    const first = receiptVatSatang(33333, invoice, { paidSatang: 0, vatSatang: 0 });
    const second = receiptVatSatang(33333, invoice, { paidSatang: 33333, vatSatang: first });
    const third = receiptVatSatang(33334, invoice, { paidSatang: 66666, vatSatang: first + second });
    expect([first, second, third]).toEqual([2181, 2181, 2180]);
    expect(first + second + third).toBe(6542);
    expect(receiptVatSatang(100000, invoice, { paidSatang: 0, vatSatang: 0 })).toBe(6542);
    expect(vatShareSatang(33333, invoice)).toBe(2181);
  });

  it("titles the receipt: with /ใบกำกับภาษี when it is the tax invoice (services)", () => {
    expect(receiptTitle(true)).toBe("ใบเสร็จรับเงิน/ใบกำกับภาษี");
    expect(receiptTitle(false)).toBe("ใบเสร็จรับเงิน");
  });
});

describe("receivables", () => {
  it("counts lateness from the day after the due date (no due date: the issue date)", () => {
    expect(daysOverdue({ dueDate: "2026-11-18", issueDate: "2026-10-19" }, "2026-11-18")).toBe(0);
    expect(daysOverdue({ dueDate: "2026-11-18", issueDate: "2026-10-19" }, "2026-11-19")).toBe(1);
    expect(daysOverdue({ dueDate: null, issueDate: "2026-11-08" }, "2026-11-18")).toBe(10);
    expect(daysOverdue({ dueDate: "2026-12-18", issueDate: "2026-11-18" }, "2026-11-18")).toBe(0);
  });

  it("buckets by age, edges included", () => {
    expect([0, 1, 30, 31, 60, 61, 90, 91].map(ageingBucketOf)).toEqual([
      "current", "d1_30", "d1_30", "d31_60", "d31_60", "d61_90", "d61_90", "d90plus",
    ]);
  });

  const inv = (over: Partial<ReceivableInvoice>): ReceivableInvoice => ({
    id: "i", docNo: "INV", source: "internal", issueDate: "2026-09-01", dueDate: "2026-10-01", companyId: "",
    buyerName: "บริษัท เอ จำกัด", totalSatang: 100000, paidSatang: 0, ...over,
  });

  it("groups a customer's invoices (by record when linked — named as on the latest — else by name), splits them by age, most late first", () => {
    const { groups, totals } = groupReceivables(
      [
        inv({ id: "1", companyId: "co1", buyerName: "บริษัท เอ จำกัด", issueDate: "2026-10-31", dueDate: "2026-11-30", totalSatang: 500000 }),
        inv({ id: "2", companyId: "co1", buyerName: "บริษัท เอ จำกัด (เดิม)", issueDate: "2026-09-01", dueDate: "2026-10-01", totalSatang: 300000, paidSatang: 100000 }),
        inv({ id: "3", buyerName: "ร้านบี", dueDate: "2026-07-01", totalSatang: 50000 }),
        inv({ id: "4", buyerName: " ร้านบี ", dueDate: "2026-11-01", totalSatang: 20000 }),
        inv({ id: "5", buyerName: "จ่ายครบแล้ว", totalSatang: 100000, paidSatang: 100000 }),
      ],
      "2026-11-18"
    );
    expect(groups.map((g) => g.name)).toEqual(["ร้านบี", "บริษัท เอ จำกัด"]);
    const b = groups[0];
    expect(b.outstandingSatang).toBe(70000);
    expect(b.buckets).toMatchObject({ d1_30: 20000, d90plus: 50000 });
    expect(b.invoices.map((i) => i.id)).toEqual(["3", "4"]);
    const a = groups[1];
    expect(a.outstandingSatang).toBe(700000);
    expect(a.buckets).toMatchObject({ current: 500000, d31_60: 200000 });
    expect(totals).toEqual({ current: 500000, d1_30: 20000, d31_60: 200000, d61_90: 0, d90plus: 50000, all: 770000 });
  });
});
