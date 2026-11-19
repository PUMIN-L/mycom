/**
 * The rules of a customer PO (lib/accounting/orderRules.ts) — pure:
 *  • what the API takes: never a tax invoice, no serials, no PO pointers;
 *  • what is wrong with one: the customer's PO number, a delivery date not
 *    before the PO's own;
 *  • what it still holds, line by line and in baht ex VAT (the backlog);
 *  • a delivery's discounts: a line delivered in parts is discounted exactly
 *    as ordered, to the satang — the last part takes the rest;
 *  • nothing sent beyond what the PO still holds.
 * Every figure below is worked out by hand.
 */
import { describe, it, expect } from "vitest";
import {
  backlogSatang,
  cleanOrderInput,
  deliveryBillDiscount,
  deliveryCompletesOrder,
  deliveryLineDiscount,
  deliveryLinesOf,
  isOrderLate,
  orderProblems,
  orderStatusOf,
  overDeliveryProblems,
  remainingQty,
  type OrderForDelivery,
  type OrderInput,
  type OrderLineForDelivery,
} from "@/app/lib/accounting/orderRules";
import { invoiceProblems, type DocLineInput } from "@/app/lib/accounting/invoiceRules";

const ORDER: OrderInput = {
  issueDate: "2026-11-10", creditDays: 30, companyId: "co1", customerId: "c1", salespersonId: "",
  buyerName: "บริษัท เอ จำกัด", buyerAddress: "1 ถนนงามวงศ์วาน", buyerTaxId: "", buyerBranch: "",
  priceMode: "exclusive", discountSatang: 0, isTaxInvoice: false, customerPoNo: "PO-6611", projectName: "", note: "",
  lines: [{ lineType: "goods", productId: "p1", name: "เครื่องชั่ง", qty: 2, unit: "เครื่อง", unitPriceSatang: 5000000, discountSatang: 0, isMachine: true, serials: "", warrantyMonths: 12 }],
  salesOrderId: "", expectedDeliveryDate: "2026-11-30", storageNote: "แฟ้ม PO ลูกค้า 2569",
};

describe("cleanOrderInput", () => {
  it("is never a tax invoice, keeps a machine's mark and warranty, drops serials and PO pointers", () => {
    const cleaned = cleanOrderInput({
      ...ORDER,
      isTaxInvoice: true,
      salesOrderId: "so-x",
      lines: [{ ...ORDER.lines[0], serials: "SN-1", sourceLineId: "l-x" }],
      expectedDeliveryDate: "2026-11-30T00:00:00",
    });
    expect(cleaned.isTaxInvoice).toBe(false);
    expect(cleaned.salesOrderId).toBe("");
    expect(cleaned.lines[0]).toMatchObject({ isMachine: true, warrantyMonths: 12, serials: "", sourceLineId: "" });
    expect(cleaned.expectedDeliveryDate).toBe("2026-11-30");
    expect(cleaned.storageNote).toBe("แฟ้ม PO ลูกค้า 2569");
  });

  it("deducts no deposit — its delivery invoices do", () => {
    expect(cleanOrderInput({ ...ORDER, depositSatang: 500000 }).depositSatang).toBe(0);
  });

  it("keeps a storage note one character too long, so the rules can say so", () => {
    expect(cleanOrderInput({ ...ORDER, storageNote: "x".repeat(400) }).storageNote).toHaveLength(256);
  });
});

