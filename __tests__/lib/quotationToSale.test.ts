// @vitest-environment node
//
// Tasks 15.2-15.6 — the pure quotation→sale logic. No DB, no fetch, no React:
// every assertion here is data in / data out.
import { describe, it, expect } from 'vitest';
import {
  AUTOFILL_MARKER,
  CUSTOM_PRODUCT_SENTINEL,
  MAX_EQUIPMENT_ROWS_PER_SALE,
  applyProductSelection,
  applyTypedPartyName,
  blankMachine,
  buildLineDrafts,
  buildSalePayload,
  collectSerials,
  copyWarrantyToAllMachines,
  describeNameMatch,
  findDuplicateSerialsInForm,
  findMissingSerials,
  findOverQuotedLines,
  findResoldLines,
  matchByName,
  normalizeName,
  normalizeSerial,
  resizeMachines,
  resolveAutoFill,
  resolveProductIdForApi,
  selectPartyFromSystem,
  selectedLines,
  setLineQty,
  summarizeBill,
  summarizeSoldLines,
  validateLineDrafts,
  type CatalogProduct,
  type QuotationLine,
  type SaleLineDraft,
} from '@/app/lib/quotationToSale';

// --- fixtures ---------------------------------------------------------------

const CUSTOMERS = [
  { id: 'c1', name: 'สมชาย ใจดี' },
  { id: 'c2', name: 'Somsak Wong' },
  { id: 'c3', name: 'สมหญิง รักงาน' },
];

const COMPANIES = [
  { id: 'co1', name: 'บริษัท เอบีซี จำกัด', taxId: '111' },
  { id: 'co2', name: 'บริษัท เอบีซี จำกัด', taxId: '222' },
  { id: 'co3', name: 'บจก. เอ็กซ์วายแซด' },
];

const PRODUCTS: CatalogProduct[] = [
  { id: 'p1', categoryId: 7 },
  { id: 'p2', categoryId: null },
  { id: 'p3', categoryId: 12 },
];

const QUOTE_ITEMS: QuotationLine[] = [
  { id: 'qi1', productId: 'p1', name: 'เครื่องชั่ง A', qty: 3, unit: 'เครื่อง', unitPrice: 120000 },
  { id: 'qi2', productId: '', name: 'ขาตั้งพิเศษ (สั่งทำ)', qty: 1, unit: 'ชุด', unitPrice: 4500 },
  { id: 'qi3', productId: 'p3', name: 'เครื่องวัด C', qty: 2, unit: 'เครื่อง', unitPrice: 50000 },
];

function drafts(sold: Array<{ quotationItemId: string; soldQty: number }> = []) {
  return buildLineDrafts({ items: QUOTE_ITEMS, sold, products: PRODUCTS });
}

/** Fill in every machine of every selected line with a unique serial. */
function withSerials(lines: SaleLineDraft[], prefix = 'SN'): SaleLineDraft[] {
  let n = 0;
  return lines.map((l) => ({
    ...l,
    machines: l.machines.map((m) => ({ ...m, serialNumber: `${prefix}-${++n}` })),
  }));
}

// --- 15.2 name matching -----------------------------------------------------

describe('normalizeName', () => {
  it('trims and case-folds', () => {
    expect(normalizeName('  Somsak Wong  ')).toBe('somsak wong');
  });

  it('turns null/undefined into an empty key', () => {
    expect(normalizeName(null)).toBe('');
    expect(normalizeName(undefined)).toBe('');
  });

  it('does NOT normalize Thai company-name abbreviations together', () => {
    // A near miss must stay a miss — see matchByName's "none" case below.
    expect(normalizeName('บจก. เอบีซี')).not.toBe(normalizeName('บริษัท เอบีซี จำกัด'));
  });
});

