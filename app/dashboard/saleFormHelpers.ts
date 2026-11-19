import type { MissingCostLocation, SaleLineDraft } from "../lib/quotationToSale";
import type { CostItemLocal, SalesFormData } from "./types";

export type SaleFormErrorKey =
  | "saleDate" | "poRef" | "invoiceRef" | "lines" | "productName" | "qty" | "unitPrice"
  | "warrantyStartDate" | "warrantyEndDate" | "productCostOnBill" | "lineCost" | "costItems";

export interface SaleFormCheck {
  form: Pick<SalesFormData, "saleDate" | "poRef" | "deliveryRef" | "invoiceRef" | "productName" | "qty" | "unitPrice" | "saleType" | "warrantyStartDate" | "warrantyEndDate">;
  /** A quotation drives the bill: product, quantity, price and warranty live on its lines. */
  useLines: boolean;
  /** The lines' own problems (the line editor's report, or validateLineDrafts). */
  lineErrors: readonly string[];
  /** Ticked lines whose ต้นทุนสินค้า is still empty. */
  missingCosts: readonly MissingCostLocation[];
  costItems: readonly Pick<CostItemLocal, "costType" | "amount">[];
  showCostCalc: boolean;
}

/**
 * What stops the sale from being saved — which fields to paint red, and the
 * same in words, in the order the form shows them. Pure: the save checks it
 * once, and after a failed save the form shows it LIVE (item 4), so each
 * thing drops off the list, and its red border goes, as soon as it is filled.
 */
export function saleFormProblems(c: SaleFormCheck): { errors: Partial<Record<SaleFormErrorKey, true>>; missing: string[] } {
  const { form } = c;
  const errors: Partial<Record<SaleFormErrorKey, true>> = {};
  if (!form.saleDate) errors.saleDate = true;
  if (!form.poRef.trim()) errors.poRef = true;
  if (form.deliveryRef && !form.invoiceRef) errors.invoiceRef = true;
  if (c.useLines) {
    if (c.lineErrors.length > 0) errors.lines = true;
  } else {
    if (!form.productName.trim()) errors.productName = true;
    if (!form.qty || form.qty <= 0) errors.qty = true;
    if (!form.unitPrice || form.unitPrice <= 0) errors.unitPrice = true;
    if (form.saleType === "equipment") {
      if (!form.warrantyStartDate) errors.warrantyStartDate = true;
      if (!form.warrantyEndDate) errors.warrantyEndDate = true;
    }
  }
  const billCost = c.costItems.reduce((sum, ci) => sum + ci.amount, 0);
  const emptyCost = c.costItems.some((ci) => !ci.amount || ci.amount <= 0);
  if (c.useLines) {
    // Product cost is per line here: a bill-level ต้นทุนสินค้า cannot be split over the lines.
    if (c.costItems.some((ci) => ci.costType === "product_cost")) errors.productCostOnBill = true;
    if (c.missingCosts.length > 0) errors.lineCost = true;
    if (c.showCostCalc && emptyCost) errors.costItems = true;
  } else if (!c.showCostCalc || c.costItems.length === 0 || billCost <= 0 || emptyCost) {
    errors.costItems = true;
  }

  const missing: string[] = [];
  if (errors.saleDate) missing.push("วันที่ขาย");
  if (errors.productName) missing.push("ชื่อสินค้า");
  if (errors.qty) missing.push("จำนวน");
  if (errors.unitPrice) missing.push("ราคา");
  if (errors.poRef) missing.push("อ้างอิง PO");
  if (errors.warrantyStartDate) missing.push("วันเริ่มรับประกัน");
  if (errors.warrantyEndDate) missing.push("วันสิ้นสุดรับประกัน");
  if (errors.invoiceRef) missing.push("อ้างอิง Invoice");
  if (errors.lineCost) {
    // Name the exact lines, the way the serial blocker names the exact machine.
    const where = c.missingCosts.map((m) => `รายการที่ ${m.lineIndex + 1}${m.productName ? ` (${m.productName})` : ""}`).join(", ");
    missing.push(`ต้นทุนสินค้าของ${where} (กรอกที่ช่อง «ต้นทุนสินค้า» ของแต่ละรายการ)`);
  }
  if (errors.productCostOnBill) missing.push("ย้ายรายการ «ต้นทุนสินค้า» ในตัวช่วยคำนวณต้นทุนไปกรอกที่แต่ละรายการสินค้า");
  if (errors.costItems) missing.push("ต้นทุน (กรุณาเปิดเครื่องคิดต้นทุน แล้วกรอกยอดต้นทุน)");
  if (errors.lines) {
    // The line problems list the missing costs too; those are said above.
    const firstOther = c.lineErrors.find((e) => !e.endsWith("กรุณาระบุต้นทุนสินค้า"));
    if (firstOther) missing.push(firstOther);
    else if (!errors.lineCost) missing.push("รายการสินค้า");
  }
  return { errors, missing };
}

/** A cost row the admin has put something into. Opening the cost calculator
 *  adds an empty one, and that alone is not typing. */
export function isCostRowFilled(row: CostItemLocal): boolean {
  return Number(row.amount || 0) !== 0 || String(row.label ?? "").trim() !== "" || String(row.note ?? "").trim() !== "";
}

/**
 * Everything in the บันทึกยอดขาย form that the admin typed or picked, as one
 * string. The form is "dirty" — closing it would throw that away — when this
 * differs from the snapshot taken as the form opened.
 *
 * Left out: `loadedEquipments` (a read-only copy of the machines an edited
 * sale already has) and cost rows with nothing in them.
 */
export function saleFormSnapshot(state: {
  form: SalesFormData;
  costItems: readonly CostItemLocal[];
  quotationId: string;
  lines: readonly SaleLineDraft[];
}): string {
  return JSON.stringify({
    form: { ...state.form, loadedEquipments: undefined },
    costItems: state.costItems.filter(isCostRowFilled),
    quotationId: state.quotationId,
    lines: state.lines,
  });
}
