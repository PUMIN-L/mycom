/**
 * Credit-note rules (lib/accounting/creditRules.ts) — pure:
 *  • what an invoice owes, and what is due back, once credit notes took value off;
 *  • a credit note's figures at the invoice's price mode and VAT rate, and the
 *    values the paper prints (original / correct / difference, before VAT);
 *  • what is wrong with one: its date, its reason, its lines, and never more
 *    than the invoice has left — only what is still owed when it is not the
 *    tax invoice.
 */
import { describe, it, expect } from "vitest";
import {
  CREDIT_LIMITS,
  CREDIT_REASONS,
  cleanCreditNoteInput,
  creditNoteKind,
  creditNoteProblems,
  creditReturnsGoods,
  creditTotals,
  creditValues,
  effectiveInvoice,
  owedSatang,
  refundDueSatang,
  type CreditInvoice,
  type CreditNoteInput,
} from "@/app/lib/accounting/creditRules";
import type { DocLineInput } from "@/app/lib/accounting/invoiceRules";

const line = (over: Partial<DocLineInput> = {}): DocLineInput => ({
  lineType: "goods",
  productId: "p1",
  name: "เครื่องวัดความดัน",
  qty: 1,
  unit: "เครื่อง",
  unitPriceSatang: 100000,
  discountSatang: 0,
  isMachine: false,
  serials: "",
  warrantyMonths: null,
  ...over,
});

/** 2 machines at 1,000.00 + VAT 7% = 2,140.00 — the tax invoice, nothing paid or credited yet. */
const INVOICE: CreditInvoice = {
  issueDate: "2026-11-01",
  isTaxInvoice: true,
  priceMode: "exclusive",
  vatRate: 7,
  totalSatang: 214000,
  vatSatang: 14000,
  vatBaseSatang: 200000,
  creditedSatang: 0,
  creditedBaseSatang: 0,
  paidSatang: 0,
};
const INPUT: CreditNoteInput = { invoiceId: "inv1", issueDate: "2026-11-19", reason: CREDIT_REASONS[0], lines: [line()] };

describe("owedSatang / refundDueSatang / effectiveInvoice", () => {
  it("takes what credit notes took off before what was paid", () => {
    expect(owedSatang({ totalSatang: 214000, creditedSatang: 107000, paidSatang: 50000 })).toBe(57000);
    expect(owedSatang({ totalSatang: 214000, paidSatang: 14000 })).toBe(200000);
  });

  it("owes nothing — and has money due back — once paid and credited come to more than the total", () => {
    const inv = { totalSatang: 214000, creditedSatang: 107000, paidSatang: 214000 };
    expect(owedSatang(inv)).toBe(0);
    expect(refundDueSatang(inv)).toBe(107000);
    expect(refundDueSatang({ totalSatang: 214000, creditedSatang: 0, paidSatang: 100000 })).toBe(0);
  });

  it("a refund paid out (a negative payment) leaves nothing due", () => {
    expect(refundDueSatang({ totalSatang: 214000, creditedSatang: 107000, paidSatang: 214000 - 107000 })).toBe(0);
  });

  it("sees the invoice as its payments do: total and VAT less what was credited", () => {
    expect(effectiveInvoice({ totalSatang: 214000, vatSatang: 14000, creditedSatang: 107000, creditedVatSatang: 7000 })).toEqual({ totalSatang: 107000, vatSatang: 7000 });
    expect(effectiveInvoice({ totalSatang: 214000, vatSatang: 14000 })).toEqual({ totalSatang: 214000, vatSatang: 14000 });
  });
});

describe("creditTotals / creditValues", () => {
  it("works the figures out at the invoice's price mode and VAT rate", () => {
    expect(creditTotals(INPUT, INVOICE)).toMatchObject({ vatBaseSatang: 100000, vatSatang: 7000, totalSatang: 107000 });
    // Prices that include VAT: 1,070.00 holds 70.00 of it.
    expect(creditTotals({ lines: [line({ unitPriceSatang: 107000 })] }, { priceMode: "inclusive", vatRate: 7 })).toMatchObject({ vatBaseSatang: 100000, vatSatang: 7000, totalSatang: 107000 });
  });

  it("prints the original value less earlier credit notes, the correct value and the difference", () => {
    expect(creditValues(INVOICE, 100000)).toEqual({ originalSatang: 200000, correctSatang: 100000, differenceSatang: 100000 });
    expect(creditValues({ vatBaseSatang: 200000, creditedBaseSatang: 50000 }, 30000)).toEqual({ originalSatang: 150000, correctSatang: 120000, differenceSatang: 30000 });
  });
});