describe('matchByName (task 15.2)', () => {
  it('matches exactly one → status "matched" with that row', () => {
    const r = matchByName('สมชาย ใจดี', CUSTOMERS);
    expect(r.status).toBe('matched');
    expect(r.count).toBe(1);
    expect(r.match?.id).toBe('c1');
  });

  it('ignores surrounding whitespace and letter case', () => {
    const r = matchByName('   somsak WONG ', CUSTOMERS);
    expect(r.status).toBe('matched');
    expect(r.match?.id).toBe('c2');
    expect(r.query).toBe('somsak WONG'); // trimmed, original spelling kept
  });

  it('matches nothing → status "none", no match, count 0', () => {
    const r = matchByName('ไม่มีคนนี้', CUSTOMERS);
    expect(r.status).toBe('none');
    expect(r.match).toBeNull();
    expect(r.matches).toEqual([]);
    expect(r.count).toBe(0);
  });

  it('a Thai near-miss is "none", never a wrong match', () => {
    const r = matchByName('บจก. เอบีซี', COMPANIES);
    expect(r.status).toBe('none');
    expect(r.match).toBeNull();
  });

  it('matches several → status "ambiguous" with the count and every candidate', () => {
    const r = matchByName('บริษัท เอบีซี จำกัด', COMPANIES);
    expect(r.status).toBe('ambiguous');
    expect(r.count).toBe(2);
    expect(r.match).toBeNull(); // never the first of several
    expect(r.matches.map((c) => c.id)).toEqual(['co1', 'co2']);
  });

  it('an empty or whitespace-only name is "none", not a match on a blank row', () => {
    expect(matchByName('   ', [{ id: 'x', name: '' }]).status).toBe('none');
    expect(matchByName(undefined, CUSTOMERS).status).toBe('none');
  });

  it('tolerates a missing/empty candidate list', () => {
    expect(matchByName('สมชาย ใจดี', []).status).toBe('none');
    expect(matchByName('สมชาย ใจดี', null).count).toBe(0);
    expect(matchByName('สมชาย ใจดี', undefined).matches).toEqual([]);
  });

  it('does not mutate the list it was given', () => {
    const list = [...CUSTOMERS];
    matchByName('สมชาย ใจดี', list);
    expect(list).toEqual(CUSTOMERS);
  });
});

describe('resolveAutoFill (tasks 11.1-11.5)', () => {
  it('uses a stored id outright, without name matching', () => {
    // The name deliberately matches TWO companies: the id must win anyway.
    const r = resolveAutoFill({ id: 'co2', name: 'บริษัท เอบีซี จำกัด', list: COMPANIES });
    expect(r.source).toBe('id');
    expect(r.status).toBe('matched');
    expect(r.selectedId).toBe('co2');
    expect(r.autoFilled).toBe(true);
  });

  it('falls back to name matching when the quotation has no id', () => {
    const r = resolveAutoFill({ name: 'สมหญิง รักงาน', list: CUSTOMERS });
    expect(r.source).toBe('name');
    expect(r.selectedId).toBe('c3');
    expect(r.autoFilled).toBe(true);
  });

  it('treats a stale id (row deleted) as absent and falls back to the name', () => {
    const r = resolveAutoFill({ id: 'gone', name: 'สมหญิง รักงาน', list: CUSTOMERS });
    expect(r.source).toBe('name');
    expect(r.selectedId).toBe('c3');
  });

  it('leaves the field blank when the name is ambiguous', () => {
    const r = resolveAutoFill({ name: 'บริษัท เอบีซี จำกัด', list: COMPANIES });
    expect(r.status).toBe('ambiguous');
    expect(r.selectedId).toBe('');
    expect(r.autoFilled).toBe(false);
    expect(r.source).toBe('none');
  });

  it('leaves the field blank when nothing matches', () => {
    const r = resolveAutoFill({ id: '', name: 'ไม่มีบริษัทนี้', list: COMPANIES });
    expect(r.status).toBe('none');
    expect(r.selectedId).toBe('');
    expect(r.autoFilled).toBe(false);
  });
});

describe('describeNameMatch', () => {
  it('says nothing when the field was filled', () => {
    expect(describeNameMatch(matchByName('สมชาย ใจดี', CUSTOMERS), 'ลูกค้า')).toBeNull();
  });

  it('names the missing customer in Thai', () => {
    expect(describeNameMatch(matchByName('ไม่มีคนนี้', CUSTOMERS), 'ลูกค้า')).toBe(
      'ไม่พบลูกค้าชื่อ «ไม่มีคนนี้» ในระบบ'
    );
  });

  it('reports how many companies share the name', () => {
    expect(
      describeNameMatch(matchByName('บริษัท เอบีซี จำกัด', COMPANIES), 'บริษัท')
    ).toBe('พบบริษัทชื่อนี้ 2 รายการ กรุณาเลือกเอง');
  });

  it('says nothing when the quotation carried no name at all', () => {
    expect(describeNameMatch(matchByName('', CUSTOMERS), 'ลูกค้า')).toBeNull();
  });

  it('exports the Thai auto-fill marker the form pins on filled fields', () => {
    expect(AUTOFILL_MARKER).toBe('เติมจากใบเสนอราคา — กรุณาตรวจสอบ');
  });
});

// --- 15.4 line drafts + pre-ticking ----------------------------------------

