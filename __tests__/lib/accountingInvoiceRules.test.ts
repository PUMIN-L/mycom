// @vitest-environment node
/**
 * The rules of an invoice (lib/accounting/invoiceRules.ts): what the API
 * takes, what is wrong in Thai, what issuing needs on top, the title the
 * paper prints (goods vs services — the VAT timing rule the owner confirmed),
 * and how a document shows in a list.
 */
import { describe, it, expect } from "vitest";
import {
  cleanExternalFields,
  cleanInvoiceInput,
  externalProblems,
  defaultIsTaxInvoice,
  displayStatusOf,
  dueDateOf,
  invoiceProblems,
  invoiceTitle,
  issueProblems,
  splitSerials,
  type DocLineInput,
  type InvoiceInput,
} from "@/app/lib/accounting/invoiceRules";
import { computeTotals } from "@/app/lib/accounting/money";

const goods = (over: Partial<DocLineInput> = {}): DocLineInput => ({
  lineType: "goods", productId: "p1", name: "เครื่องชั่ง", qty: 1, unit: "เครื่อง",
  unitPriceSatang: 5800000, discountSatang: 0, isMachine: false, serials: "", warrantyMonths: null, ...over,
});
const service = (over: Partial<DocLineInput> = {}): DocLineInput => ({
  ...goods(), lineType: "service", productId: "", name: "สอบเทียบ", unit: "งาน", unitPriceSatang: 300000, ...over,
});
const invoice = (over: Partial<InvoiceInput> = {}): InvoiceInput => ({
  issueDate: "2026-11-18", creditDays: 30, companyId: "co1", customerId: "c1", salespersonId: "",
  buyerName: "บริษัท เอ จำกัด", buyerAddress: "1 ถนนงามวงศ์วาน", buyerTaxId: "0107537000114", buyerBranch: "00000",
  priceMode: "exclusive", discountSatang: 0, isTaxInvoice: true, customerPoNo: "", projectName: "", note: "",
  lines: [goods()], ...over,
});
const totalsOf = (input: InvoiceInput) => computeTotals({ lines: input.lines, discountSatang: input.discountSatang, priceMode: input.priceMode, vatRate: 7 });

describe("the VAT timing rule — which paper is the tax invoice", () => {
  it("goods: the invoice is the tax invoice; services only: it is not (the receipt will be)", () => {
    expect(defaultIsTaxInvoice([goods()])).toBe(true);
    expect(defaultIsTaxInvoice([service()])).toBe(false);
    expect(defaultIsTaxInvoice([service(), goods()])).toBe(true);
  });

  it("titles the paper by what it is", () => {
    expect(invoiceTitle({ isTaxInvoice: true, lines: [goods()] })).toBe("ใบส่งสินค้า / ใบแจ้งหนี้ / ใบกำกับภาษี");
    expect(invoiceTitle({ isTaxInvoice: false, lines: [service()] })).toBe("ใบแจ้งหนี้");
    expect(invoiceTitle({ isTaxInvoice: true, lines: [service()] })).toBe("ใบแจ้งหนี้ / ใบกำกับภาษี");
  });
});

describe("cleanInvoiceInput", () => {
  it("coerces types, trims, and normalises the buyer's tax ID and branch", () => {
    const input = cleanInvoiceInput({
      issueDate: "2026-11-18", creditDays: "30", buyerName: "  บริษัท บี  ", buyerTaxId: "0-1075-37000-11-4", buyerBranch: "สาขา 2",
      lines: [{ lineType: "service", name: " งาน ", qty: "2", unitPriceSatang: "1500", isMachine: true, serials: "x" }],
    });
    expect(input).toMatchObject({ creditDays: 30, buyerName: "บริษัท บี", buyerTaxId: "0107537000114", buyerBranch: "00002", priceMode: "exclusive" });
    // A service is never a machine; no serials ride on it.
    expect(input.lines[0]).toMatchObject({ lineType: "service", name: "งาน", qty: 2, unitPriceSatang: 1500, isMachine: false, serials: "" });
    // isTaxInvoice not sent → the rule decides (services only → no).
    expect(input.isTaxInvoice).toBe(false);
  });

  it("an unreadable price arrives as an impossible one, so the rules can name it", () => {
    const input = cleanInvoiceInput({ lines: [{ name: "ก", qty: 1, unitPriceSatang: "abc" }] });
    expect(input.lines[0].unitPriceSatang).toBe(-1);
  });
});

