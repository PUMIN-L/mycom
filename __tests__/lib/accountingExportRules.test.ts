/**
 * The accountant's monthly workbook (lib/accounting/exportRules.ts) — pure:
 *  • the sales-tax report: every tax document of the month in date order — a
 *    voided one kept at 0 and marked, a credit note negative, those issued
 *    elsewhere said so — and its totals, exact (summed in satang);
 *  • the register, the money received (a voided payment at 0, a refund out),
 *    the withholding and its 50 ทวิ, receivables and deposits at the month's end;
 *  • money as NUMBERS in baht, so the accountant can add the columns up.
 */
import { describe, it, expect } from "vitest";
import {
  accountantWorkbook,
  bahtOf,
  depositRows,
  docTypeLabel,
  monthLabel,
  monthRange,
  paymentRows,
  receivableRows,
  registerRows,
  salesTaxRows,
  withholdingRows,
  type PaymentEntry,
  type RegisterDoc,
  type SalesTaxDoc,
} from "@/app/lib/accounting/exportRules";
import { formatTaxId } from "@/app/lib/thaiTaxId";

const TAX_ID = "0107537000114";
const doc = (over: Partial<RegisterDoc>): RegisterDoc => ({
  docType: "INV",
  docNo: "INV2026110002",
  status: "issued",
  source: "internal",
  externalNote: "",
  isTaxInvoice: true,
  issueDate: "2026-11-05",
  buyerName: "บริษัท เอ จำกัด",
  buyerTaxId: TAX_ID,
  buyerBranch: "00000",
  vatBaseSatang: 200000,
  vatSatang: 14000,
  totalSatang: 214000,
  relatedNo: null,
  voidReason: null,
  ...over,
});
const pay = (over: Partial<PaymentEntry>): PaymentEntry => ({
  paidDate: "2026-11-18",
  docType: "INV",
  docNo: "INV2026110001",
  billingNo: null,
  buyerName: "บริษัท เอ จำกัด",
  buyerTaxId: TAX_ID,
  method: "transfer",
  bankLabel: "กสิกรไทย 123-4-56789-0",
  amountSatang: 2033000,
  whtPercent: 3,
  whtSatang: 57000,
  feeSatang: 1500,
  receiptNo: "RE2026110001",
  externalReceiptNo: "",
  cert50Received: false,
  cert50Note: "",
  note: "",
  voidedAt: null,
  voidReason: null,
  ...over,
});

describe("monthRange / monthLabel / bahtOf / docTypeLabel", () => {
  it("gives a month's days — the year turning, a leap February", () => {
    expect(monthRange("2026-11")).toEqual({ from: "2026-11-01", to: "2026-12-01", last: "2026-11-30" });
    expect(monthRange("2026-12")).toEqual({ from: "2026-12-01", to: "2027-01-01", last: "2026-12-31" });
    expect(monthRange("2028-02")!.last).toBe("2028-02-29");
  });

  it("refuses anything that is not a month", () => {
    for (const bad of ["2026-13", "2026-00", "2026-1", "", "abcd-ef", "2026-11-01", "1999-12"]) expect(monthRange(bad)).toBeNull();
  });

  it("names the tax month as the Revenue Department writes it", () => {
    expect(monthLabel("2026-11")).toBe("พฤศจิกายน 2569");
    expect(monthLabel("2027-01")).toBe("มกราคม 2570");
    expect(monthLabel("nope")).toBe("nope");
  });

  it("writes satang as baht numbers, and names each document as printed", () => {
    expect([bahtOf(107000), bahtOf(5), bahtOf(-107000)]).toEqual([1070, 0.05, -1070]);
    expect(docTypeLabel("INV", true)).toBe("ใบแจ้งหนี้/ใบกำกับภาษี");
    expect(docTypeLabel("INV", false)).toBe("ใบแจ้งหนี้");
    expect(docTypeLabel("RE", true)).toBe("ใบเสร็จรับเงิน/ใบกำกับภาษี");
    expect(docTypeLabel("RE", false)).toBe("ใบเสร็จรับเงิน");
    expect(docTypeLabel("BN", false)).toBe("ใบวางบิล");
    expect(docTypeLabel("CN", true)).toBe("ใบลดหนี้");
  });
});

