// Shared client-side XLSX export helper. Client component code only — this
// dynamically imports the ~7.2MB "xlsx" package itself so it's never bundled
// unless an export button is actually clicked.

// A string that STARTS with one of these characters is interpreted by Excel
// as a formula (or, for '@'/tab/CR, a DDE trigger) when the cell opens —
// classic "CSV/Excel formula injection". Every export in this app writes
// admin-entered free text (customer/schedule notes, etc.) into cells, so
// every export needs this before it reaches XLSX.utils.json_to_sheet.
// Prefixing with a leading `'` forces Excel to treat the whole value as text.
const FORMULA_TRIGGER_CHARS = ["=", "+", "-", "@", "\t", "\r"];

export function sanitizeExcelCell(value: unknown): unknown {
  if (typeof value !== "string" || value.length === 0) return value;
  return FORMULA_TRIGGER_CHARS.includes(value[0]) ? `'${value}` : value;
}

/** Apply sanitizeExcelCell to every field of every row. */
export function sanitizeRowsForExcel(
  rows: Record<string, unknown>[]
): Record<string, unknown>[] {
  return rows.map((row) => {
    const out: Record<string, unknown> = { ...row };
    for (const key of Object.keys(out)) {
      out[key] = sanitizeExcelCell(out[key]);
    }
    return out;
  });
}

export interface ExcelSheet {
  name: string;
  rows: Record<string, unknown>[];
  /** Explicit column widths (`wch`), in the same order as each row's keys. */
  columnWidths?: number[];
  /** Compute each column's width from its header + longest cell instead. */
  autoSizeColumns?: boolean;
}

/** Build and download a .xlsx workbook from one or more sheets of row objects. */
export async function downloadExcel(filename: string, sheets: ExcelSheet[]): Promise<void> {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();

  for (const sheet of sheets) {
    const rows = sheet.rows.length > 0 ? sheet.rows : [{ "ไม่มีข้อมูล": "" }];
    const ws = XLSX.utils.json_to_sheet(sanitizeRowsForExcel(rows));

    if (sheet.columnWidths) {
      ws["!cols"] = sheet.columnWidths.map((wch) => ({ wch }));
    } else if (sheet.autoSizeColumns && sheet.rows.length > 0) {
      const keys = Object.keys(sheet.rows[0]);
      ws["!cols"] = keys.map((k) => {
        let maxLen = k.length;
        for (const r of sheet.rows) {
          const len = String(r[k] ?? "").length;
          if (len > maxLen) maxLen = len;
        }
        return { wch: maxLen + 2 };
      });
    }

    XLSX.utils.book_append_sheet(wb, ws, sheet.name);
  }

  XLSX.writeFile(wb, filename);
}