describe('buildLineDrafts (tasks 12.1-12.6)', () => {
  it('carries every quotation field the form needs', () => {
    const [first] = drafts();
    expect(first).toMatchObject({
      key: 'qi1',
      quotationItemId: 'qi1',
      productName: 'เครื่องชั่ง A',
      productId: 'p1',
      categoryId: 7,
      productMissing: false,
      quotedQty: 3,
      qty: 3, // sold qty defaults to the quoted qty
      soldQty: 0,
      unit: 'เครื่อง',
      unitPrice: 120000, // verbatim: no discount, no VAT
      costAmount: 0,
    });
    expect(first.machines).toHaveLength(3);
    expect(first.machines[0]).toEqual(blankMachine());
  });

  it('gives a hand-typed quotation line productId "" and no category', () => {
    const [, custom] = drafts();
    expect(custom.productId).toBe('');
    expect(custom.categoryId).toBeNull();
    expect(custom.productMissing).toBe(false);
    expect(custom.productName).toBe('ขาตั้งพิเศษ (สั่งทำ)');
  });

  it('never guesses a category for a product that has none', () => {
    const [line] = buildLineDrafts({
      items: [{ id: 'x', productId: 'p2', name: 'B', qty: 1, unitPrice: 1 }],
      products: PRODUCTS,
    });
    expect(line.productId).toBe('p2');
    expect(line.categoryId).toBeNull();
  });

  it('drops the link and flags a product deleted from the catalog, keeping the name', () => {
    const [line] = buildLineDrafts({
      items: [{ id: 'x', productId: 'deleted', name: 'เครื่องเก่า', qty: 1, unitPrice: 10 }],
      products: PRODUCTS,
    });
    expect(line.productId).toBe('');
    expect(line.categoryId).toBeNull();
    expect(line.productMissing).toBe(true);
    expect(line.productName).toBe('เครื่องเก่า');
  });

  it('keeps the quotation link but claims no category when no catalog was passed', () => {
    const [line] = buildLineDrafts({
      items: [{ id: 'x', productId: 'p1', name: 'A', qty: 1, unitPrice: 10 }],
    });
    expect(line.productId).toBe('p1');
    expect(line.categoryId).toBeNull();
    expect(line.productMissing).toBe(false);
  });

  it('falls back to a positional key for a line with no id', () => {
    const [line] = buildLineDrafts({ items: [{ name: 'ไม่มี id', qty: 1, unitPrice: 5 }] });
    expect(line.key).toBe('line-0');
    expect(line.quotationItemId).toBe('');
  });

  it('floors a missing/garbage qty at 1 machine', () => {
    const [a, b] = buildLineDrafts({
      items: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B', qty: 0 }],
    });
    expect(a.qty).toBe(1);
    expect(a.machines).toHaveLength(1);
    expect(b.qty).toBe(1);
  });

  it('returns [] for a quotation with no items', () => {
    expect(buildLineDrafts({ items: [] })).toEqual([]);
    expect(buildLineDrafts({ items: null })).toEqual([]);
  });

  it('does not mutate the quotation items it was given', () => {
    const items = JSON.parse(JSON.stringify(QUOTE_ITEMS));
    buildLineDrafts({ items, products: PRODUCTS });
    expect(items).toEqual(QUOTE_ITEMS);
  });
});

describe('pre-ticking from /sold (task 15.4)', () => {
  it('ticks every line when the quotation has never been sold', () => {
    expect(drafts().map((l) => l.selected)).toEqual([true, true, true]);
    expect(drafts().map((l) => l.soldQty)).toEqual([0, 0, 0]);
  });

  it('ticks ONLY the unsold lines when part of the quotation was sold', () => {
    const lines = drafts([
      { quotationItemId: 'qi1', soldQty: 1 },
      { quotationItemId: 'qi3', soldQty: 2 },
    ]);
    expect(lines.map((l) => l.selected)).toEqual([false, true, false]);
    expect(lines.map((l) => l.soldQty)).toEqual([1, 0, 2]);
  });

  it('keeps a partly sold line untick even when fewer than the quoted qty were sold', () => {
    // Quoted 3, one already sold: still NOT pre-ticked — the admin confirms.
    const [line] = drafts([{ quotationItemId: 'qi1', soldQty: 1 }]);
    expect(line.selected).toBe(false);
    expect(line.qty).toBe(3); // the editable qty still defaults to the quoted qty
  });

  it('sums a line sold across several bills', () => {
    const [line] = drafts([
      { quotationItemId: 'qi1', soldQty: 1 },
      { quotationItemId: 'qi1', soldQty: 2 },
    ]);
    expect(line.soldQty).toBe(3);
  });

  it('ignores sold entries for lines that are not in this quotation', () => {
    const lines = drafts([{ quotationItemId: 'nope', soldQty: 9 }]);
    expect(lines.every((l) => l.selected)).toBe(true);
  });

  it('treats a missing or malformed /sold body as "nothing sold"', () => {
    expect(buildLineDrafts({ items: QUOTE_ITEMS, sold: null }).every((l) => l.selected)).toBe(true);
    const weird = buildLineDrafts({
      items: QUOTE_ITEMS,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sold: [{ quotationItemId: '', soldQty: 5 } as any, { quotationItemId: 'qi1', soldQty: NaN } as any],
    });
    expect(weird[0].soldQty).toBe(0);
    expect(weird[0].selected).toBe(true);
  });
});