describe("salesTaxRows — รายงานภาษีขาย", () => {
  const DOCS: SalesTaxDoc[] = [
    doc({}),
    doc({ docType: "RE", docNo: "RE2026110001", issueDate: "2026-11-03", relatedNo: "INV2026100009", vatBaseSatang: 1900000, vatSatang: 133000, totalSatang: 2033000 }),
    doc({ docNo: "INV2026110001", issueDate: "2026-11-04", status: "void", voidReason: "ออกผิดลูกค้า", vatBaseSatang: 100000, vatSatang: 7000, totalSatang: 107000 }),
    doc({ docType: "CN", docNo: "CN2026110001", issueDate: "2026-11-20", relatedNo: "INV2026110002", vatBaseSatang: 100000, vatSatang: 7000, totalSatang: 107000 }),
    doc({ docNo: "IV-0099", source: "external", issueDate: "2026-11-10", buyerName: "ร้าน ซี", buyerBranch: "00012", vatBaseSatang: 50000, vatSatang: 3500, totalSatang: 53500 }),
  ];
  const EXTERNAL = [{ paidDate: "2026-11-15", receiptNo: "เล่ม 2/41", buyerName: "ร้าน บี", buyerTaxId: "", buyerBranch: "", amountSatang: 53500, vatSatang: 3500, invoiceNos: ["INV2026110005"] }];

  it("lists every tax document by date, numbered — a voided one at 0, a credit note taken off, those from elsewhere marked", () => {
    const rows = salesTaxRows(DOCS, EXTERNAL);
    expect(rows.map((r) => [r["ลำดับ"], r["เลขที่ใบกำกับภาษี"], r["มูลค่าสินค้าหรือบริการ"], r["ภาษีมูลค่าเพิ่ม"], r["จำนวนเงินรวม"], r["หมายเหตุ"]])).toEqual([
      [1, "RE2026110001", 19000, 1330, 20330, "รับชำระ INV2026100009"],
      [2, "INV2026110001", 0, 0, 0, "ยกเลิก — ออกผิดลูกค้า"],
      [3, "INV2026110002", 2000, 140, 2140, ""],
      [4, "IV-0099", 500, 35, 535, "ออกจากที่อื่น"],
      [5, "เล่ม 2/41", 500, 35, 535, "ออกจากที่อื่น · รับชำระ INV2026110005"],
      [6, "CN2026110001", -1000, -70, -1070, "ลดหนี้ของ INV2026110002"],
      ["", "", 21000, 1470, 22470, ""],
    ]);
    expect(rows[0]).toMatchObject({
      "วันที่": "3 Nov 2026",
      "ประเภทเอกสาร": "ใบเสร็จรับเงิน/ใบกำกับภาษี",
      "ชื่อผู้ซื้อ": "บริษัท เอ จำกัด",
      "เลขประจำตัวผู้เสียภาษี": formatTaxId(TAX_ID),
      "สถานประกอบการ": "สำนักงานใหญ่",
    });
    expect(rows[3]["สถานประกอบการ"]).toBe("สาขาที่ 00012");
    expect(rows[4]["ประเภทเอกสาร"]).toBe("ใบเสร็จรับเงิน/ใบกำกับภาษี");
    expect(rows[6]["ชื่อผู้ซื้อ"]).toBe("รวม");
  });

  it("a deposit's receipt says it was a deposit on the PO", () => {
    const [row] = salesTaxRows([doc({ docType: "RE", docNo: "RE2026110009", relatedNo: "PO PO-77", relatedType: "SO" })], []);
    expect(row["หมายเหตุ"]).toBe("รับมัดจำ PO PO-77");
  });

  it("adds up in satang — no float drift over many lines", () => {
    const many = Array.from({ length: 10 }, (_, i) => doc({ docNo: `INV20261100${10 + i}`, vatBaseSatang: 10, vatSatang: 1, totalSatang: 11 }));
    const total = salesTaxRows(many, []).at(-1)!;
    expect([total["มูลค่าสินค้าหรือบริการ"], total["ภาษีมูลค่าเพิ่ม"], total["จำนวนเงินรวม"]]).toEqual([1, 0.1, 1.1]);
  });

  it("is empty — no total row — in a month with none", () => {
    expect(salesTaxRows([], [])).toEqual([]);
  });
});

