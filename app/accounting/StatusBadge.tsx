"use client";

import { STATUS_LABELS, STATUS_STYLES, type DisplayStatus } from "../lib/accounting/invoiceRules";

/** A document's state as a coloured pill (orange waiting, green done — the owner's sample). */
export default function StatusBadge({ status }: { status: DisplayStatus }) {
  return (
    <span className={`inline-block px-3 py-1 rounded-md text-sm font-semibold whitespace-nowrap ${STATUS_STYLES[status].badge}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

/** The small dot before a document number. */
export function StatusDot({ status }: { status: DisplayStatus }) {
  return <span aria-hidden="true" className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${STATUS_STYLES[status].dot}`} />;
}