describe('summarizeSoldLines (task 13.1)', () => {
  it('reads "X/Y" with the Thai banner text', () => {
    const s = summarizeSoldLines(drafts([{ quotationItemId: 'qi1', soldQty: 1 }, { quotationItemId: 'qi2', soldQty: 1 }]));
    expect(s).toEqual({
      soldLines: 2,
      totalLines: 3,
      message: 'ใบนี้บันทึกขายไปแล้ว 2/3 รายการ',
    });
  });

  it('has no banner for a quotation that was never sold', () => {
    expect(summarizeSoldLines(drafts()).message).toBeNull();
  });
});

describe('findResoldLines / findOverQuotedLines (warn, never block)', () => {
  it('reports a ticked line that was already sold', () => {
    const lines = drafts([{ quotationItemId: 'qi1', soldQty: 1 }]);
    expect(findResoldLines(lines)).toEqual([]); // not ticked yet
    lines[0] = { ...lines[0], selected: true };
    expect(findResoldLines(lines).map((l) => l.quotationItemId)).toEqual(['qi1']);
  });

  it('reports a line selling more than was quoted', () => {
    const lines = drafts();
    expect(findOverQuotedLines(lines)).toEqual([]);
    lines[2] = setLineQty(lines[2], 3); // quoted 2
    expect(findOverQuotedLines(lines).map((l) => l.quotationItemId)).toEqual(['qi3']);
  });
});

// --- machine rows (task 12.7 / 12.8) ---------------------------------------

describe('resizeMachines (task 12.7)', () => {
  const typed = [
    { serialNumber: 'A1', warrantyStartDate: '2026-01-01', warrantyEndDate: '2027-01-01' },
    { serialNumber: 'A2', warrantyStartDate: '2026-02-01', warrantyEndDate: '2027-02-01' },
  ];

  it('appends blank rows when the qty grows, keeping typed rows in place', () => {
    const out = resizeMachines(typed, 4);
    expect(out).toHaveLength(4);
    expect(out[0]).toEqual(typed[0]);
    expect(out[1]).toEqual(typed[1]);
    expect(out[2]).toEqual(blankMachine());
    expect(out[3]).toEqual(blankMachine());
  });

  it('drops only the TRAILING rows when the qty shrinks', () => {
    const three = resizeMachines(typed, 3);
    const back = resizeMachines(three, 2);
    expect(back).toEqual(typed);
  });

  it('is a no-op at the same qty', () => {
    expect(resizeMachines(typed, 2)).toEqual(typed);
  });

  it('never mutates or reorders the array it was given', () => {
    const input = typed.map((m) => ({ ...m }));
    const out = resizeMachines(input, 5);
    expect(input).toHaveLength(2);
    expect(out).not.toBe(input);
    expect(out.slice(0, 2).map((m) => m.serialNumber)).toEqual(['A1', 'A2']);
  });

  it('clamps at the per-bill machine cap and at zero', () => {
    expect(resizeMachines([], 999)).toHaveLength(MAX_EQUIPMENT_ROWS_PER_SALE);
    expect(resizeMachines(typed, -3)).toEqual([]);
  });

  it('keeps the current rows when the qty is not a number', () => {
    expect(resizeMachines(typed, 'abc')).toEqual(typed);
  });
});

describe('setLineQty', () => {
  it('moves the qty and the machine rows together', () => {
    const line = drafts()[0]; // quoted 3
    const filled = { ...line, machines: line.machines.map((m, i) => ({ ...m, serialNumber: `S${i}` })) };
    const smaller = setLineQty(filled, 2);
    expect(smaller.qty).toBe(2);
    expect(smaller.machines.map((m) => m.serialNumber)).toEqual(['S0', 'S1']);

    const bigger = setLineQty(smaller, 3);
    expect(bigger.machines.map((m) => m.serialNumber)).toEqual(['S0', 'S1', '']);
    expect(filled.machines).toHaveLength(3); // original untouched
  });
});

describe('copyWarrantyToAllMachines (task 12.8)', () => {
  it('copies the first machine dates onto the rest, leaving serials alone', () => {
    const out = copyWarrantyToAllMachines([
      { serialNumber: 'A', warrantyStartDate: '2026-03-01', warrantyEndDate: '2027-03-01' },
      { serialNumber: 'B', warrantyStartDate: '', warrantyEndDate: '' },
      { serialNumber: 'C', warrantyStartDate: '2020-01-01', warrantyEndDate: '2021-01-01' },
    ]);
    expect(out.map((m) => m.serialNumber)).toEqual(['A', 'B', 'C']);
    expect(out.every((m) => m.warrantyStartDate === '2026-03-01')).toBe(true);
    expect(out.every((m) => m.warrantyEndDate === '2027-03-01')).toBe(true);
  });

  it('handles an empty machine list', () => {
    expect(copyWarrantyToAllMachines([])).toEqual([]);
    expect(copyWarrantyToAllMachines(undefined)).toEqual([]);
  });
});