describe("registerRows — ทะเบียนเอกสาร", () => {
  it("lists every document as issued: by date, then type — the voided marked with why, those from elsewhere with where the paper is", () => {
    const rows = registerRows([
      doc({ docType: "BN", docNo: "BN2026110001", isTaxInvoice: false, issueDate: "2026-11-05", vatBaseSatang: 0, vatSatang: 0, totalSatang: 160500 }),
      doc({}),
      doc({ docType: "CN", docNo: "CN2026110001", issueDate: "2026-11-20", relatedNo: "INV2026110002", vatBaseSatang: 100000, vatSatang: 7000, totalSatang: 107000 }),
      doc({ docNo: "INV2026110001", isTaxInvoice: false, issueDate: "2026-11-04", status: "void", voidReason: "ออกผิดลูกค้า" }),
      doc({ docNo: "IV-0099", source: "external", externalNote: "แฟ้ม 2569", issueDate: "2026-11-10" }),
    ]);
    expect(rows.map((r) => [r["เลขที่"], r["ประเภทเอกสาร"], r["สถานะ"], r["มูลค่าก่อน VAT"], r["VAT"], r["รวม"]])).toEqual([
      ["INV2026110001", "ใบแจ้งหนี้", "ยกเลิก", 2000, 140, 2140],
      ["INV2026110002", "ใบแจ้งหนี้/ใบกำกับภาษี", "ออกแล้ว", 2000, 140, 2140],
      ["BN2026110001", "ใบวางบิล", "ออกแล้ว", "", "", 1605],
      ["IV-0099", "ใบแจ้งหนี้/ใบกำกับภาษี", "ออกแล้ว", 2000, 140, 2140],
      ["CN2026110001", "ใบลดหนี้", "ออกแล้ว", -1000, -70, -1070],
    ]);
    expect(rows[0]["หมายเหตุ"]).toBe("ยกเลิก: ออกผิดลูกค้า");
    expect(rows[1]["ที่มา"]).toBe("ออกจากระบบ");
    expect(rows[3]["ที่มา"]).toBe("ออกจากที่อื่น (เก็บที่: แฟ้ม 2569)");
    expect(rows[4]["อ้างถึง"]).toBe("INV2026110002");
  });
});

