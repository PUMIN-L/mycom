// @vitest-environment node
import { describe, it, expect } from "vitest";
import { isCostRowFilled, saleFormProblems, saleFormSnapshot } from "@/app/dashboard/saleFormHelpers";
import { emptyForm, type CostItemLocal } from "@/app/dashboard/types";

const row = (over: Partial<CostItemLocal> = {}): CostItemLocal => ({ costType: "product_cost", label: "", amount: 0, note: "", ...over });
const snap = (over: Partial<Parameters<typeof saleFormSnapshot>[0]> = {}) =>
  saleFormSnapshot({ form: { ...emptyForm(), saleDate: "2026-11-18" }, costItems: [], quotationId: "", lines: [], ...over });

describe("isCostRowFilled", () => {
  it("is false for the empty row the cost calculator adds", () => {
    expect(isCostRowFilled(row())).toBe(false);
    expect(isCostRowFilled(row({ label: "   ", note: " " }))).toBe(false);
    expect(isCostRowFilled(row({ costType: "transport" }))).toBe(false);
  });

  it("is true once an amount, a label or a note is in it", () => {
    expect(isCostRowFilled(row({ amount: 500 }))).toBe(true);
    expect(isCostRowFilled(row({ label: "ค่ารถ" }))).toBe(true);
    expect(isCostRowFilled(row({ note: "จ่ายสด" }))).toBe(true);
  });
});

describe("saleFormSnapshot", () => {
  it("is the same for the same form", () => {
    expect(snap()).toBe(snap());
  });

  it("changes with anything typed into the form", () => {
    const base = snap();
    expect(snap({ form: { ...emptyForm(), saleDate: "2026-11-18", poRef: "PO-1" } })).not.toBe(base);
    expect(snap({ form: { ...emptyForm(), saleDate: "2026-11-18", serialNumbers: ["SN-1"] } })).not.toBe(base);
    expect(snap({ costItems: [row({ amount: 1 })] })).not.toBe(base);
    expect(snap({ quotationId: "q-1" })).not.toBe(base);
  });

  it("does not count an empty cost row as typing", () => {
    expect(snap({ costItems: [row()] })).toBe(snap());
  });

  it("ignores the read-only copy of the machines an edited sale already has", () => {
    const machines = [{ id: "e1", serialNumber: "SN-1", productId: "p1", productName: "A" }];
    expect(snap({ form: { ...emptyForm(), saleDate: "2026-11-18", loadedEquipments: machines } })).toBe(snap());
  });
});

// Item 4 — what stops a save: the fields to paint red, and the same in words.
describe("saleFormProblems", () => {
  const filled = { ...emptyForm(), saleDate: "2026-11-18", poRef: "PO-1", productName: "เครื่องชั่ง", qty: 1, unitPrice: 5000, saleType: "service" as const };
  const check = (over: Partial<Parameters<typeof saleFormProblems>[0]> = {}) =>
    saleFormProblems({ form: filled, useLines: false, lineErrors: [], missingCosts: [], costItems: [{ costType: "product_cost", amount: 3000 }], showCostCalc: true, ...over });

  it("has nothing to say about a complete sale", () => {
    expect(check()).toEqual({ errors: {}, missing: [] });
  });

  it("names every missing field, in the form's order", () => {
    const { errors, missing } = check({ form: { ...filled, saleDate: "", poRef: " ", productName: "", qty: 0, unitPrice: 0, saleType: "equipment", warrantyStartDate: "", warrantyEndDate: "" } });
    expect(Object.keys(errors).sort()).toEqual(["poRef", "productName", "qty", "saleDate", "unitPrice", "warrantyEndDate", "warrantyStartDate"]);
    expect(missing).toEqual(["วันที่ขาย", "ชื่อสินค้า", "จำนวน", "ราคา", "อ้างอิง PO", "วันเริ่มรับประกัน", "วันสิ้นสุดรับประกัน"]);
  });

  it("asks for the invoice once a delivery note is referenced", () => {
    expect(check({ form: { ...filled, deliveryRef: "DO-1", invoiceRef: "" } }).missing).toEqual(["อ้างอิง Invoice"]);
  });

  it("a sale without a quotation needs a cost: the calculator closed, empty, or a row with no amount", () => {
    const cost = "ต้นทุน (กรุณาเปิดเครื่องคิดต้นทุน แล้วกรอกยอดต้นทุน)";
    expect(check({ showCostCalc: false }).missing).toEqual([cost]);
    expect(check({ costItems: [] }).missing).toEqual([cost]);
    expect(check({ costItems: [{ costType: "product_cost", amount: 3000 }, { costType: "transport", amount: 0 }] }).missing).toEqual([cost]);
  });

  it("a quotation's lines: their own problems, each line missing its cost by name, and no bill-level product cost", () => {
    const { errors, missing } = check({
      useLines: true,
      lineErrors: ["รายการที่ 2: กรุณาระบุต้นทุนสินค้า", "รายการที่ 3: จำนวนต้องมากกว่า 0"],
      missingCosts: [{ lineIndex: 1, productName: "ตุ้มน้ำหนัก" } as never],
      costItems: [{ costType: "product_cost", amount: 100 }],
    });
    expect(errors).toEqual({ lines: true, lineCost: true, productCostOnBill: true });
    expect(missing).toEqual([
      "ต้นทุนสินค้าของรายการที่ 2 (ตุ้มน้ำหนัก) (กรอกที่ช่อง «ต้นทุนสินค้า» ของแต่ละรายการ)",
      "ย้ายรายการ «ต้นทุนสินค้า» ในตัวช่วยคำนวณต้นทุนไปกรอกที่แต่ละรายการสินค้า",
      "รายการที่ 3: จำนวนต้องมากกว่า 0",
    ]);
    // Product fields are on the lines then — never asked for on the form.
    expect(check({ useLines: true, costItems: [], form: { ...filled, productName: "", qty: 0, unitPrice: 0 } }).missing).toEqual([]);
  });
});