describe("orderProblems", () => {
  it("is fine as it is", () => {
    expect(orderProblems(ORDER, 7).first).toBeNull();
  });

  it("asks for the customer's PO number — first of all", () => {
    const p = orderProblems({ ...ORDER, customerPoNo: "", buyerName: "" }, 7);
    expect(p.fields.customerPoNo).toBe("กรุณากรอกเลขที่ PO ของลูกค้า");
    expect(p.first).toBe("กรุณากรอกเลขที่ PO ของลูกค้า");
  });

  it("names the date as the PO's", () => {
    expect(orderProblems({ ...ORDER, issueDate: "" }, 7).fields.issueDate).toBe("กรุณาเลือกวันที่ของ PO");
  });

  it("takes no delivery date, but never one before the PO's own or one that is not a date", () => {
    expect(orderProblems({ ...ORDER, expectedDeliveryDate: "" }, 7).first).toBeNull();
    expect(orderProblems({ ...ORDER, expectedDeliveryDate: "2026-11-10" }, 7).first).toBeNull();
    expect(orderProblems({ ...ORDER, expectedDeliveryDate: "2026-11-09" }, 7).fields.expectedDeliveryDate).toBe("กำหนดส่งต้องไม่ก่อนวันที่ของ PO");
    expect(orderProblems({ ...ORDER, expectedDeliveryDate: "2026-02-30" }, 7).fields.expectedDeliveryDate).toBe("กำหนดส่งไม่ถูกต้อง");
  });

  it("refuses a storage note over 255 characters", () => {
    expect(orderProblems({ ...ORDER, storageNote: "x".repeat(256) }, 7).fields.storageNote).toBe("ยาวเกิน 255 ตัวอักษร");
  });

  it("takes more machines than one invoice may register — each delivery invoice is capped, not the PO", () => {
    const sixty = { ...ORDER, lines: [{ ...ORDER.lines[0], qty: 60 }] };
    expect(orderProblems(sixty, 7).first).toBeNull();
    expect(invoiceProblems(sixty, 7).fields.lines).toContain("ไม่เกิน 50 เครื่อง");
  });

  it("still applies the invoice's own rules to the lines", () => {
    const p = orderProblems({ ...ORDER, lines: [{ ...ORDER.lines[0], qty: 0 }] }, 7);
    expect(p.lines[0]?.qty).toBe("จำนวนต้องมากกว่า 0");
    expect(p.first).toBe("จำนวนต้องมากกว่า 0");
  });
});

describe("remainingQty", () => {
  it("is exact in hundredths, and never below nothing", () => {
    expect(remainingQty({ qty: 2.5, deliveredQty: 1.25 })).toBe(1.25);
    expect(remainingQty({ qty: 0.3, deliveredQty: 0.1 })).toBe(0.2);
    expect(remainingQty({ qty: 2, deliveredQty: 3 })).toBe(0);
  });
});

describe("orderStatusOf", () => {
  const lines = (...delivered: number[]) => delivered.map((d) => ({ qty: 2, deliveredQty: d }));
  it("รอส่งของ → ส่งบางส่วน → ส่งครบ, and ยกเลิก whatever was delivered", () => {
    expect(orderStatusOf({ status: "issued", lines: lines(0, 0) })).toBe("open");
    expect(orderStatusOf({ status: "issued", lines: lines(1, 0) })).toBe("partial");
    expect(orderStatusOf({ status: "issued", lines: lines(2, 1) })).toBe("partial");
    expect(orderStatusOf({ status: "issued", lines: lines(2, 2) })).toBe("complete");
    expect(orderStatusOf({ status: "void", lines: lines(1, 0) })).toBe("cancelled");
  });
});