describe("paymentRows — รับชำระ", () => {
  const PAYMENTS = [
    pay({}),
    pay({ paidDate: "2026-11-19", amountSatang: 100000, whtSatang: 0, whtPercent: 0, feeSatang: 0, receiptNo: "RE2026110002", voidedAt: "2026-11-20T03:00:00.000Z", voidReason: "บันทึกผิด" }),
    pay({ paidDate: "2026-11-20", amountSatang: -107000, whtSatang: 0, whtPercent: 0, feeSatang: 0, receiptNo: null, method: "cash", bankLabel: "", note: "คืนเงินลูกค้า" }),
    pay({ paidDate: "2026-11-21", docType: "SO", docNo: "PO PO-77", amountSatang: 321000, whtSatang: 0, whtPercent: 0, feeSatang: 0, receiptNo: "RE2026110003" }),
    pay({ paidDate: "2026-11-22", billingNo: "BN2026110001", docNo: "INV2026110005", amountSatang: 53500, whtSatang: 1500, feeSatang: 0, receiptNo: null, externalReceiptNo: "เล่ม 2/41" }),
  ];

  it("lists the money in the month: what came in, held back and charged — a voided one at 0 with what it was", () => {
    const rows = paymentRows(PAYMENTS);
    expect(rows.map((r) => [r["รายการ"], r["เอกสาร"], r["ยอดรับ"], r["ภาษีหัก ณ ที่จ่าย"], r["ค่าธรรมเนียม"], r["เงินเข้าจริง"], r["ใบเสร็จ"]])).toEqual([
      ["รับชำระ", "INV2026110001", 20330, 570, 15, 19745, "RE2026110001"],
      ["รับชำระ", "INV2026110001", 0, 0, 0, 0, "RE2026110002"],
      ["คืนเงินลูกค้า", "INV2026110001", -1070, 0, 0, -1070, ""],
      ["รับมัดจำ", "PO PO-77", 3210, 0, 0, 3210, "RE2026110003"],
      ["รับชำระ", "INV2026110005", 535, 15, 0, 520, "เล่ม 2/41 (ออกจากที่อื่น)"],
      ["", "", 23005, 585, 15, 22405, ""],
    ]);
    expect(rows[0]).toMatchObject({ "วันที่รับ": "18 Nov 2026", "วิธีรับ": "โอนเงิน", "บัญชี": "กสิกรไทย 123-4-56789-0", "หัก ณ ที่จ่าย (%)": 3, "สถานะ": "ปกติ" });
    expect(rows[1]["สถานะ"]).toBe("ยกเลิก (เดิม 1,000.00 บาท) — บันทึกผิด");
    expect(rows[2]["วิธีรับ"]).toBe("เงินสด");
    expect(rows[4]["ใบวางบิล"]).toBe("BN2026110001");
    expect(rows[5]["ลูกค้า"]).toBe("รวม");
  });

  it("the withholding: live payments held back on only — and whether each 50 ทวิ came in", () => {
    const rows = withholdingRows([...PAYMENTS, pay({ whtSatang: 9000, voidedAt: "2026-11-25T00:00:00.000Z" })].map((p, i) => (i === 4 ? { ...p, cert50Received: true, cert50Note: "แฟ้ม 50 ทวิ" } : p)));
    expect(rows.map((r) => [r["เอกสาร"], r["ยอดรับ"], r["อัตรา (%)"], r["ภาษีที่ถูกหัก"], r["50 ทวิ"], r["เก็บ 50 ทวิ ไว้ที่"]])).toEqual([
      ["INV2026110001", 20330, 3, 570, "ยังไม่ได้รับ", ""],
      ["BN2026110001 (INV2026110005)", 535, 3, 15, "ได้รับแล้ว", "แฟ้ม 50 ทวิ"],
      ["", 20865, "", 585, "ยังไม่ได้รับ 1 รายการ", ""],
    ]);
    expect(rows[0]).toMatchObject({ "ลูกค้า (ผู้หักภาษี)": "บริษัท เอ จำกัด", "เลขประจำตัวผู้เสียภาษี": formatTaxId(TAX_ID), "ใบเสร็จ": "RE2026110001" });
  });

  it("are empty — no total row — in a month with none", () => {
    expect(paymentRows([])).toEqual([]);
    expect(withholdingRows([pay({ whtSatang: 0 })])).toEqual([]);
  });
});

describe("receivableRows — ลูกหนี้คงค้าง ณ สิ้นเดือน", () => {
  const base = { source: "internal", companyId: "co1", buyerName: "บริษัท เอ จำกัด" };

  it("what was owed on the month's last day — credit notes and payments by then taken off — by customer, aged on that day", () => {
    const rows = receivableRows(
      [
        { ...base, id: "A", docNo: "INV2026110001", issueDate: "2026-11-01", dueDate: "2026-11-15", totalSatang: 214000, creditedSatang: 107000, paidSatang: 0 },
        { ...base, id: "B", docNo: "INV2026110002", issueDate: "2026-11-02", dueDate: "2026-12-02", totalSatang: 53500, creditedSatang: 0, paidSatang: 53500 },
        { ...base, id: "C", docNo: "INV2026110003", issueDate: "2026-11-10", dueDate: "2026-12-10", totalSatang: 100000, creditedSatang: 0, paidSatang: 40000 },
        { ...base, id: "D", docNo: "INV2026080001", issueDate: "2026-08-01", dueDate: null, companyId: "", buyerName: "ร้าน บี", totalSatang: 10700, creditedSatang: 0, paidSatang: 0 },
      ],
      "2026-11-30"
    );
    expect(rows.map((r) => [r["ลูกค้า"], r["เลขที่ใบแจ้งหนี้"], r["ยอดตามใบแจ้งหนี้"], r["ลดหนี้"], r["รับชำระแล้ว"], r["คงค้าง"], r["เกินกำหนด (วัน)"], r["อายุหนี้"]])).toEqual([
      ["ร้าน บี", "INV2026080001", 107, 0, 0, 107, 121, "เกิน 90 วัน"],
      ["บริษัท เอ จำกัด", "INV2026110001", 2140, 1070, 0, 1070, 15, "เกิน 1–30 วัน"],
      ["บริษัท เอ จำกัด", "INV2026110003", 1000, 0, 400, 600, 0, "ยังไม่ถึงกำหนด"],
      ["รวม", "", "", "", "", 1777, "", "ยังไม่ถึงกำหนด 600.00 · เกิน 1–30 วัน 1,070.00 · เกิน 90 วัน 107.00"],
    ]);
    expect(rows[1]).toMatchObject({ "วันที่": "1 Nov 2026", "ครบกำหนด": "15 Nov 2026" });
    expect(rows[0]["ครบกำหนด"]).toBe("");
  });

  it("is empty when nothing was owed", () => {
    expect(receivableRows([{ ...base, id: "B", docNo: "INV2026110002", issueDate: "2026-11-02", dueDate: null, totalSatang: 53500, creditedSatang: 0, paidSatang: 53500 }], "2026-11-30")).toEqual([]);
  });
});

