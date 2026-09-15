// A styled, single-sheet Excel export that visually mirrors the printed A4
// document (header, bordered item table, totals, signatures) — for the four
// "print a real document" builders (PO, quotation, billing, service job).
//
// Deliberately a SEPARATE module from `xlsxExport.ts`: that file's
// `downloadExcel()`/`ExcelSheet` (built on the plain `xlsx` package) is for
// flat DATA exports (customer lists, equipment lists, dashboard reports) —
// unstyled by design, and used in a dozen places that have no reason to
// change. A document FORM needs cell borders, merges, fills AND embedded
// images (the company logo), which the free `xlsx` package cannot write at
// all — this module dynamically imports `exceljs` instead, a full-featured
// library that supports styling, images and page setup.
//
// Both packages stay client-side-only, dynamically imported inside a function
// that only ever runs from a "use client" page, same safety pattern
// `xlsxExport.ts` and the PDF generators (`html2canvas-pro`/`jspdf`) already
// use.

// Re-export sanitizeExcelCell's protection so every text cell in a form is
// safe from Excel formula injection, same as the flat exports.
import { sanitizeExcelCell } from "./xlsxExport";

type BorderStyle = "thin" | "medium" | "thick";
interface CellStyle {
  font?: { name?: string; bold?: boolean; sz?: number; color?: { rgb: string }; italic?: boolean };
  alignment?: { horizontal?: "left" | "center" | "right"; vertical?: "top" | "center" | "bottom"; wrapText?: boolean };
  fill?: { patternType: "solid"; fgColor: { rgb: string } };
  border?: Partial<Record<"top" | "bottom" | "left" | "right", { style: BorderStyle; color: { rgb: string } }>>;
  numFmt?: string;
}

interface StyledCell {
  v: string | number;
  t: "s" | "n";
  s?: CellStyle;
}

const GRAY = { rgb: "6B7280" };
const DARK = { rgb: "1F2937" };
const BOX_BORDER = { style: "thin" as BorderStyle, color: { rgb: "9CA3AF" } };
const boxBorder = (): CellStyle["border"] => ({ top: BOX_BORDER, bottom: BOX_BORDER, left: BOX_BORDER, right: BOX_BORDER });

function withDefaultFont(style?: CellStyle): CellStyle {
  return {
    ...style,
    font: { name: "Sarabun", sz: 12, ...(style?.font || {}) },
  };
}

function textCell(value: unknown, style?: CellStyle): StyledCell {
  return { v: String(sanitizeExcelCell(value ?? "-") ?? "-"), t: "s", s: withDefaultFont(style) };
}
function numberCell(value: number, style?: CellStyle): StyledCell {
  return { v: Number.isFinite(value) ? value : 0, t: "n", s: { numFmt: "#,##0.00", ...withDefaultFont(style) } };
}

/** One column of the item table — mirrors a column on the printed sheet. */
export interface FormItemColumn {
  /** Property name read off each row in `items`. */
  key: string;
  header: string;
  /** Character width (matches ExcelSheet's columnWidths convention). */
  width: number;
  align?: "left" | "center" | "right";
  /** True for money/qty columns — right-aligned, numeric, #,##0.00 format. */
  numeric?: boolean;
}

export interface FormPartyBlock {
  /** e.g. "ผู้ซื้อ (เรา)" or "ผู้ขาย (Supplier)" or "ลูกค้า". */
  label: string;
  name: string;
  /** Printed one per line under the name — address, phone, tax id, etc. */
  lines?: (string | null | undefined)[];
}

export interface FormMetaRow {
  label: string;
  value: string;
}

export interface FormTotalsRow {
  label: string;
  value: string;
  /** The grand-total row — bold with a rule above it. */
  emphasize?: boolean;
}

export interface FormNoteBlock {
  label: string;
  text: string;
}

export interface DocumentFormOptions {
  titleTh: string;
  titleEn: string;
  /** Shown first (the side that issues/holds the document). */
  primaryParty: FormPartyBlock;
  /** Shown second (the counterparty). */
  secondaryParty: FormPartyBlock;
  metaRows: FormMetaRow[];
  columns: FormItemColumn[];
  items: Record<string, unknown>[];
  /** Omit entirely for a non-money document (e.g. a service job sheet). */
  totals?: FormTotalsRow[];
  notes?: FormNoteBlock[];
  /** Signature labels along the bottom, left to right. */
  signatures?: string[];
  /** URL of the company logo (PNG) to embed in the header.
   *  Defaults to "/images/profin-logo-3.png" — the same logo the PDF uses. */
  logoUrl?: string;
}

/** Build the styled single sheet (no I/O — kept pure so it's unit-testable
 *  without touching the DOM or triggering a real file download). */