describe("backlogSatang", () => {
  // A: 4 × 250.00 = 1,000.00 · B: 1 × 500.00 = 500.00 · bill discount 150.00 → VAT base 1,350.00
  const order = (deliveredA: number, deliveredB: number, status = "issued") => ({
    status,
    vatBaseSatang: 135000,
    lines: [
      { qty: 4, deliveredQty: deliveredA, amountSatang: 100000 },
      { qty: 1, deliveredQty: deliveredB, amountSatang: 50000 },
    ],
  });

  it("is the whole VAT base before anything is delivered", () => {
    expect(backlogSatang(order(0, 0))).toBe(135000);
  });

  it("is the undelivered share, the bill discount taken off in proportion", () => {
    // left: 3/4 × 1,000 + 500 = 1,250 of 1,500 → 1,350 × 1,250 / 1,500 = 1,125.00
    expect(backlogSatang(order(1, 0))).toBe(112500);
    expect(backlogSatang(order(4, 0))).toBe(45000);
  });

  it("is nothing once everything went, or the PO was cancelled", () => {
    expect(backlogSatang(order(4, 1))).toBe(0);
    expect(backlogSatang(order(0, 0, "void"))).toBe(0);
  });

  it("is ex VAT when the prices include it", () => {
    // 2 × 107.00 inclusive → base 200.00; one delivered → 100.00
    expect(backlogSatang({ status: "issued", vatBaseSatang: 20000, lines: [{ qty: 2, deliveredQty: 1, amountSatang: 21400 }] })).toBe(10000);
  });

  it("rounds half up to the satang", () => {
    // 3 × 34.00 less 2.00 = 100.00; two left → 66.666… → 66.67
    expect(backlogSatang({ status: "issued", vatBaseSatang: 10000, lines: [{ qty: 3, deliveredQty: 1, amountSatang: 10000 }] })).toBe(6667);
  });

  it("is nothing for a PO with nothing on it", () => {
    expect(backlogSatang({ status: "issued", vatBaseSatang: 0, lines: [] })).toBe(0);
    expect(backlogSatang({ status: "issued", vatBaseSatang: 100, lines: [{ qty: 1, deliveredQty: 0, amountSatang: 0 }] })).toBe(0);
  });
});

describe("isOrderLate", () => {
  it("is late once the date has passed with something still to deliver", () => {
    expect(isOrderLate({ expectedDeliveryDate: "2026-11-18" }, 100, "2026-11-19")).toBe(true);
    expect(isOrderLate({ expectedDeliveryDate: "2026-11-19" }, 100, "2026-11-19")).toBe(false);
    expect(isOrderLate({ expectedDeliveryDate: "2026-11-18" }, 0, "2026-11-19")).toBe(false);
    expect(isOrderLate({ expectedDeliveryDate: null }, 100, "2026-11-19")).toBe(false);
  });
});

// ── A delivery ───────────────────────────────────────────────────────────────

const line = (over: Partial<OrderLineForDelivery> & Pick<OrderLineForDelivery, "id">): OrderLineForDelivery => ({
  lineType: "goods", productId: "", name: "สินค้า", qty: 1, unit: "ชิ้น", unitPriceSatang: 10000, discountSatang: 0,
  isMachine: false, serials: "", warrantyMonths: null, deliveredQty: 0, invoicedDiscountSatang: 0, ...over,
});
const sent = (sourceLineId: string, qty: number, unitPriceSatang: number, discountSatang = 0): DocLineInput => ({
  lineType: "goods", productId: "", name: "สินค้า", qty, unit: "ชิ้น", unitPriceSatang, discountSatang,
  isMachine: false, serials: "", warrantyMonths: null, sourceLineId,
});

describe("deliveryLineDiscount", () => {
  // 3 × 1,000.00 less 100.00, delivered one at a time: 33.33 + 33.33 + 33.34 = 100.00
  const pump = line({ id: "a", qty: 3, unitPriceSatang: 100000, discountSatang: 10000 });

  it("follows the quantity, and the part that takes the rest of the line takes the rest of its discount", () => {
    expect(deliveryLineDiscount(pump, 1)).toBe(3333);
    expect(deliveryLineDiscount({ ...pump, deliveredQty: 1, invoicedDiscountSatang: 3333 }, 1)).toBe(3333);
    expect(deliveryLineDiscount({ ...pump, deliveredQty: 2, invoicedDiscountSatang: 6666 }, 1)).toBe(3334);
    expect(deliveryLineDiscount(pump, 3)).toBe(10000);
  });

  it("is nothing for nothing sent, or a discount already used up", () => {
    expect(deliveryLineDiscount(pump, 0)).toBe(0);
    expect(deliveryLineDiscount(pump, Number.NaN)).toBe(0);
    expect(deliveryLineDiscount({ ...pump, deliveredQty: 1, invoicedDiscountSatang: 10000 }, 1)).toBe(0);
  });
});

