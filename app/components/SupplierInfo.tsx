import { Fragment, type ReactNode } from "react";
import CopyText from "./CopyText";
import type { Supplier } from "../lib/types";

/**
 * A supplier's details as label / value rows, left-aligned and in Thai: the
 * /suppliers detail window and the showcase's admin list of a product's
 * suppliers. They used to be centred English captions ("CONTACT PERSON") in
 * 10px grey over a right-aligned column, which broke an address into four
 * ragged lines and a contact's name mid-word. Phone, address and tax ID copy
 * on a click.
 */
export default function SupplierInfo({
  supplier,
  onCopied,
  onFailed,
  purchaseOrderFields = true,
}: {
  supplier: Pick<Supplier, "contactName" | "phone" | "address" | "taxId">;
  onCopied?: () => void;
  onFailed?: () => void;
  /** The address and tax ID a purchase order prints. */
  purchaseOrderFields?: boolean;
}) {
  const rows: Array<[string, ReactNode]> = [
    ["ผู้ติดต่อ", supplier.contactName?.trim() || "-"],
    ["เบอร์โทร", <CopyText key="phone" value={supplier.phone} onCopied={onCopied} onFailed={onFailed} />],
  ];
  if (purchaseOrderFields) {
    rows.push(
      ["ที่อยู่", <CopyText key="address" value={supplier.address} onCopied={onCopied} onFailed={onFailed} className="whitespace-pre-line" />],
      ["เลขผู้เสียภาษี", <CopyText key="taxId" value={supplier.taxId} onCopied={onCopied} onFailed={onFailed} className="tabular-nums" />]
    );
  }
  return (
    <dl className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-4 gap-y-3">
      {rows.map(([label, value]) => (
        <Fragment key={label}>
          <dt className="text-sm font-semibold text-gray-500 pt-0.5">{label}</dt>
          <dd className="text-gray-900 wrap-break-word">{value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}