export function buildDocumentFormSheet(opts: DocumentFormOptions) {
  const colCount = Math.max(opts.columns.length, 4);
  const rows: StyledCell[][] = [];
  const merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] = [];

  const pushMergedText = (text: string, style?: CellStyle) => {
    const r = rows.length;
    const line: StyledCell[] = [textCell(text, style)];
    for (let c = 1; c < colCount; c++) line.push(textCell(""));
    rows.push(line);
    merges.push({ s: { r, c: 0 }, e: { r, c: colCount - 1 } });
  };
  const pushBlank = () => rows.push(Array.from({ length: colCount }, () => textCell("")));
  const pushLabelValue = (label: string, value: string) => {
    const r = rows.length;
    const line: StyledCell[] = [textCell(label, { font: { bold: true } })];
    for (let c = 1; c < colCount; c++) line.push(textCell(c === 1 ? value : ""));
    rows.push(line);
    if (colCount > 2) merges.push({ s: { r, c: 1 }, e: { r, c: colCount - 1 } });
  };

  // ── Title ──────────────────────────────────────────────────────────────
  pushMergedText(`${opts.titleTh} / ${opts.titleEn}`, {
    font: { bold: true, sz: 16, color: DARK },
    alignment: { horizontal: "center" },
  });
  pushBlank();

  // ── Parties (stacked, not side-by-side — robust across any column count
  //    from a 3-column service job sheet to a 7-column quotation table) ────
  for (const party of [opts.primaryParty, opts.secondaryParty]) {
    pushMergedText(`${party.label}: ${party.name || "-"}`, { font: { bold: true, sz: 12 } });
    for (const line of party.lines ?? []) {
      if (!line) continue;
      pushMergedText(line, { font: { sz: 10, color: GRAY } });
    }
    pushBlank();
  }

  // ── Document meta (เลขที่/วันที่/ฯลฯ) ───────────────────────────────────
  for (const meta of opts.metaRows) pushLabelValue(meta.label, meta.value);
  pushBlank();

  // ── Item table ───────────────────────────────────────────────────────────
  const headerStyle: CellStyle = {
    font: { bold: true, color: { rgb: "FFFFFF" } },
    fill: { patternType: "solid", fgColor: { rgb: "374151" } },
    alignment: { horizontal: "center", vertical: "center" },
    border: boxBorder(),
  };
  rows.push(opts.columns.map((c) => textCell(c.header, headerStyle)));

  for (const item of opts.items) {
    rows.push(
      opts.columns.map((c) => {
        const raw = item[c.key];
        const align = c.align ?? (c.numeric ? "right" : "left");
        const style: CellStyle = { border: boxBorder(), alignment: { horizontal: align, wrapText: true } };
        return c.numeric ? numberCell(Number(raw) || 0, style) : textCell(raw, style);
      })
    );
  }
  if (opts.items.length === 0) {
    const r = rows.length;
    rows.push(
      opts.columns.map((_, i) =>
        textCell(i === 0 ? "— ไม่มีรายการ —" : "", { border: boxBorder(), alignment: { horizontal: "center" } })
      )
    );
    merges.push({ s: { r, c: 0 }, e: { r, c: colCount - 1 } });
  }
  pushBlank();

  // ── Totals — right-aligned under the item table's last (amount) column ──
  if (opts.totals && opts.totals.length > 0) {
    for (const t of opts.totals) {
      const r = rows.length;
      const labelStyle: CellStyle = {
        alignment: { horizontal: "right" },
        font: t.emphasize ? { bold: true, sz: 12 } : undefined,
        border: t.emphasize ? { top: BOX_BORDER } : undefined,
      };
      const valueStyle: CellStyle = {
        alignment: { horizontal: "right" },
        font: t.emphasize ? { bold: true, sz: 12 } : undefined,
        border: t.emphasize ? { top: BOX_BORDER } : undefined,
      };
      const line: StyledCell[] = [];
      for (let c = 0; c < colCount - 1; c++) line.push(textCell(c === 0 ? t.label : "", labelStyle));
      line.push(textCell(t.value, valueStyle));
      rows.push(line);
      if (colCount > 2) merges.push({ s: { r, c: 0 }, e: { r, c: colCount - 2 } });
    }
    pushBlank();
  }

  // ── Notes / conditions ───────────────────────────────────────────────────
  for (const note of opts.notes ?? []) {
    if (!note.text) continue;
    pushMergedText(`${note.label}: ${note.text}`, { font: { sz: 10 }, alignment: { wrapText: true } });
  }
  if (opts.notes && opts.notes.length > 0) pushBlank();

  // ── Signatures ───────────────────────────────────────────────────────────
  if (opts.signatures && opts.signatures.length > 0) {
    pushBlank();
    const lineRow = rows.length;
    const labelRow = lineRow + 1;
    const n = opts.signatures.length;
    const span = Math.max(1, Math.floor(colCount / n));
    rows.push(Array.from({ length: colCount }, () => textCell("")));
    rows.push(Array.from({ length: colCount }, () => textCell("")));
    opts.signatures.forEach((label, i) => {
      const startCol = Math.min(i * span, colCount - 1);
      const endCol = i === n - 1 ? colCount - 1 : Math.min(startCol + span - 1, colCount - 1);
      rows[lineRow][startCol] = textCell("", { border: { bottom: BOX_BORDER } });
      for (let c = startCol + 1; c <= endCol; c++) rows[lineRow][c] = textCell("", { border: { bottom: BOX_BORDER } });
      if (endCol > startCol) merges.push({ s: { r: lineRow, c: startCol }, e: { r: lineRow, c: endCol } });
      rows[labelRow][startCol] = textCell(label, { alignment: { horizontal: "center" }, font: { bold: true } });
      if (endCol > startCol) merges.push({ s: { r: labelRow, c: startCol }, e: { r: labelRow, c: endCol } });
    });
  }

  return { rows, merges, columnWidths: opts.columns.map((c) => c.width) };
}