describe('applyProductSelection (tasks 12.4-12.5)', () => {
  const base = drafts()[1]; // the hand-typed line

  it('takes the category from the chosen catalog product', () => {
    const out = applyProductSelection(base, 'p3', PRODUCTS);
    expect(out).toMatchObject({ productId: 'p3', categoryId: 12, productMissing: false });
  });

  it('keeps the _custom sentinel and clears the category', () => {
    const linked = applyProductSelection(base, 'p1', PRODUCTS);
    const custom = applyProductSelection(linked, CUSTOM_PRODUCT_SENTINEL, PRODUCTS);
    expect(custom.productId).toBe(CUSTOM_PRODUCT_SENTINEL);
    expect(custom.categoryId).toBeNull();
  });

  it('clears both when the selection is cleared', () => {
    const linked = applyProductSelection(base, 'p1', PRODUCTS);
    expect(applyProductSelection(linked, '', PRODUCTS)).toMatchObject({
      productId: '',
      categoryId: null,
    });
  });

  it('does not mutate the draft it was given', () => {
    const before = JSON.parse(JSON.stringify(base));
    applyProductSelection(base, 'p1', PRODUCTS);
    expect(base).toEqual(before);
  });
});

// --- 15.3 payload -----------------------------------------------------------

describe('resolveProductIdForApi (task 12.4)', () => {
  it('turns the _custom sentinel into an empty string', () => {
    expect(resolveProductIdForApi(CUSTOM_PRODUCT_SENTINEL)).toBe('');
  });

  it('passes a real id through and trims it', () => {
    expect(resolveProductIdForApi(' p1 ')).toBe('p1');
    expect(resolveProductIdForApi(undefined)).toBe('');
  });
});

