// @vitest-environment node
/**
 * Which sales /dashboard's table lists (and exports): the period on screen,
 * a Top 10 row by the same keys the dashboard API groups by, and the search.
 */
import { describe, it, expect } from "vitest";
import {
  UNSPECIFIED_ID,
  filterSalesRecords,
  inDateRange,
  matchesFocus,
  matchesSearch,
  salesExportFileName,
} from "@/app/dashboard/salesFilters";
import type { SalesRecord } from "@/app/lib/types";

function sale(over: Partial<SalesRecord> = {}): SalesRecord {
  return {
    id: "s1", salespersonId: "sp1", customerId: "c1", companyId: "co1",
    productId: "p-a", productName: "Scale A", categoryId: null,
    qty: 1, unitPrice: 100, totalAmount: 100, costAmount: 50,
    saleType: "equipment", saleDate: "2026-10-05",
    quotationRef: "QT-7", poRef: "", deliveryRef: "", invoiceRef: "", receiptRef: "",
    warrantyStartDate: null, warrantyEndDate: null, equipmentId: null, note: "", createdAt: "",
    salespersonName: "สมชาย", customerName: "คุณเอ", companyName: "บริษัท เอ",
    ...over,
  };
}

const OCT = { start: "2026-10-01", end: "2026-11-01" };

describe("inDateRange", () => {
  it("keeps the first day and drops the end day (exclusive)", () => {
    expect(inDateRange(sale({ saleDate: "2026-10-01" }), OCT)).toBe(true);
    expect(inDateRange(sale({ saleDate: "2026-10-31" }), OCT)).toBe(true);
    expect(inDateRange(sale({ saleDate: "2026-11-01" }), OCT)).toBe(false);
    expect(inDateRange(sale({ saleDate: "2026-09-30" }), OCT)).toBe(false);
  });

  it("drops a sale without a date", () => {
    expect(inDateRange(sale({ saleDate: "" }), OCT)).toBe(false);
  });
});

describe("matchesFocus — a Top 10 สินค้า row", () => {
  const twoProducts = sale({
    lineItems: [
      { productId: "p-a", productName: "Scale A" },
      { productId: "p-b", productName: "Scale B" },
    ],
  });

  it("finds a bill by ANY product on it, not only the one its columns name", () => {
    expect(matchesFocus(twoProducts, { kind: "product", id: "p-b", name: "Scale B" })).toBe(true);
    expect(matchesFocus(twoProducts, { kind: "product", id: "p-a", name: "Scale A" })).toBe(true);
    expect(matchesFocus(twoProducts, { kind: "product", id: "p-c", name: "Scale C" })).toBe(false);
  });

  it("keeps the API's grouping: the same product under another name is another row", () => {
    expect(matchesFocus(twoProducts, { kind: "product", id: "p-b", name: "Scale B (old)" })).toBe(false);
  });

  it("compares names the way the database groups them — case and outer spaces aside", () => {
    expect(matchesFocus(twoProducts, { kind: "product", id: "p-b", name: " scale b " })).toBe(true);
  });

  it("matches a line with no product id, or no name, as the API names it", () => {
    const custom = sale({ lineItems: [{ productId: "", productName: "" }, { productId: "", productName: "ค่าติดตั้ง" }] });
    expect(matchesFocus(custom, { kind: "product", id: UNSPECIFIED_ID, name: "ไม่ระบุสินค้า" })).toBe(true);
    expect(matchesFocus(custom, { kind: "product", id: UNSPECIFIED_ID, name: "ค่าติดตั้ง" })).toBe(true);
  });

  it("falls back to the record's own product when the list sent no line items", () => {
    expect(matchesFocus(sale(), { kind: "product", id: "p-a", name: "Scale A" })).toBe(true);
    expect(matchesFocus(sale({ lineItems: [] }), { kind: "product", id: "p-a", name: "Scale A" })).toBe(true);
  });
});

describe("matchesFocus — a Top 10 ลูกค้า row", () => {
  it("is the sale's company, by id", () => {
    expect(matchesFocus(sale(), { kind: "company", id: "co1", name: "บริษัท เอ" })).toBe(true);
    expect(matchesFocus(sale(), { kind: "company", id: "co2", name: "บริษัท เอ" })).toBe(false);
  });

  it("puts a sale with no company under ไม่ระบุ", () => {
    expect(matchesFocus(sale({ companyId: "" }), { kind: "company", id: UNSPECIFIED_ID, name: "ไม่ระบุ" })).toBe(true);
    expect(matchesFocus(sale({ companyId: null as unknown as string }), { kind: "company", id: UNSPECIFIED_ID, name: "ไม่ระบุ" })).toBe(true);
  });
});

describe("matchesSearch", () => {
  it("is every sale for an empty or blank search", () => {
    expect(matchesSearch(sale(), "")).toBe(true);
    expect(matchesSearch(sale(), "   ")).toBe(true);
  });

  it("looks through the customer, company, salesperson, date and quotation number, ignoring case and outer spaces", () => {
    for (const q of ["คุณเอ", "บริษัท เอ", "สมชาย", "2026-10", "qt-7", "  scale a "]) {
      expect(matchesSearch(sale(), q)).toBe(true);
    }
    expect(matchesSearch(sale(), "ไม่มีแน่นอน")).toBe(false);
  });

  it("finds any product on the bill, and reads a rich name as text", () => {
    const bill = sale({ lineItems: [{ productId: "p-a", productName: "Scale A" }, { productId: "p-b", productName: "<p>ตู้อบ &amp; ถาด</p>" }] });
    expect(matchesSearch(bill, "ตู้อบ & ถาด")).toBe(true);
  });
});

describe("filterSalesRecords", () => {
  const sales = [
    sale({ id: "oct-a", saleDate: "2026-10-05" }),
    sale({ id: "oct-b", saleDate: "2026-10-20", companyId: "co2", customerName: "คุณบี", lineItems: [{ productId: "p-b", productName: "Scale B" }] }),
    sale({ id: "sep-a", saleDate: "2026-09-30" }),
  ];
  const ids = (list: SalesRecord[]) => list.map((r) => r.id);

  it("keeps to the range, or to every period when there is none", () => {
    expect(ids(filterSalesRecords(sales, { range: OCT, focus: null, search: "" }))).toEqual(["oct-a", "oct-b"]);
    expect(ids(filterSalesRecords(sales, { range: null, focus: null, search: "" }))).toEqual(["oct-a", "oct-b", "sep-a"]);
  });

  it("applies the range, the focus and the search together", () => {
    expect(ids(filterSalesRecords(sales, { range: OCT, focus: { kind: "company", id: "co1", name: "บริษัท เอ" }, search: "" }))).toEqual(["oct-a"]);
    expect(ids(filterSalesRecords(sales, { range: null, focus: { kind: "company", id: "co1", name: "บริษัท เอ" }, search: "" }))).toEqual(["oct-a", "sep-a"]);
    expect(ids(filterSalesRecords(sales, { range: OCT, focus: null, search: "คุณบี" }))).toEqual(["oct-b"]);
  });
});

describe("salesExportFileName", () => {
  it("names the file after the period, or all", () => {
    expect(salesExportFileName("2026")).toBe("sales-report-2026.xlsx");
    expect(salesExportFileName("2026-Q4")).toBe("sales-report-2026-Q4.xlsx");
    expect(salesExportFileName("2026-10")).toBe("sales-report-2026-10.xlsx");
    expect(salesExportFileName(null)).toBe("sales-report-all.xlsx");
  });
});
