import type { SaleLineDraft } from "../lib/quotationToSale";
import type { CostItemLocal, SalesFormData } from "./types";

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
