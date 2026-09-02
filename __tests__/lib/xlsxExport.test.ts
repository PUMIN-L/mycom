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
