/**
 * How every paper of the accounting module prints — the invoice / tax invoice,
 * the receipt, the billing note and the credit note — one stylesheet for all
 * four. Only the paper (`data-print-root`) is printed; the rest of the page is
 * hidden.
 *
 * The PAGE has no margin (the owner, 2026-11-23: no date, time or page title
 * at the top of the sheet). A browser prints those in the page's margin — with
 * none, there is nowhere to print them. The paper keeps its 10 mm from the
 * edge inside itself instead, and `box-decoration-break: clone` repeats that
 * on every page a long paper runs to (where the browser supports it; where it
 * does not, a second page starts nearer its top edge).
 */
export const PAPER_PRINT_CSS = `
@media print {
  @page { size: A4; margin: 0; }
  body * { visibility: hidden !important; }
  [data-print-root], [data-print-root] * { visibility: visible !important; }
  [data-print-root] { position: absolute; left: 0; top: 0; width: 100%; max-width: none; border: none !important; box-shadow: none !important; padding: 10mm !important; box-sizing: border-box; -webkit-box-decoration-break: clone; box-decoration-break: clone; }
}
`;
