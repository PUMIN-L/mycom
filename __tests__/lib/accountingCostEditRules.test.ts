// @vitest-environment node
/**
 * Editing one delivery's costs on the commission screen — the rules, pure
 * (lib/accounting/costEditRules.ts), the same in the browser and on the server:
 *  • what an edit is: each product line's cost (absolute), the other costs
 *    added / changed / removed, and the delivery's cost as it was when the
 *    editor opened;
 *  • what is wrong with one, in Thai;
 *  • the one line the PO's history keeps of it.
 */
import { describe, it, expect } from "vitest";
import {
  COST_EDIT_LIMITS,
  EDITABLE_COST_TYPES,
  MAX_COST_SATANG,
  NOTHING_TO_SAVE,
  cleanCostEdit,
  costEditDetail,
  costEditProblems,
  type CostEditInput,
} from "@/app/lib/accounting/costEditRules";

const edit = (o: Partial<CostEditInput> = {}): CostEditInput => ({ saleId: "c1", expectedCostSatang: 0, lines: [], add: [], update: [], remove: [], ...o });
const row = (o: Record<string, unknown> = {}) => ({ costType: "shipping", label: "Kerry", note: "", amountSatang: 50_000, ...o }) as CostEditInput["add"][number];

describe("cleanCostEdit — what the browser sent, reduced to its fields", () => {
  it("keeps the fields it knows, the text trimmed", () => {
    expect(
      cleanCostEdit({
        saleId: " c1 ",
        expectedCostSatang: 1_000,
        lines: [{ id: "l1", costSatang: 500, extra: 1 }],
        add: [{ costType: "shipping", label: " Kerry ", note: " ", amountSatang: 50_000 }],
        update: [{ id: "x1", costType: "transport", label: "", note: "รถบริษัท", amountSatang: 1_500 }],
        remove: ["x2"],
        other: true,
      })
    ).toEqual({
      saleId: "c1",
      expectedCostSatang: 1_000,
      lines: [{ id: "l1", costSatang: 500 }],
      add: [{ costType: "shipping", label: "Kerry", note: "", amountSatang: 50_000 }],
      update: [{ id: "x1", costType: "transport", label: "", note: "รถบริษัท", amountSatang: 1_500 }],
      remove: ["x2"],
    });
  });

  it("a list left out is empty; anything that is not an edit is null", () => {
    expect(cleanCostEdit({ saleId: "c1", expectedCostSatang: 0 })).toEqual(edit());
    for (const bad of [
      null,
      "x",
      { expectedCostSatang: 0 },
      { saleId: "", expectedCostSatang: 0 },
      { saleId: "c1" },
      { saleId: "c1", expectedCostSatang: "0" },
      { saleId: "c1", expectedCostSatang: 0, lines: "x" },
      { saleId: "c1", expectedCostSatang: 0, lines: [{ id: 5, costSatang: 1 }] },
      { saleId: "c1", expectedCostSatang: 0, add: [{ costType: "shipping", amountSatang: "5" }] },
      { saleId: "c1", expectedCostSatang: 0, update: [{ costType: "shipping", amountSatang: 5 }] },
      { saleId: "c1", expectedCostSatang: 0, remove: [1] },
    ]) {
      expect(cleanCostEdit(bad)).toBeNull();
    }
  });
});

