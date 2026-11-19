// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sanitizeExcelCell, sanitizeRowsForExcel, downloadExcel } from '@/app/lib/xlsxExport';

describe('sanitizeExcelCell', () => {
  it.each(['=1+1', '+1', '-1', '@SUM(A1)', '\tevil', '\revil'])(
    'prefixes a leading "\'" onto a formula-trigger string: %s',
    (value) => {
      expect(sanitizeExcelCell(value)).toBe(`'${value}`);
    }
  );

  it('leaves an ordinary string untouched', () => {
    expect(sanitizeExcelCell('ปกติ 123')).toBe('ปกติ 123');
  });

  it('leaves non-string values (numbers, null, undefined) untouched', () => {
    expect(sanitizeExcelCell(42)).toBe(42);
    expect(sanitizeExcelCell(null)).toBe(null);
    expect(sanitizeExcelCell(undefined)).toBe(undefined);
  });

  it('leaves an empty string untouched', () => {
    expect(sanitizeExcelCell('')).toBe('');
  });
});

describe('sanitizeRowsForExcel', () => {
  it('sanitizes every string field of every row without mutating the input', () => {
    const rows = [
      { name: 'ok', note: '=HYPERLINK("http://evil","click")', qty: 3 },
      { name: '+injected', note: 'fine', qty: 1 },
    ];
    const result = sanitizeRowsForExcel(rows);

    expect(result).toEqual([
      { name: 'ok', note: '\'=HYPERLINK("http://evil","click")', qty: 3 },
      { name: "'+injected", note: 'fine', qty: 1 },
    ]);
    // Original array/objects must be untouched (export code re-derives rows
    // from live state; mutating them would be a subtle side effect bug).
    expect(rows[0].note).toBe('=HYPERLINK("http://evil","click")');
  });
});

describe('downloadExcel', () => {
  const bookNew = vi.fn(() => ({}));
  const jsonToSheet = vi.fn((rows: unknown[]): Record<string, unknown> => ({ rows }));
  const bookAppendSheet = vi.fn();
  const writeFile = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    bookNew.mockReturnValue({});
    vi.doMock('xlsx', () => ({
      utils: {
        book_new: bookNew,
        json_to_sheet: jsonToSheet,
        book_append_sheet: bookAppendSheet,
      },
      writeFile,
    }));
  });

  it('sanitizes rows, builds one sheet per entry, and writes the file', async () => {
    vi.resetModules();
    const { downloadExcel: freshDownloadExcel } = await import('@/app/lib/xlsxExport');
    await freshDownloadExcel('out.xlsx', [
      { name: 'Sheet1', rows: [{ note: '=evil' }] },
    ]);

    expect(jsonToSheet).toHaveBeenCalledWith([{ note: "'=evil" }]);
    expect(bookAppendSheet).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'Sheet1');
    expect(writeFile).toHaveBeenCalledWith(expect.anything(), 'out.xlsx');
  });

  it('substitutes a placeholder row for an empty sheet instead of writing zero rows', async () => {
    vi.resetModules();
    const { downloadExcel: freshDownloadExcel } = await import('@/app/lib/xlsxExport');
    await freshDownloadExcel('empty.xlsx', [{ name: 'Sheet1', rows: [] }]);

    expect(jsonToSheet).toHaveBeenCalledWith([{ "ไม่มีข้อมูล": "" }]);
  });

  it('applies explicit columnWidths as !cols when provided', async () => {
    vi.resetModules();
    const { downloadExcel: freshDownloadExcel } = await import('@/app/lib/xlsxExport');
    const ws: Record<string, unknown> = {};
    jsonToSheet.mockReturnValueOnce(ws);
    await freshDownloadExcel('cols.xlsx', [
      { name: 'Sheet1', rows: [{ a: 1 }], columnWidths: [10, 20] },
    ]);
    expect(ws['!cols']).toEqual([{ wch: 10 }, { wch: 20 }]);
  });

  it('computes !cols from header + content length when autoSizeColumns is set', async () => {
    vi.resetModules();
    const { downloadExcel: freshDownloadExcel } = await import('@/app/lib/xlsxExport');
    const ws: Record<string, unknown> = {};
    jsonToSheet.mockReturnValueOnce(ws);
    await freshDownloadExcel('auto.xlsx', [
      {
        name: 'Sheet1',
        rows: [{ Name: 'a very long value here' }, { Name: 'short' }],
        autoSizeColumns: true,
      },
    ]);
    expect(ws['!cols']).toEqual([{ wch: 'a very long value here'.length + 2 }]);
  });
});