describe('buildSalePayload (task 15.3)', () => {
  it('emits one item per ticked line and one equipment per machine', () => {
    let lines = drafts();
    lines[1] = { ...lines[1], selected: false }; // buy 2 of the 3 quoted lines
    lines[0] = setLineQty(lines[0], 2); // quoted 3, buying 2
    lines = withSerials(lines);

    const payload = buildSalePayload(lines, { quotationRef: 'QT-2568-001' });

    expect(payload.items).toHaveLength(2);
    expect(payload.items.map((i) => i.quotationItemId)).toEqual(['qi1', 'qi3']);
    expect(payload.items.map((i) => i.sortOrder)).toEqual([0, 1]);
    // 2 machines on qi1 + 2 on qi3
    expect(payload.equipments).toHaveLength(4);
    expect(payload.equipments).toHaveLength(payload.qty);
  });

  it('the equipment count always equals the sum of the selected quantities', () => {
    const lines = withSerials([
      setLineQty(drafts()[0], 5),
      setLineQty(drafts()[2], 1),
    ]);
    const payload = buildSalePayload(lines);
    expect(payload.qty).toBe(6);
    expect(payload.equipments).toHaveLength(6);
  });

  it('computes totalAmount per line and rolls it up for the sale', () => {
    let lines = drafts();
    lines[1] = { ...lines[1], selected: false };
    lines[0] = { ...setLineQty(lines[0], 2), unitPrice: 108000, costAmount: 90000 };
    lines = withSerials(lines);

    const payload = buildSalePayload(lines);
    expect(payload.items[0]).toMatchObject({
      qty: 2,
      unitPrice: 108000,
      totalAmount: 216000,
      costAmount: 90000,
    });
    expect(payload.items[1]).toMatchObject({ qty: 2, unitPrice: 50000, totalAmount: 100000 });
    expect(payload.totalAmount).toBe(316000);
    expect(payload.costAmount).toBe(90000);
  });

  it('agrees exactly with the bill summary shown in the form (task 12.10)', () => {
    const lines = withSerials(drafts());
    const payload = buildSalePayload(lines);
    const summary = summarizeBill(lines);
    expect(summary).toEqual({
      lineCount: payload.items.length,
      qty: payload.qty,
      totalAmount: payload.totalAmount,
      costAmount: payload.costAmount,
      machineCount: payload.equipments.length,
    });
    // 3×120000 + 1×4500 + 2×50000
    expect(summary.totalAmount).toBe(464500);
    expect(summary.machineCount).toBe(6);
  });

  it('converts the _custom sentinel to "" and sends no category with it', () => {
    const line = applyProductSelection(drafts()[1], CUSTOM_PRODUCT_SENTINEL, PRODUCTS);
    const payload = buildSalePayload(withSerials([line]));
    expect(payload.items[0].productId).toBe('');
    expect(payload.items[0].categoryId).toBeNull();
    expect(payload.equipments[0].productId).toBe('');
  });

  it('never sends a categoryId without a linked product', () => {
    // A category left behind on an unlinked draft must not leak into the API.
    const line: SaleLineDraft = { ...drafts()[1], categoryId: 7 };
    const payload = buildSalePayload(withSerials([line]));
    expect(payload.items[0].productId).toBe('');
    expect(payload.items[0].categoryId).toBeNull();
  });

  it('stamps every machine with the quotation docNo and its own line product', () => {
    const lines = withSerials(drafts());
    const payload = buildSalePayload(lines, { quotationRef: 'QT-2568-009' });
    expect(payload.equipments.every((e) => e.quotationNumber === 'QT-2568-009')).toBe(true);
    expect(payload.equipments.slice(0, 3).every((e) => e.productId === 'p1')).toBe(true);
    expect(payload.equipments[3].productName).toBe('ขาตั้งพิเศษ (สั่งทำ)');
    expect(payload.equipments.slice(4).every((e) => e.productId === 'p3')).toBe(true);
  });

  it('omits quotationNumber entirely when no reference was given', () => {
    const payload = buildSalePayload(withSerials([drafts()[2]]));
    expect(payload.equipments[0].quotationNumber).toBeUndefined();
  });

  it('sends empty warranty dates as null, not as ""', () => {
    const lines = withSerials([drafts()[2]]);
    lines[0].machines[0] = { ...lines[0].machines[0], warrantyStartDate: '2026-05-01' };
    const payload = buildSalePayload(lines);
    expect(payload.equipments[0]).toMatchObject({
      warrantyStartDate: '2026-05-01',
      warrantyEndDate: null,
    });
    expect(payload.equipments[1]).toMatchObject({
      warrantyStartDate: null,
      warrantyEndDate: null,
    });
  });

  it('keeps per-machine warranty dates distinct within one bill', () => {
    const lines = withSerials([drafts()[2]]);
    lines[0].machines = [
      { serialNumber: 'S1', warrantyStartDate: '2026-01-01', warrantyEndDate: '2027-01-01' },
      { serialNumber: 'S2', warrantyStartDate: '2026-06-01', warrantyEndDate: '2027-06-01' },
    ];
    const payload = buildSalePayload(lines);
    expect(payload.equipments.map((e) => e.warrantyStartDate)).toEqual(['2026-01-01', '2026-06-01']);
  });

  it('trims serials before they reach the API', () => {
    const lines = [{ ...drafts()[1], machines: [{ serialNumber: '  SN-9  ', warrantyStartDate: '', warrantyEndDate: '' }] }];
    expect(buildSalePayload(lines).equipments[0].serialNumber).toBe('SN-9');
  });

  it('re-derives the machine rows if a draft drifted out of step with its qty', () => {
    const line: SaleLineDraft = { ...drafts()[0], qty: 2, machines: [blankMachine()] };
    const payload = buildSalePayload([line]);
    expect(payload.items[0].qty).toBe(2);
    expect(payload.equipments).toHaveLength(2);
  });

  it('returns empty arrays when nothing is ticked', () => {
    const none = drafts().map((l) => ({ ...l, selected: false }));
    expect(buildSalePayload(none)).toEqual({
      items: [],
      equipments: [],
      totalAmount: 0,
      qty: 0,
      costAmount: 0,
    });
  });

  it('does not mutate the drafts it was given', () => {
    const lines = withSerials(drafts());
    const before = JSON.parse(JSON.stringify(lines));
    buildSalePayload(lines, { quotationRef: 'QT-1' });
    expect(lines).toEqual(before);
  });
});

describe('selectedLines', () => {
  it('keeps display order and drops the unticked', () => {
    const lines = drafts();
    lines[0] = { ...lines[0], selected: false };
    expect(selectedLines(lines).map((l) => l.quotationItemId)).toEqual(['qi2', 'qi3']);
    expect(selectedLines(null)).toEqual([]);
  });
});

// --- 15.5 serials -----------------------------------------------------------

describe('normalizeSerial (task 15.5)', () => {
  it('trims and lowercases, exactly like crmStore.normalizeSerial', () => {
    expect(normalizeSerial('  ab-123 ')).toBe('ab-123');
    expect(normalizeSerial('AB-123')).toBe('ab-123');
    expect(normalizeSerial(null)).toBe('');
    expect(normalizeSerial(undefined)).toBe('');
    expect(normalizeSerial(0)).toBe('0');
  });

  it('agrees with the server rule for the same inputs', () => {
    // Same expression as app/lib/crmStore.ts:normalizeSerial — if this drifts,
    // the form and the API disagree about what a duplicate is.
    const serverRule = (s: unknown) => String(s || '').trim().toLowerCase();
    for (const s of ['  SN-1', 'sn-1  ', 'Sn-1', '', '   ']) {
      expect(normalizeSerial(s)).toBe(serverRule(s));
    }
  });
});