describe("invoiceProblems", () => {
  it("is clean for a complete invoice", () => {
    expect(invoiceProblems(invoice(), 7).first).toBeNull();
  });

  it("names what is missing, by field and by line", () => {
    const p = invoiceProblems(invoice({ issueDate: "2026-02-31", buyerName: "", lines: [goods({ name: "", qty: 0, unitPriceSatang: -1 })] }), 7);
    expect(p.fields.issueDate).toBe("กรุณาเลือกวันที่ออกเอกสาร");
    expect(p.fields.buyerName).toBe("กรุณาเลือกหรือกรอกชื่อลูกค้า");
    expect(p.lines[0]).toEqual({ name: "กรุณากรอกชื่อรายการ", qty: "จำนวนต้องมากกว่า 0", unitPriceSatang: "กรุณากรอกราคาต่อหน่วย" });
    expect(p.first).toBe("กรุณาเลือกวันที่ออกเอกสาร");
  });

  it("wants at least one line, and no more than 100", () => {
    expect(invoiceProblems(invoice({ lines: [] }), 7).fields.lines).toContain("อย่างน้อย 1 รายการ");
    expect(invoiceProblems(invoice({ lines: Array.from({ length: 101 }, () => goods()) }), 7).fields.lines).toContain("ไม่เกิน 100");
  });

  it("refuses a discount bigger than what it comes off", () => {
    expect(invoiceProblems(invoice({ lines: [goods({ discountSatang: 5800001 })] }), 7).lines[0].discountSatang).toBe("ส่วนลดมากกว่าราคาของรายการ");
    expect(invoiceProblems(invoice({ discountSatang: 5800001 }), 7).fields.discountSatang).toBe("ส่วนลดท้ายบิลมากกว่ายอดรวม");
  });

  it("checks a machine line: whole units, no more serials than units, a sane warranty", () => {
    expect(invoiceProblems(invoice({ lines: [goods({ isMachine: true, qty: 1.5 })] }), 7).lines[0].qty).toContain("จำนวนเต็ม");
    expect(invoiceProblems(invoice({ lines: [goods({ isMachine: true, qty: 1, serials: "A, B" })] }), 7).lines[0].serials).toContain("เกินจำนวน");
    expect(invoiceProblems(invoice({ lines: [goods({ isMachine: true, warrantyMonths: 200 })] }), 7).lines[0].warrantyMonths).toContain("0–120");
    expect(invoiceProblems(invoice({ lines: [goods({ isMachine: true, qty: 51 })] }), 7).fields.lines).toContain("ไม่เกิน 50 เครื่อง");
  });
});

describe("issueProblems — what issuing needs on top", () => {
  it("a total above zero, the buyer's address on a tax invoice, a contact for machines", () => {
    const zero = invoice({ lines: [goods({ unitPriceSatang: 0 })] });
    expect(issueProblems(zero, totalsOf(zero))).toContain("ยอดรวมต้องมากกว่า 0 บาท");
    const noAddress = invoice({ buyerAddress: "" });
    expect(issueProblems(noAddress, totalsOf(noAddress))).toContain("ใบกำกับภาษีต้องมีที่อยู่ของลูกค้า");
    const serviceOnly = invoice({ buyerAddress: "", isTaxInvoice: false, lines: [service()] });
    expect(issueProblems(serviceOnly, totalsOf(serviceOnly))).toEqual([]);
    const machinesNoContact = invoice({ customerId: "", lines: [goods({ isMachine: true })] });
    expect(issueProblems(machinesNoContact, totalsOf(machinesNoContact))[0]).toContain("ผู้ติดต่อ");
  });
});

describe("small helpers", () => {
  it("splits serials on commas and new lines", () => {
    expect(splitSerials(" A1, B2\nC3 ,, \n")).toEqual(["A1", "B2", "C3"]);
  });

  it("puts the due date credit days after the issue date", () => {
    expect(dueDateOf("2026-11-18", 30)).toBe("2026-12-18");
    expect(dueDateOf("2026-12-15", 30)).toBe("2027-01-14");
    expect(dueDateOf("bad", 30)).toBeNull();
  });
});

describe("displayStatusOf", () => {
  const issued = (over: Record<string, unknown> = {}) => ({ status: "issued", totalSatang: 1000, paidSatang: 0, dueDate: "2026-12-18", ...over });
  it("reads draft, waiting, overdue, part paid, paid and void", () => {
    expect(displayStatusOf({ ...issued(), status: "draft" }, "2026-11-18")).toBe("draft");
    expect(displayStatusOf(issued(), "2026-11-18")).toBe("awaiting");
    expect(displayStatusOf(issued(), "2026-12-18")).toBe("awaiting"); // due today is not late yet
    expect(displayStatusOf(issued(), "2026-12-19")).toBe("overdue");
    expect(displayStatusOf(issued({ paidSatang: 400 }), "2026-12-19")).toBe("partial");
    expect(displayStatusOf(issued({ paidSatang: 1000 }), "2026-12-19")).toBe("paid");
    expect(displayStatusOf({ ...issued(), status: "void" }, "2026-11-18")).toBe("void");
    expect(displayStatusOf(issued({ dueDate: null }), "2030-01-01")).toBe("awaiting");
  });
});