// ── exceljs helpers ─────────────────────────────────────────────────────────

type ExcelJSBorderStyle = "thin" | "medium" | "thick";
interface ExcelJSBorder {
  style: ExcelJSBorderStyle;
  color: { argb: string };
}

function toArgb(rgb: string): string {
  // "9CA3AF" → "FF9CA3AF"
  return `FF${rgb}`;
}

function mapBorder(b: { style: BorderStyle; color: { rgb: string } }): ExcelJSBorder {
  return { style: b.style, color: { argb: toArgb(b.color.rgb) } };
}

/** Build the sheet and trigger a browser download. Dynamically imports
 *  exceljs so it is never bundled unless this is actually called. */
export async function downloadDocumentFormExcel(
  filename: string,
  sheetName: string,
  opts: DocumentFormOptions
): Promise<void> {
  const ExcelJS = await import("exceljs");
  const { rows, merges, columnWidths } = buildDocumentFormSheet(opts);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName, {
    pageSetup: {
      paperSize: 9, // A4
      orientation: "portrait" as const,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0, // 0 = auto (let it flow vertically)
      margins: {
        left: 0.3,
        right: 0.3,
        top: 0.5,
        bottom: 0.5,
        header: 0.3,
        footer: 0.3,
      },
    },
  });

  // Column widths
  ws.columns = columnWidths.map((w) => ({ width: w }));

  // Write data rows
  for (const row of rows) {
    const exRow = ws.addRow(row.map((c) => c.v));
    row.forEach((c, ci) => {
      const cell = exRow.getCell(ci + 1);
      const s = c.s;
      if (!s) return;

      // Font
      if (s.font) {
        cell.font = {
          name: s.font.name || "Sarabun",
          size: s.font.sz || 12,
          bold: s.font.bold || false,
          italic: s.font.italic || false,
          color: s.font.color ? { argb: toArgb(s.font.color.rgb) } : undefined,
        };
      }

      // Alignment
      if (s.alignment) {
        cell.alignment = {
          horizontal: s.alignment.horizontal,
          vertical: s.alignment.vertical,
          wrapText: s.alignment.wrapText,
        };
      }

      // Fill
      if (s.fill) {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: toArgb(s.fill.fgColor.rgb) },
        };
      }

      // Border
      if (s.border) {
        cell.border = {
          top: s.border.top ? mapBorder(s.border.top) : undefined,
          bottom: s.border.bottom ? mapBorder(s.border.bottom) : undefined,
          left: s.border.left ? mapBorder(s.border.left) : undefined,
          right: s.border.right ? mapBorder(s.border.right) : undefined,
        };
      }

      // Number format
      if (s.numFmt) {
        cell.numFmt = s.numFmt;
      }
    });
  }

  // Apply merges
  for (const m of merges) {
    ws.mergeCells(m.s.r + 1, m.s.c + 1, m.e.r + 1, m.e.c + 1);
  }

  // ── Embed logo image ──────────────────────────────────────────────────
  const logoUrl = opts.logoUrl ?? "/images/profin-logo-3.png";
  try {
    const logoRes = await fetch(logoUrl);
    if (logoRes.ok) {
      const logoBlob = await logoRes.blob();
      const logoBuffer = await logoBlob.arrayBuffer();
      const ext = logoUrl.endsWith(".jpg") || logoUrl.endsWith(".jpeg") ? "jpeg" : "png";
      const imageId = wb.addImage({
        buffer: logoBuffer,
        extension: ext,
      });
      // Place logo in the top-left area — spanning ~2 columns, 2 rows
      ws.addImage(imageId, {
        tl: { col: 0, row: 0 },
        ext: { width: 80, height: 80 },
      });
    }
  } catch {
    // If logo fetch fails (e.g. offline), skip silently — the rest of
    // the document is still useful without it.
  }

  // ── Download ──────────────────────────────────────────────────────────
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
