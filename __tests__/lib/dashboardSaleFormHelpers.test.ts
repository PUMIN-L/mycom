// @vitest-environment node
import { describe, it, expect } from "vitest";
import { isCostRowFilled, saleFormSnapshot } from "@/app/dashboard/saleFormHelpers";
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