describe("depositRows — มัดจำคงเหลือ ณ สิ้นเดือน", () => {
  it("the deposits still held, before VAT — those fully deducted left out", () => {
    const rows = depositRows([
      { customerPoNo: "PO-2", buyerName: "บริษัท เอ จำกัด", receivedSatang: 107000, receivedExVatSatang: 100000, deductedSatang: 100000 },
      { customerPoNo: "PO-1", buyerName: "บริษัท เอ จำกัด", receivedSatang: 321000, receivedExVatSatang: 300000, deductedSatang: 100000 },
    ]);
    expect(rows).toEqual([
      { "PO ลูกค้า": "PO-1", "ลูกค้า": "บริษัท เอ จำกัด", "รับมัดจำ (รวม VAT)": 3210, "มัดจำก่อน VAT": 3000, "หักในใบแจ้งหนี้แล้ว (ก่อน VAT)": 1000, "คงเหลือ (ก่อน VAT)": 2000 },
      { "PO ลูกค้า": "", "ลูกค้า": "รวม", "รับมัดจำ (รวม VAT)": 3210, "มัดจำก่อน VAT": 3000, "หักในใบแจ้งหนี้แล้ว (ก่อน VAT)": 1000, "คงเหลือ (ก่อน VAT)": 2000 },
    ]);
    expect(depositRows([])).toEqual([]);
  });
});

describe("accountantWorkbook", () => {
  const SELLER = { name: "บริษัท โปรฟิน แล็บ จำกัด", address: "93 นนทบุรี", taxId: TAX_ID, branchCode: "00000", phone: "", email: "" };
  const data = { month: "2026-11", seller: SELLER, salesTax: [], externalReceipts: [], register: [], payments: [], receivables: [], deposits: [] };

  it("six sheets in the order the accountant reads them, each headed — the file named by the month", () => {
    const wb = accountantWorkbook(data);
    expect(wb.filename).toBe("accounting-2026-11.xlsx");
    expect(wb.sheets.map((s) => s.name)).toEqual(["ภาษีขาย", "ทะเบียนเอกสาร", "รับชำระ", "หัก ณ ที่จ่าย", "ลูกหนี้คงค้าง", "มัดจำคงเหลือ"]);
    expect(wb.sheets[0].title).toEqual([
      "รายงานภาษีขาย",
      "เดือนภาษี พฤศจิกายน 2569",
      "ชื่อผู้ประกอบการ: บริษัท โปรฟิน แล็บ จำกัด",
      `เลขประจำตัวผู้เสียภาษีอากร: ${formatTaxId(TAX_ID)} · สำนักงานใหญ่`,
    ]);
    expect(wb.sheets[4].title![0]).toBe("ลูกหนี้คงค้าง ณ วันที่ 30 Nov 2026");
    expect(wb.sheets[0].moneyColumns).toEqual(["มูลค่าสินค้าหรือบริการ", "ภาษีมูลค่าเพิ่ม", "จำนวนเงินรวม"]);
    expect(wb.sheets.every((s) => s.autoSizeColumns && (s.moneyColumns ?? []).length > 0)).toBe(true);
  });

  it("refuses a month that is not one", () => {
    expect(() => accountantWorkbook({ ...data, month: "2026-13" })).toThrow();
  });
});
