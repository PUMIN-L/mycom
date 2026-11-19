/**
 * Deposits and the payment plan (lib/accounting/depositRules.ts) — pure:
 *  • the VAT inside a deposit (what its receipt/tax invoice shows);
 *  • a deposit never more than the PO still holds, before VAT;
 *  • a delivery deducts its share of the deposit, the last one the rest —
 *    never more than its own value;
 *  • a plan's items stand where the money that came in puts them.
 * Every figure is worked out by hand.
 */
import { describe, it, expect } from "vitest";
import {
  cleanPlan,
  deliveryDepositSatang,
  depositLeftSatang,
  depositRoomSatang,
  planProblems,
  planProgress,
  vatInsideSatang,
} from "@/app/lib/accounting/depositRules";
import type { OrderForDelivery, OrderLineForDelivery } from "@/app/lib/accounting/orderRules";
import type { DocLineInput } from "@/app/lib/accounting/invoiceRules";

describe("vatInsideSatang", () => {
  it("takes 7% out of an amount that includes it, half up", () => {
    expect(vatInsideSatang(3210000, 7)).toBe(210000); // 32,100.00 → 2,100.00
    expect(vatInsideSatang(100, 7)).toBe(7); // 1.00 → 0.0654… → 0.07
    expect(vatInsideSatang(0, 7)).toBe(0);
    expect(vatInsideSatang(10700, 0)).toBe(0);
  });
});

describe("depositLeftSatang / depositRoomSatang", () => {
  it("is what was received less what invoices deducted, never below nothing", () => {
    expect(depositLeftSatang({ receivedExVatSatang: 3000000, deductedSatang: 1000000 })).toBe(2000000);
    expect(depositLeftSatang({ receivedExVatSatang: 0, deductedSatang: 10 })).toBe(0);
  });

  it("lets a deposit (VAT included) take up what the PO still holds, before VAT, less what is not yet deducted", () => {
    // Still to deliver 100,000.00; 30,000.00 deposited, none deducted → 70,000.00 + VAT = 74,900.00
    expect(depositRoomSatang({ backlogSatang: 10000000, receivedExVatSatang: 3000000, deductedSatang: 0, vatRate: 7 })).toBe(7490000);
    // Its VAT taken out again is no more than the room.
    expect(7490000 - vatInsideSatang(7490000, 7)).toBe(7000000);
    expect(depositRoomSatang({ backlogSatang: 1001, receivedExVatSatang: 0, deductedSatang: 0, vatRate: 7 })).toBe(1071);
  });

  it("is nothing once the deposits not yet deducted cover all that is left", () => {
    expect(depositRoomSatang({ backlogSatang: 3000000, receivedExVatSatang: 3000000, deductedSatang: 0, vatRate: 7 })).toBe(0);
    expect(depositRoomSatang({ backlogSatang: 0, receivedExVatSatang: 0, deductedSatang: 0, vatRate: 7 })).toBe(0);
  });
});

const line = (over: Partial<OrderLineForDelivery> & Pick<OrderLineForDelivery, "id">): OrderLineForDelivery => ({
  lineType: "goods", productId: "", name: "สินค้า", qty: 1, unit: "ชิ้น", unitPriceSatang: 10000, discountSatang: 0,
  isMachine: false, serials: "", warrantyMonths: null, deliveredQty: 0, invoicedDiscountSatang: 0, ...over,
});
const sent = (sourceLineId: string, qty: number, unitPriceSatang: number): DocLineInput => ({
  lineType: "goods", productId: "", name: "สินค้า", qty, unit: "ชิ้น", unitPriceSatang, discountSatang: 0,
  isMachine: false, serials: "", warrantyMonths: null, sourceLineId,
});