describe("cleanCreditNoteInput", () => {
  it("coerces what the browser sent, and a credit note registers no machine and delivers nothing of a PO", () => {
    const clean = cleanCreditNoteInput({
      invoiceId: " inv1 ",
      issueDate: "2026-11-19",
      reason: "  รับคืน  ",
      lines: [{ ...line(), isMachine: true, serials: "SN1", warrantyMonths: 12, sourceLineId: "pol1", qty: "2", unitPriceSatang: "100000" }],
    });
    expect(clean.invoiceId).toBe("inv1");
    expect(clean.reason).toBe("รับคืน");
    expect(clean.lines[0]).toMatchObject({ qty: 2, unitPriceSatang: 100000, isMachine: false, serials: "", warrantyMonths: null, sourceLineId: "" });
  });

  it("keeps one character too many of the reason, so the check can say it is too long; nothing sent is nothing", () => {
    expect(cleanCreditNoteInput({ reason: "ก".repeat(900) }).reason).toHaveLength(CREDIT_LIMITS.reason + 1);
    expect(cleanCreditNoteInput(null)).toEqual({ invoiceId: "", issueDate: "", reason: "", lines: [] });
  });
});

describe("creditNoteProblems", () => {
  it("passes a credit note within what the invoice has left", () => {
    expect(creditNoteProblems(INPUT, INVOICE)).toEqual({ fields: {}, lines: {}, first: null });
  });

  it("asks for a date, not before the invoice's", () => {
    expect(creditNoteProblems({ ...INPUT, issueDate: "" }, INVOICE).first).toBe("กรุณาเลือกวันที่ใบลดหนี้");
    expect(creditNoteProblems({ ...INPUT, issueDate: "2026-10-31" }, INVOICE).fields.issueDate).toBe("วันที่ใบลดหนี้ต้องไม่ก่อนวันที่ใบแจ้งหนี้");
  });

  it("asks why, within its length", () => {
    expect(creditNoteProblems({ ...INPUT, reason: "" }, INVOICE).first).toBe("กรุณาระบุเหตุที่ลดหนี้");
    expect(creditNoteProblems({ ...INPUT, reason: "ก".repeat(CREDIT_LIMITS.reason + 1) }, INVOICE).fields.reason).toBe(`เหตุผลยาวเกิน ${CREDIT_LIMITS.reason} ตัวอักษร`);
  });

  it("asks for at least one line, each with a name, a quantity and a price", () => {
    expect(creditNoteProblems({ ...INPUT, lines: [] }, INVOICE).fields.lines).toBe("กรุณาเพิ่มรายการที่ลดหนี้อย่างน้อย 1 รายการ");
    const bad = creditNoteProblems({ ...INPUT, lines: [line({ name: "", qty: 0 })] }, INVOICE);
    expect(bad.lines[0]).toMatchObject({ name: "กรุณากรอกชื่อรายการ", qty: "จำนวนต้องมากกว่า 0" });
    expect(bad.first).toBe("กรุณากรอกชื่อรายการ");
    expect(bad.fields.total).toBeUndefined();
  });

  it("refuses nothing to take off", () => {
    expect(creditNoteProblems({ ...INPUT, lines: [line({ unitPriceSatang: 0 })] }, INVOICE).first).toBe("ยอดลดหนี้ต้องมากกว่า 0 บาท");
  });

  it("never takes off more than the invoice has left after earlier credit notes", () => {
    const credited = { ...INVOICE, creditedSatang: 160500, creditedBaseSatang: 150000 };
    expect(creditNoteProblems(INPUT, credited).first).toBe("ลดหนี้เกินมูลค่าที่เหลือของใบแจ้งหนี้ — เหลือ 535.00 บาท");
    expect(creditNoteProblems({ ...INPUT, lines: [line({ unitPriceSatang: 50000 })] }, credited).first).toBeNull();
  });

  it("the tax invoice may be credited beyond what is owed — the customer is then owed money back", () => {
    expect(creditNoteProblems(INPUT, { ...INVOICE, paidSatang: 214000 }).first).toBeNull();
  });

  it("an invoice that is not the tax invoice: only what is still owed can come off (receipts already declared the rest)", () => {
    const services = { ...INVOICE, isTaxInvoice: false, paidSatang: 150000 };
    expect(creditNoteProblems(INPUT, services).first).toBe("ใบแจ้งหนี้นี้ไม่ใช่ใบกำกับภาษี — ลดได้ไม่เกินยอดที่ยังค้าง 640.00 บาท");
    expect(creditNoteProblems({ ...INPUT, lines: [line({ unitPriceSatang: 50000 })] }, services).first).toBeNull();
  });
});

describe("creditReturnsGoods", () => {
  it("is the case of goods taken back only", () => {
    expect(creditReturnsGoods(CREDIT_REASONS[0])).toBe(true);
    expect(creditReturnsGoods(`${CREDIT_REASONS[0]} — เครื่อง 1 เครื่อง`)).toBe(true);
    expect(CREDIT_REASONS.slice(1).some(creditReturnsGoods)).toBe(false);
    expect(creditReturnsGoods("คิดราคาผิด")).toBe(false);
  });
});

describe("creditNoteKind", () => {
  it("says on the paper whether it is a tax document", () => {
    expect(creditNoteKind(true)).toContain("86/10");
    expect(creditNoteKind(false)).toContain("ไม่ใช่เอกสารทางภาษี");
  });
});