describe("costEditProblems — what is wrong, in Thai", () => {
  it("a good edit has nothing wrong", () => {
    expect(
      costEditProblems(
        edit({
          lines: [{ id: "l1", costSatang: 0 }, { id: "l2", costSatang: 3_000_000 }],
          add: [row()],
          update: [{ id: "x1", ...row({ costType: "commission", label: "", amountSatang: 100 }) }],
          remove: ["x2"],
        })
      )
    ).toEqual([]);
    expect(EDITABLE_COST_TYPES).toEqual(["transport", "shipping", "service_visit", "repair", "commission", "other"]);
  });

  it("nothing in it — nothing to save", () => {
    expect(costEditProblems(edit())).toEqual([NOTHING_TO_SAVE]);
  });

  it("a product's cost: whole satang, 0 or more, not past what the column holds", () => {
    expect(costEditProblems(edit({ lines: [{ id: "l1", costSatang: -1 }] }))).toEqual(["ต้นทุนสินค้า: ต้องเป็นจำนวนเงินตั้งแต่ 0 บาทขึ้นไป"]);
    expect(costEditProblems(edit({ lines: [{ id: "l1", costSatang: 1.5 }] }))).toEqual(["ต้นทุนสินค้า: ต้องเป็นจำนวนเงินตั้งแต่ 0 บาทขึ้นไป"]);
    expect(costEditProblems(edit({ lines: [{ id: "l1", costSatang: MAX_COST_SATANG + 1 }] }))).toEqual(["ต้นทุนสินค้า: จำนวนเงินสูงเกินไป (สูงสุด 9,999,999,999.99 บาท)"]);
    expect(costEditProblems(edit({ lines: [{ id: "l1", costSatang: MAX_COST_SATANG }] }))).toEqual([]);
  });

  it("another cost: a kind from the list (never ต้นทุนสินค้า), more than 0, its text not too long — named in the message", () => {
    expect(costEditProblems(edit({ add: [row({ costType: "product_cost" })] }))).toEqual(["กรุณาเลือกประเภทของค่าใช้จ่ายทุกรายการ"]);
    expect(costEditProblems(edit({ add: [row({ costType: "" })] }))).toEqual(["กรุณาเลือกประเภทของค่าใช้จ่ายทุกรายการ"]);
    expect(costEditProblems(edit({ add: [row({ amountSatang: 0 })] }))).toEqual(["ค่าขนส่ง (Kerry): จำนวนเงินต้องมากกว่า 0 — ถ้าไม่ใช้รายการนี้ ให้กดลบ"]);
    expect(costEditProblems(edit({ update: [{ id: "x1", ...row({ costType: "transport", label: "", amountSatang: MAX_COST_SATANG + 1 }) }] }))).toEqual([
      "ค่ารถ / ค่าเดินทาง: จำนวนเงินสูงเกินไป (สูงสุด 9,999,999,999.99 บาท)",
    ]);
    expect(costEditProblems(edit({ add: [row({ label: "ก".repeat(COST_EDIT_LIMITS.label + 1) })] }))[0]).toMatch(/: รายละเอียดยาวเกิน 255 ตัวอักษร$/);
    expect(costEditProblems(edit({ add: [row({ note: "ก".repeat(COST_EDIT_LIMITS.note + 1) })] }))).toEqual(["ค่าขนส่ง (Kerry): หมายเหตุยาวเกิน 1,000 ตัวอักษร"]);
  });

  it("the same line or row named twice, or changed and removed at once — refused", () => {
    expect(costEditProblems(edit({ lines: [{ id: "l1", costSatang: 1 }, { id: "l1", costSatang: 2 }] }))).toEqual(["มีรายการเดียวกันซ้ำ — กรุณาโหลดใหม่แล้วแก้อีกครั้ง"]);
    expect(costEditProblems(edit({ update: [{ id: "x1", ...row() }], remove: ["x1"] }))).toEqual(["มีรายการเดียวกันซ้ำ — กรุณาโหลดใหม่แล้วแก้อีกครั้ง"]);
    expect(costEditProblems(edit({ remove: ["x1", "x1"] }))).toEqual(["มีรายการเดียวกันซ้ำ — กรุณาโหลดใหม่แล้วแก้อีกครั้ง"]);
  });

  it("not more rows than one delivery could have", () => {
    const many = Array.from({ length: COST_EDIT_LIMITS.rows + 1 }, () => row());
    expect(costEditProblems(edit({ add: many }))).toEqual([`ค่าใช้จ่ายมากเกินไป — ได้ไม่เกิน ${COST_EDIT_LIMITS.rows} รายการต่อครั้ง`]);
  });
});

describe("costEditDetail — the one line the PO's history keeps", () => {
  it("each change, before → after, and the delivery's cost before → after", () => {
    expect(
      costEditDetail({
        invoiceRef: "INV2026110004",
        lines: [{ productName: "COMETECH QC-548D2 (5kN)", beforeSatang: 0, afterSatang: 3_000_000 }],
        added: [{ costType: "shipping", label: "Kerry", amountSatang: 50_000 }],
        updated: [
          { before: { costType: "transport", label: "", amountSatang: 20_000 }, after: { costType: "transport", label: "", amountSatang: 30_000 } },
          { before: { costType: "other", label: "ทิป", amountSatang: 5_000 }, after: { costType: "repair", label: "", amountSatang: 5_000 } },
          { before: { costType: "repair", label: "", amountSatang: 7_000 }, after: { costType: "repair", label: "", amountSatang: 7_000 } },
        ],
        removed: [{ costType: "other", label: "ทิป", amountSatang: 10_000 }],
        totalBeforeSatang: 30_000,
        totalAfterSatang: 3_080_000,
      })
    ).toBe(
      "แก้ต้นทุน INV2026110004 · ต้นทุนสินค้า COMETECH QC-548D2 (5kN) 0.00 → 30,000.00 · เพิ่ม ค่าขนส่ง (Kerry) 500.00 · " +
        "แก้ ค่ารถ / ค่าเดินทาง 200.00 → 300.00 · แก้ อื่นๆ (ทิป) 50.00 → ค่าซ่อม 50.00 · แก้หมายเหตุ ค่าซ่อม · " +
        "ลบ อื่นๆ (ทิป) 100.00 · ต้นทุนรวม 300.00 → 30,800.00"
    );
  });

  it("a delivery with no number still says which", () => {
    expect(
      costEditDetail({ invoiceRef: "", lines: [], added: [{ costType: "other", label: "", amountSatang: 100 }], updated: [], removed: [], totalBeforeSatang: 0, totalAfterSatang: 100 })
    ).toBe("แก้ต้นทุน (การส่งของที่ไม่มีเลขที่) · เพิ่ม อื่นๆ 1.00 · ต้นทุนรวม 0.00 → 1.00");
  });
});