// Step 3 — a document issued elsewhere, recorded here.
describe("externalProblems / cleanExternalFields", () => {
  const ok = { docNo: "IV-2569/0042", externalNote: "แฟ้มใบกำกับ 2569 ตู้ 2", vatSatangOverride: null };

  it("is clean with a number and where the paper is kept", () => {
    expect(externalProblems(ok, 406000)).toEqual({});
  });

  it("wants the number as printed, and where the paper is kept", () => {
    expect(externalProblems({ ...ok, docNo: "" }, 0).docNo).toBe("กรุณากรอกเลขที่ตามที่พิมพ์บนเอกสารจริง");
    expect(externalProblems({ ...ok, externalNote: "" }, 0).externalNote).toContain("เก็บต้นฉบับไว้ที่ไหน");
  });

  it("refuses a number shaped like the system's own — the two series could collide", () => {
    expect(externalProblems({ ...ok, docNo: "INV2026110001" }, 0).docNo).toContain("รูปแบบเดียวกับเลขที่ระบบออกเอง");
    expect(externalProblems({ ...ok, docNo: "INV-2026110001" }, 0).docNo).toBeUndefined();
  });

  it("takes the VAT as printed within a baht of the system's, and refuses more (a typo)", () => {
    expect(externalProblems({ ...ok, vatSatangOverride: 406003 }, 406000)).toEqual({});
    expect(externalProblems({ ...ok, vatSatangOverride: 406100 }, 406000)).toEqual({});
    expect(externalProblems({ ...ok, vatSatangOverride: 40600 }, 406000).vatSatangOverride).toContain("เกิน 1 บาท");
  });

  it("reads the fields from a request", () => {
    expect(cleanExternalFields({ docNo: " IV-1 ", externalNote: " แฟ้ม ", vatSatangOverride: "406001" })).toEqual({ docNo: "IV-1", externalNote: "แฟ้ม", vatSatangOverride: 406001 });
    expect(cleanExternalFields({}).vatSatangOverride).toBeNull();
    expect(cleanExternalFields({ vatSatangOverride: "abc" }).vatSatangOverride).toBe(-1);
  });
});

// Step 6 — a delivery deducting the PO's deposit, before VAT.
describe("a deposit deducted on the invoice", () => {
  const withDeposit = (depositSatang: number, over: Partial<InvoiceInput> = {}) => invoice({ salesOrderId: "so1", depositSatang, ...over });
  const totalsWith = (input: InvoiceInput) =>
    computeTotals({ lines: input.lines, discountSatang: input.discountSatang, depositSatang: input.depositSatang, priceMode: input.priceMode, vatRate: 7 });

  it("is read from the browser as whole satang", () => {
    expect(cleanInvoiceInput({ depositSatang: "1000000.4" }).depositSatang).toBe(1000000);
    expect(cleanInvoiceInput({}).depositSatang).toBe(0);
  });

  it("comes off before VAT — never below nothing, never more than the invoice", () => {
    expect(invoiceProblems(withDeposit(5800000), 7).first).toBeNull();
    expect(invoiceProblems(withDeposit(5800001), 7).fields.depositSatang).toBe("หักมัดจำมากกว่ายอดของใบนี้");
    expect(invoiceProblems(withDeposit(-1), 7).fields.depositSatang).toBe("หักมัดจำติดลบไม่ได้");
    // With prices that include VAT, the deposit comes off with its VAT: 62,060.00 holds 58,000.00 before VAT.
    const inclusive = { priceMode: "inclusive" as const, lines: [goods({ unitPriceSatang: 6206000 })] };
    expect(invoiceProblems(withDeposit(5800000, inclusive), 7).first).toBeNull();
    expect(invoiceProblems(withDeposit(5800100, inclusive), 7).fields.depositSatang).toBe("หักมัดจำมากกว่ายอดของใบนี้");
  });

  it("lets a delivery paid in full by its deposit be issued at nothing — a zero bill without one still may not", () => {
    const paidAhead = withDeposit(5800000);
    expect(totalsWith(paidAhead).totalSatang).toBe(0);
    expect(issueProblems(paidAhead, totalsWith(paidAhead))).toEqual([]);
    const free = invoice({ lines: [goods({ unitPriceSatang: 0 })] });
    expect(issueProblems(free, totalsOf(free))).toContain("ยอดรวมต้องมากกว่า 0 บาท");
  });
});