describe('findDuplicateSerialsInForm (tasks 13.5, 15.5)', () => {
  function linesWith(serialsPerLine: string[][]): SaleLineDraft[] {
    return serialsPerLine.map((serials, i) => ({
      ...drafts()[i % 3],
      qty: serials.length,
      selected: true,
      machines: serials.map((s) => ({ ...blankMachine(), serialNumber: s })),
    }));
  }

  it('finds nothing when every serial is unique', () => {
    expect(findDuplicateSerialsInForm(linesWith([['A1', 'A2'], ['B1']]))).toEqual([]);
  });

  it('finds a duplicate within one line', () => {
    const dups = findDuplicateSerialsInForm(linesWith([['A1', 'A1']]));
    expect(dups).toHaveLength(1);
    expect(dups[0].occurrences.map((o) => o.machineIndex)).toEqual([0, 1]);
    expect(dups[0].serialNumber).toBe('A1');
  });

  it('finds a duplicate ACROSS two different lines', () => {
    const dups = findDuplicateSerialsInForm(linesWith([['A1'], ['A1']]));
    expect(dups).toHaveLength(1);
    expect(dups[0].occurrences.map((o) => o.lineIndex)).toEqual([0, 1]);
  });

  it('collides on trim + case, matching the server rule', () => {
    const dups = findDuplicateSerialsInForm(linesWith([[' sn-1 ', 'SN-1']]));
    expect(dups).toHaveLength(1);
    expect(dups[0].normalized).toBe('sn-1');
    expect(dups[0].occurrences).toHaveLength(2);
  });

  it('reports a triple as one group with three occurrences', () => {
    const dups = findDuplicateSerialsInForm(linesWith([['X', 'x', ' X ']]));
    expect(dups).toHaveLength(1);
    expect(dups[0].occurrences).toHaveLength(3);
  });

  it('ignores blank serials (those are the separate missing-serial rule)', () => {
    expect(findDuplicateSerialsInForm(linesWith([['', '  ', '']]))).toEqual([]);
  });

  it('ignores machines of lines that are not ticked', () => {
    const lines = linesWith([['A1'], ['A1']]);
    lines[1] = { ...lines[1], selected: false };
    expect(findDuplicateSerialsInForm(lines)).toEqual([]);
  });

  it('returns data and never throws — duplicates are legal once confirmed', () => {
    expect(() => findDuplicateSerialsInForm(null)).not.toThrow();
    expect(findDuplicateSerialsInForm(undefined)).toEqual([]);
  });

  it('names the line so the warning can point at it', () => {
    const dups = findDuplicateSerialsInForm(linesWith([['A1'], ['A1']]));
    expect(dups[0].occurrences[0]).toMatchObject({
      quotationItemId: 'qi1',
      productName: 'เครื่องชั่ง A',
    });
  });
});

describe('collectSerials', () => {
  it('collects trimmed, non-empty serials from ticked lines in form order', () => {
    const lines = drafts().map((l, i) => ({
      ...l,
      selected: i !== 1,
      machines: l.machines.map((m, j) => ({ ...m, serialNumber: j === 0 ? ` S${i}${j} ` : '' })),
    }));
    expect(collectSerials(lines)).toEqual(['S00', 'S20']);
  });
});

describe('findMissingSerials (task 12.11)', () => {
  it('points at every blank machine of every ticked line', () => {
    const lines = drafts();
    lines[0] = {
      ...lines[0],
      machines: [
        { ...blankMachine(), serialNumber: 'A' },
        blankMachine(),
        { ...blankMachine(), serialNumber: '   ' },
      ],
    };
    lines[1] = { ...lines[1], selected: false };
    lines[2] = withSerials([lines[2]])[0];

    expect(findMissingSerials(lines).map((m) => [m.lineIndex, m.machineIndex])).toEqual([
      [0, 1],
      [0, 2],
    ]);
  });

  it('is empty when every machine has a serial', () => {
    expect(findMissingSerials(withSerials(drafts()))).toEqual([]);
  });
});