describe("deliveryLinesOf", () => {
  it("opens with everything still to deliver, each line pointing at its PO line, no serials yet", () => {
    const order: OrderForDelivery = {
      id: "so1", customerPoNo: "PO-1", discountSatang: 0, invoicedDiscountSatang: 0,
      lines: [
        line({ id: "a", qty: 3, deliveredQty: 1, isMachine: true, warrantyMonths: 12, serials: "OLD" }),
        line({ id: "b", qty: 1, deliveredQty: 1 }),
      ],
    };
    const lines = deliveryLinesOf(order);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ sourceLineId: "a", qty: 2, isMachine: true, warrantyMonths: 12, serials: "" });
  });
});

describe("deliveryBillDiscount and deliveryCompletesOrder", () => {
  // A: 4 × 250.00 = 1,000.00 · B: 1 × 500.00 · bill discount 150.00
  const order: OrderForDelivery = {
    id: "so1", customerPoNo: "PO-1", discountSatang: 15000, invoicedDiscountSatang: 0,
    lines: [line({ id: "a", qty: 4, unitPriceSatang: 25000 }), line({ id: "b", qty: 1, unitPriceSatang: 50000 })],
  };

  it("shares the bill discount by what is delivered", () => {
    // 500.00 of 1,500.00 → 50.00
    expect(deliveryBillDiscount(order, [sent("a", 2, 25000)], false)).toBe(5000);
  });

  it("counts only the PO's own lines — transport added to the delivery was never under its discount", () => {
    expect(deliveryBillDiscount(order, [sent("a", 2, 25000), sent("", 1, 100000)], false)).toBe(5000);
  });

  it("gives the delivery that empties the PO what is left of it", () => {
    const rest = { ...order, invoicedDiscountSatang: 5000, lines: [{ ...order.lines[0], deliveredQty: 2 }, order.lines[1]] };
    const lines = [sent("a", 2, 25000), sent("b", 1, 50000)];
    expect(deliveryCompletesOrder(rest, lines)).toBe(true);
    expect(deliveryBillDiscount(rest, lines, true)).toBe(10000);
  });

  it("knows a delivery that leaves something behind", () => {
    expect(deliveryCompletesOrder(order, [sent("a", 4, 25000)])).toBe(false);
    expect(deliveryCompletesOrder(order, [sent("a", 3, 25000), sent("a", 1, 25000), sent("b", 1, 50000)])).toBe(true);
  });

  it("is nothing when the PO had no bill discount, or it is used up", () => {
    expect(deliveryBillDiscount({ ...order, discountSatang: 0 }, [sent("a", 2, 25000)], false)).toBe(0);
    expect(deliveryBillDiscount({ ...order, invoicedDiscountSatang: 15000 }, [sent("a", 2, 25000)], true)).toBe(0);
  });
});

describe("overDeliveryProblems", () => {
  const order: OrderForDelivery = {
    id: "so1", customerPoNo: "PO-1", discountSatang: 0, invoicedDiscountSatang: 0,
    lines: [line({ id: "a", qty: 4, unit: "ชิ้น" }), line({ id: "b", qty: 1, deliveredQty: 1 })],
  };

  it("says how much is left on a line sent beyond it — counting every line that sends from it", () => {
    expect(overDeliveryProblems(order, [sent("a", 3, 10000), sent("a", 2, 10000)])).toEqual({ 1: "เกินจำนวนที่เหลือใน PO (เหลือ 4 ชิ้น)" });
    expect(overDeliveryProblems(order, [sent("a", 4, 10000)])).toEqual({});
  });

  it("says a line already delivered in full is done, and a line no longer on the PO is gone", () => {
    expect(overDeliveryProblems(order, [sent("b", 1, 10000)])).toEqual({ 0: "รายการนี้ใน PO ส่งครบแล้ว" });
    expect(overDeliveryProblems(order, [sent("zzz", 1, 10000)])).toEqual({ 0: "รายการนี้ไม่อยู่ใน PO แล้ว — ลบรายการนี้แล้วเพิ่มใหม่" });
  });

  it("leaves lines that are not from the PO alone", () => {
    expect(overDeliveryProblems(order, [sent("", 99, 10000)])).toEqual({});
  });
});
