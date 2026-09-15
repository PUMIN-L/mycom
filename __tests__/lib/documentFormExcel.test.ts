// @vitest-environment node
import { describe, it, expect } from "vitest";
import { buildDocumentFormSheet, type DocumentFormOptions } from "@/app/lib/documentFormExcel";

function baseOptions(overrides: Partial<DocumentFormOptions> = {}): DocumentFormOptions {
  return {
    titleTh: "ใบสั่งซื้อ",
    titleEn: "PURCHASE ORDER",
    primaryParty: { label: "ผู้ซื้อ (เรา)", name: "บริษัท โปรฟิน แล็บสเกล จำกัด", lines: ["93 ถนนงามวงศ์วาน", "เลขผู้เสียภาษี 0-0000-00000-00-0"] },
    secondaryParty: { label: "ผู้ขาย (Supplier)", name: "บริษัท ก จำกัด", lines: ["ที่อยู่ ก", null, "โทร 020000000"] },
    metaRows: [
      { label: "เลขที่ (No.)", value: "PO150926-22" },
      { label: "วันที่ (Date)", value: "15 ก.ย. 2569" },
    ],
    columns: [
      { key: "no", header: "ลำดับ", width: 6, align: "center" },
      { key: "name", header: "รายการ", width: 30 },
      { key: "qty", header: "จำนวน", width: 10, numeric: true },
      { key: "amount", header: "จำนวนเงิน", width: 14, numeric: true },
    ],
    items: [
      { no: 1, name: "น็อตหกเหลี่ยม", qty: 10, amount: 500 },
      { no: 2, name: "สกรู", qty: 20, amount: 800 },
    ],
    totals: [
      { label: "ยอดรวมก่อนภาษี", value: "1,300.00" },
      { label: "ภาษีมูลค่าเพิ่ม 7%", value: "91.00" },
      { label: "ยอดรวมสุทธิ", value: "1,391.00", emphasize: true },
    ],
    notes: [{ label: "เงื่อนไขการชำระเงิน", text: "ชำระเงิน 100% ก่อนส่งมอบสินค้า" }],
    signatures: ["ผู้สั่งซื้อ", "ผู้อนุมัติ", "ผู้ขาย"],
    ...overrides,
  };
}

describe("buildDocumentFormSheet", () => {
  it("renders the title as one merged row spanning every column", () => {
    const { rows, merges, columnWidths } = buildDocumentFormSheet(baseOptions());
    expect(rows[0][0].v).toBe("ใบสั่งซื้อ / PURCHASE ORDER");
    expect(rows[0][0].s?.font?.bold).toBe(true);
    expect(merges[0]).toEqual({ s: { r: 0, c: 0 }, e: { r: 0, c: columnWidths.length - 1 } });
  });

  it("prints both party blocks, skipping null/blank extra lines", () => {
    const { rows } = buildDocumentFormSheet(baseOptions());
    const texts = rows.map((r) => r[0].v as string);
    expect(texts).toContain("ผู้ซื้อ (เรา): บริษัท โปรฟิน แล็บสเกล จำกัด");
    expect(texts).toContain("ผู้ขาย (Supplier): บริษัท ก จำกัด");
    expect(texts).toContain("ที่อยู่ ก");
    expect(texts).toContain("โทร 020000000");
    // The null line in secondaryParty.lines must not produce an empty row.
    expect(texts.filter((t) => t === "-")).toHaveLength(0);
  });

  it("writes one bordered item row per input item, matching the column count", () => {
    const opts = baseOptions();
    const { rows } = buildDocumentFormSheet(opts);
    const headerRowIdx = rows.findIndex((r) => r[0].v === "ลำดับ");
    expect(headerRowIdx).toBeGreaterThan(-1);
    expect(rows[headerRowIdx]).toHaveLength(opts.columns.length);
    expect(rows[headerRowIdx][0].s?.fill?.fgColor.rgb).toBeDefined();

    const itemRow1 = rows[headerRowIdx + 1];
    expect(itemRow1[1].v).toBe("น็อตหกเหลี่ยม");
    expect(itemRow1[2].v).toBe(10);
    expect(itemRow1[2].t).toBe("n");
    const itemRow2 = rows[headerRowIdx + 2];
    expect(itemRow2[1].v).toBe("สกรู");
  });

  it("shows a placeholder row instead of an empty table when there are no items", () => {
    const { rows } = buildDocumentFormSheet(baseOptions({ items: [] }));
    const headerRowIdx = rows.findIndex((r) => r[0].v === "ลำดับ");
    expect(rows[headerRowIdx + 1][0].v).toBe("— ไม่มีรายการ —");
  });

  it("bolds and rules only the emphasized (grand total) row", () => {
    const { rows } = buildDocumentFormSheet(baseOptions());
    const grandTotalRow = rows.find((r) => r[0].v === "ยอดรวมสุทธิ");
    const vatRow = rows.find((r) => r[0].v === "ภาษีมูลค่าเพิ่ม 7%");
    expect(grandTotalRow?.[0].s?.font?.bold).toBe(true);
    expect(grandTotalRow?.[0].s?.border?.top).toBeDefined();
    expect(vatRow?.[0].s?.font?.bold).toBeFalsy();
  });

  it("omits the totals block entirely for a non-money document (e.g. a service job sheet)", () => {
    const { rows } = buildDocumentFormSheet(baseOptions({ totals: undefined }));
    expect(rows.some((r) => r[0].v === "ยอดรวมสุทธิ")).toBe(false);
  });

  it("lays out one bordered signature line + label per name, spread across the columns", () => {
    const { rows, merges } = buildDocumentFormSheet(baseOptions());
    const labelRowIdx = rows.findIndex((r) => r.some((c) => c.v === "ผู้สั่งซื้อ"));
    expect(labelRowIdx).toBeGreaterThan(-1);
    const lineRowIdx = labelRowIdx - 1;
    expect(rows[lineRowIdx].some((c) => c.s?.border?.bottom)).toBe(true);
    // Three signatures were requested — the label row should show all three.
    const labels = rows[labelRowIdx].map((c) => c.v).filter(Boolean);
    expect(labels).toEqual(["ผู้สั่งซื้อ", "ผู้อนุมัติ", "ผู้ขาย"]);
    expect(merges.length).toBeGreaterThan(0);
  });

  it("never crashes with a minimal 4-column non-money document (fewer columns than signatures)", () => {
    const { rows } = buildDocumentFormSheet(
      baseOptions({
        columns: [
          { key: "no", header: "ลำดับ", width: 6, align: "center" },
          { key: "name", header: "ชื่อสินค้า", width: 30 },
          { key: "serial", header: "หมายเลขซีเรียล", width: 20 },
        ],
        items: [{ no: 1, name: "เครื่องชั่ง A", serial: "SN-1" }],
        totals: undefined,
      })
    );
    expect(rows.some((r) => r[0].v === "เครื่องชั่ง A")).toBe(false); // it's in column 1, not 0
    const headerRowIdx = rows.findIndex((r) => r[0].v === "ลำดับ");
    expect(rows[headerRowIdx + 1][1].v).toBe("เครื่องชั่ง A");
  });
});