describe("deliveryDepositSatang", () => {
  // A: 4 × 250.00 = 1,000.00 · B: 1 × 500.00 · deposit left 300.00 (before VAT)
  const order: OrderForDelivery & { depositLeftSatang: number } = {
    id: "so1", customerPoNo: "PO-1", discountSatang: 0, invoicedDiscountSatang: 0, depositLeftSatang: 30000,
    lines: [line({ id: "a", qty: 4, unitPriceSatang: 25000 }), line({ id: "b", qty: 1, unitPriceSatang: 50000 })],
  };

  it("deducts in proportion to what is sent of what the PO still holds", () => {
    // 500.00 of 1,500.00 → 100.00
    expect(deliveryDepositSatang(order, [sent("a", 2, 25000)], false, 50000)).toBe(10000);
  });

  it("goes on from what is left after earlier deliveries", () => {
    // Two of A went (with 100.00 of the deposit): 500 + 500 still held, 200.00 left; two more of A → 100.00
    const later = { ...order, depositLeftSatang: 20000, lines: [{ ...order.lines[0], deliveredQty: 2 }, order.lines[1]] };
    expect(deliveryDepositSatang(later, [sent("a", 2, 25000)], false, 50000)).toBe(10000);
  });

  it("gives the delivery that empties the PO all that is left — never more than its own value", () => {
    expect(deliveryDepositSatang(order, [sent("a", 4, 25000), sent("b", 1, 50000)], true, 150000)).toBe(30000);
    expect(deliveryDepositSatang(order, [sent("a", 4, 25000), sent("b", 1, 50000)], true, 12000)).toBe(12000);
  });

  it("counts only the PO's own lines, and is nothing with no deposit left", () => {
    expect(deliveryDepositSatang(order, [sent("a", 2, 25000), sent("", 1, 900000)], false, 950000)).toBe(10000);
    expect(deliveryDepositSatang({ ...order, depositLeftSatang: 0 }, [sent("a", 2, 25000)], false, 50000)).toBe(0);
  });
});

describe("cleanPlan / planProblems", () => {
  it("takes an item's name, stage, amount and date — anything else as collected on the invoices", () => {
    expect(cleanPlan([{ label: " มัดจำ 30% ", stage: "deposit", amountSatang: "3210000", dueDate: "2026-11-20" }, { stage: "x", amountSatang: "abc" }])).toEqual([
      { label: "มัดจำ 30%", stage: "deposit", amountSatang: 3210000, dueDate: "2026-11-20" },
      { label: "", stage: "invoice", amountSatang: -1, dueDate: "" },
    ]);
    expect(cleanPlan("nope")).toEqual([]);
  });

  it("wants a name and an amount for each item, a real date when there is one", () => {
    const p = planProblems(
      [
        { label: "", stage: "deposit", amountSatang: 100, dueDate: "" },
        { label: "งวด 2", stage: "invoice", amountSatang: 0, dueDate: "2026-02-30" },
      ],
      10000000
    );
    expect(p.items[0]).toEqual({ label: "กรุณาตั้งชื่องวด เช่น มัดจำ 30%" });
    expect(p.items[1]).toEqual({ amountSatang: "ยอดต้องมากกว่า 0", dueDate: "วันที่ไม่ถูกต้อง" });
    expect(p.first).toBe("กรุณาตั้งชื่องวด เช่น มัดจำ 30%");
  });

  it("never plans more than the PO, VAT included — less is fine, and so is no plan", () => {
    const item = (amountSatang: number) => ({ label: "งวด", stage: "invoice" as const, amountSatang, dueDate: "" });
    expect(planProblems([item(6000000), item(4700001)], 10700000).total).toBe("ยอดรวมทุกงวดเกินยอด PO (รวม VAT)");
    expect(planProblems([item(6000000), item(4700000)], 10700000).first).toBeNull();
    expect(planProblems([item(1000)], 10700000).first).toBeNull();
    expect(planProblems([], 10700000).first).toBeNull();
    expect(planProblems(Array.from({ length: 25 }, () => item(1)), 10700000).total).toContain("ไม่เกิน 24 งวด");
  });
});

describe("planProgress", () => {
  it("applies the deposits to the deposit items and the invoices' payments to the others, in order", () => {
    const progress = planProgress(
      [
        { stage: "deposit", amountSatang: 3210000, dueDate: "2026-11-10" },
        { stage: "invoice", amountSatang: 7000000, dueDate: "2026-12-01" },
        { stage: "invoice", amountSatang: 490000, dueDate: "2026-11-01" },
      ],
      { depositSatang: 3210000, invoiceSatang: 5000000 },
      "2026-11-19"
    );
    expect(progress).toEqual([
      { receivedSatang: 3210000, status: "paid", late: false },
      { receivedSatang: 5000000, status: "partial", late: false },
      { receivedSatang: 0, status: "open", late: true },
    ]);
  });

  it("puts an item back when its money is no longer there (a payment voided)", () => {
    expect(planProgress([{ stage: "deposit", amountSatang: 100, dueDate: "" }], { depositSatang: 0, invoiceSatang: 999 }, "2026-11-19")).toEqual([
      { receivedSatang: 0, status: "open", late: false },
    ]);
  });
});