describe('validateLineDrafts (the only hard blockers)', () => {
  it('passes a fully filled form', () => {
    expect(validateLineDrafts(withSerials(drafts()))).toEqual([]);
  });

  it('blocks when no line is ticked', () => {
    const none = drafts().map((l) => ({ ...l, selected: false }));
    expect(validateLineDrafts(none)).toEqual(['กรุณาเลือกรายการสินค้าอย่างน้อย 1 รายการ']);
  });

  it('blocks a zero / negative / fractional quantity', () => {
    for (const qty of [0, -1, 1.5, NaN]) {
      const lines = withSerials([{ ...drafts()[2], qty } as SaleLineDraft]);
      expect(validateLineDrafts(lines).some((e) => e.includes('จำนวนที่ขายจริง'))).toBe(true);
    }
  });

  it('blocks a missing serial and names the line and the machine', () => {
    const lines = drafts().map((l) => ({ ...l, selected: false }));
    lines[2] = { ...lines[2], selected: true };
    const errors = validateLineDrafts(lines);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain('เครื่องที่ 1');
    expect(errors[0]).toContain('เครื่องวัด C');
  });

  it('blocks a bill over the API machine cap', () => {
    const big = withSerials([setLineQty(drafts()[0], MAX_EQUIPMENT_ROWS_PER_SALE)]);
    expect(validateLineDrafts(big)).toEqual([]);

    const over = withSerials([setLineQty(drafts()[0], MAX_EQUIPMENT_ROWS_PER_SALE + 1)]);
    expect(validateLineDrafts(over).some((e) => e.includes('สูงสุด'))).toBe(true);
    // …and the payload still carries one machine per unit rather than silently
    // dropping the 51st, so the count the admin is warned about is the real one.
    const payload = buildSalePayload(over);
    expect(payload.qty).toBe(MAX_EQUIPMENT_ROWS_PER_SALE + 1);
    expect(payload.equipments).toHaveLength(payload.qty);
  });

  it('does NOT block an already-sold or over-quoted line (warn only)', () => {
    let lines = drafts([{ quotationItemId: 'qi1', soldQty: 3 }]);
    lines[0] = setLineQty({ ...lines[0], selected: true }, 5); // sold before AND over-quoted
    lines = withSerials(lines);
    expect(validateLineDrafts(lines)).toEqual([]);
    expect(findResoldLines(lines)).toHaveLength(1);
    expect(findOverQuotedLines(lines)).toHaveLength(1);
  });

  it('does NOT block duplicate serials (warn only)', () => {
    const lines = drafts().map((l) => ({
      ...l,
      machines: l.machines.map(() => ({ ...blankMachine(), serialNumber: 'SAME' })),
    }));
    expect(validateLineDrafts(lines)).toEqual([]);
    expect(findDuplicateSerialsInForm(lines)).toHaveLength(1);
  });
});

// --- 15.6 quotation builder keeps / clears the id ---------------------------

describe('quotation builder party link (tasks 14.2-14.3, 15.6)', () => {
  it('stores BOTH the name and the id when picked from the system dropdown', () => {
    expect(selectPartyFromSystem({ id: 'c1', name: 'สมชาย ใจดี' })).toEqual({
      id: 'c1',
      name: 'สมชาย ใจดี',
    });
  });

  it('stores an empty link when the dropdown selection is cleared', () => {
    expect(selectPartyFromSystem(null)).toEqual({ id: '', name: '' });
    expect(selectPartyFromSystem(undefined)).toEqual({ id: '', name: '' });
  });

  it('CLEARS the id when the name is typed over by hand', () => {
    const picked = selectPartyFromSystem({ id: 'c1', name: 'สมชาย ใจดี' });
    const typed = applyTypedPartyName(picked, 'สมชาย ใจร้าย');
    expect(typed).toEqual({ id: '', name: 'สมชาย ใจร้าย' });
  });

  it('clears the id when the name is emptied', () => {
    const picked = selectPartyFromSystem({ id: 'co1', name: 'บริษัท เอบีซี จำกัด' });
    expect(applyTypedPartyName(picked, '')).toEqual({ id: '', name: '' });
  });

  it('keeps the id when the typed text still names the same row', () => {
    const picked = selectPartyFromSystem({ id: 'c2', name: 'Somsak Wong' });
    expect(applyTypedPartyName(picked, ' somsak wong ')).toEqual({
      id: 'c2',
      name: ' somsak wong ',
    });
  });

  it('stays empty when a free-text name is typed with no dropdown pick', () => {
    expect(applyTypedPartyName({ name: '', id: '' }, 'ลูกค้านอกระบบ')).toEqual({
      id: '',
      name: 'ลูกค้านอกระบบ',
    });
    expect(applyTypedPartyName(undefined, 'ลูกค้านอกระบบ').id).toBe('');
  });

  it('a stored id can never disagree with the displayed name', () => {
    // Pick → type a different name → the pair is consistent again.
    const picked = selectPartyFromSystem({ id: 'c1', name: 'สมชาย ใจดี' });
    const typed = applyTypedPartyName(picked, 'อีกคนหนึ่ง');
    const roundTrip = resolveAutoFill({ id: typed.id, name: typed.name, list: CUSTOMERS });
    expect(roundTrip.selectedId).toBe(''); // no wrong customer bound to the sale
    expect(roundTrip.status).toBe('none');
  });

  it('an old quotation with no id still resolves by name (task 14.4)', () => {
    const legacy = { name: 'สมชาย ใจดี', id: '' };
    expect(resolveAutoFill({ id: legacy.id, name: legacy.name, list: CUSTOMERS })).toMatchObject({
      source: 'name',
      selectedId: 'c1',
      autoFilled: true,
    });
  });

  it('does not mutate the link it was given', () => {
    const picked = selectPartyFromSystem({ id: 'c1', name: 'สมชาย ใจดี' });
    applyTypedPartyName(picked, 'x');
    expect(picked).toEqual({ id: 'c1', name: 'สมชาย ใจดี' });
  });
});