// Step 9 — a report's heading above its table, and money shown as money but kept a number.
describe('downloadExcel — headings and money (with the real xlsx)', () => {
  it('puts the heading lines above the table, a blank row between, and formats the money columns', async () => {
    vi.resetModules();
    const writeFile = vi.fn();
    vi.doMock('xlsx', async (importOriginal) => ({ ...(await importOriginal<typeof import('xlsx')>()), writeFile }));
    const { downloadExcel: freshDownloadExcel } = await import('@/app/lib/xlsxExport');
    await freshDownloadExcel('accounting-2026-11.xlsx', [
      {
        name: 'ภาษีขาย',
        title: ['รายงานภาษีขาย', 'เดือนภาษี พฤศจิกายน 2569', '=HYPERLINK("x")'],
        rows: [
          { 'เลขที่': 'INV2026110001', 'มูลค่า': 1070, 'หมายเหตุ': '' },
          { 'เลขที่': '', 'มูลค่า': 1070.5, 'หมายเหตุ': 'รวม' },
        ],
        moneyColumns: ['มูลค่า', 'ไม่มีคอลัมน์นี้'],
      },
    ]);
    const [wb, filename] = writeFile.mock.calls[0];
    expect(filename).toBe('accounting-2026-11.xlsx');
    const ws = wb.Sheets['ภาษีขาย'];
    expect(ws.A1.v).toBe('รายงานภาษีขาย');
    expect(ws.A2.v).toBe('เดือนภาษี พฤศจิกายน 2569');
    // A heading is admin-entered text too — never a formula.
    expect(ws.A3.v).toBe('\'=HYPERLINK("x")');
    expect(ws.A4).toBeUndefined();
    expect([ws.A5.v, ws.B5.v, ws.C5.v]).toEqual(['เลขที่', 'มูลค่า', 'หมายเหตุ']);
    expect(ws.B6).toMatchObject({ t: 'n', v: 1070, z: '#,##0.00' });
    expect(ws.B7).toMatchObject({ t: 'n', v: 1070.5, z: '#,##0.00' });
    // The header and the text columns are left alone.
    expect(ws.B5.z).toBeUndefined();
    expect(ws.A6.z).toBeUndefined();
    vi.doUnmock('xlsx');
  });

  it('formats money without a heading too — the table from the first row', async () => {
    vi.resetModules();
    const writeFile = vi.fn();
    vi.doMock('xlsx', async (importOriginal) => ({ ...(await importOriginal<typeof import('xlsx')>()), writeFile }));
    const { downloadExcel: freshDownloadExcel } = await import('@/app/lib/xlsxExport');
    await freshDownloadExcel('plain.xlsx', [{ name: 'S', rows: [{ 'ยอด': 5, 'ข้อความ': 'x' }, { 'ยอด': '', 'ข้อความ': 'y' }], moneyColumns: ['ยอด'] }]);
    const ws = writeFile.mock.calls[0][0].Sheets.S;
    expect(ws.A1.v).toBe('ยอด');
    expect(ws.A2).toMatchObject({ v: 5, z: '#,##0.00' });
    // An empty cell in a money column is not a number — nothing to format.
    expect(ws.A3?.z).toBeUndefined();
    vi.doUnmock('xlsx');
  });
});
