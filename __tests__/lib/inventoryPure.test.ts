// @vitest-environment node
/**
 * The pure parts of the asset register / stock: statuses, search + filters +
 * totals, the Excel rows, sticker layout, and the zero-allowed money parser.
 * Spec: openspec/changes/add-inventory-tracking.
 */
import { describe, it, expect } from 'vitest';
import type { InventoryGroup, InventoryItem } from '@/app/lib/types';
import {
  inventoryStatuses,
  inventoryStatus,
  inventoryStatusLabel,
  isGoneStatus,
  defaultInventoryStatus,
  statusDetailText,
  formatInventoryCode,
} from '@/app/lib/inventoryStatus';
import {
  buildInventoryView,
  isFiltering,
  filterChoices,
  searchWords,
  suggestionsFrom,
  itemsWithSerial,
  EMPTY_FILTERS,
  type InventoryFilters,
} from '@/app/lib/inventorySearch';
import { inventoryExportSheets, inventoryExportFilename } from '@/app/lib/inventoryExport';
import { LABEL_PRESETS, labelPreset, layoutLabels, labelPosition, clampStartAt, labelsPerPage } from '@/app/lib/inventoryLabels';
import { parseNonNegativeMoney } from '@/app/lib/moneyAmount';

const group = (id: string, over: Partial<InventoryGroup> = {}): InventoryGroup => ({
  id, kind: 'stock', name: `กลุ่ม ${id}`, brand: '', model: '', category: '', note: '', createdAt: 'c', updatedAt: 'u', ...over,
});
let seq = 0;
const item = (groupId: string, over: Partial<InventoryItem> = {}): InventoryItem => {
  seq++;
  return {
    id: `i${seq}`, kind: 'stock', groupId, code: formatInventoryCode('stock', seq), seq,
    serialNumber: '', purchaseDate: '2026-09-01', price: 100, supplierId: null, supplierName: '', location: '',
    custodian: '', warrantyUntil: null, status: 'available', statusParty: '', statusDate: null, note: '',
    createdAt: 'c', updatedAt: 'u', ...over,
  };
};
const f = (over: Partial<InventoryFilters> = {}): InventoryFilters => ({ ...EMPTY_FILTERS, ...over });

describe('inventoryStatus', () => {
  it('each register has its own statuses, and a default that is one of them', () => {
    expect(inventoryStatuses('asset').map((s) => s.key)).toEqual(['in_use', 'in_storage', 'repair', 'loaned', 'disposed', 'broken']);
    expect(inventoryStatuses('stock').map((s) => s.key)).toEqual(['available', 'reserved', 'repair', 'sold', 'returned', 'broken']);
    for (const kind of ['asset', 'stock'] as const) {
      expect(inventoryStatus(kind, defaultInventoryStatus(kind))).toBeDefined();
      expect(isGoneStatus(kind, defaultInventoryStatus(kind))).toBe(false);
    }
  });

  it('gone: what has left the company', () => {
    expect(inventoryStatuses('asset').filter((s) => s.gone).map((s) => s.key)).toEqual(['disposed', 'broken']);
    expect(inventoryStatuses('stock').filter((s) => s.gone).map((s) => s.key)).toEqual(['sold', 'returned', 'broken']);
  });

  it('an unknown status is shown as itself', () => {
    expect(inventoryStatusLabel('asset', 'weird')).toBe('weird');
    expect(inventoryStatusLabel('stock', 'sold')).toBe('ขายแล้ว');
  });

  it("statusDetailText: only the fields the status uses, only when filled", () => {
    expect(statusDetailText('asset', 'loaned', 'สมชาย', '2026-10-20')).toBe('ผู้ยืม: สมชาย · กำหนดคืน: 2026-10-20');
    expect(statusDetailText('asset', 'loaned', 'สมชาย', null)).toBe('ผู้ยืม: สมชาย');
    expect(statusDetailText('asset', 'in_use', 'สมชาย', '2026-10-20')).toBe('');
    expect(statusDetailText('stock', 'sold', '', '2026-10-01')).toBe('วันที่ขาย: 2026-10-01');
  });

  it('codes: at least four digits, more past 9999', () => {
    expect(formatInventoryCode('asset', 1)).toBe('AS-0001');
    expect(formatInventoryCode('stock', 12345)).toBe('ST-12345');
  });
});

describe('buildInventoryView', () => {
  const g1 = group('g1', { name: 'เครื่องชั่ง', brand: 'Ohaus', category: 'เครื่องชั่ง' });
  const g2 = group('g2', { name: 'ปิเปต', category: 'แล็บ' });
  const empty = group('g3', { name: 'ว่าง' });
  const a = item('g1', { price: 100, serialNumber: 'SN-AAA', location: 'คลัง A' });
  const b = item('g1', { price: 200, status: 'sold', statusDate: '2026-09-10', statusParty: 'บริษัท เอ' });
  const c = item('g1', { price: 300, status: 'reserved', statusParty: 'คุณสมชาย', purchaseDate: '2026-09-20' });
  const d = item('g2', { price: 50.1, location: 'คลัง B', supplierName: 'Thermo' });
  const groups = [g2, empty, g1];
  const items = [a, b, c, d];

  it('by default hides what has left, and counts only what is still here', () => {
    const v = buildInventoryView('stock', groups, items, f());
    expect(v.items.map((i) => i.id)).toEqual([a.id, c.id, d.id]);
    expect(v.value).toBe(450.1);
    // Status cards still count the sold one.
    expect(v.statusCounts).toEqual({ available: 2, sold: 1, reserved: 1 });
    // Not filtering: every group shows, the empty one too, A-Z.
    expect(v.groups.map((x) => x.group.id)).toEqual([empty.id, g2.id, g1.id].sort((p, q) =>
      groups.find((g) => g.id === p)!.name.localeCompare(groups.find((g) => g.id === q)!.name, 'th')));
    const gv = v.groups.find((x) => x.group.id === 'g1')!;
    expect(gv.counts).toEqual({ available: 1, reserved: 1 });
    expect(gv.value).toBe(400);
  });

  it('show gone: the sold piece appears, still not in the value', () => {
    const v = buildInventoryView('stock', groups, items, f({ showGone: true }));
    expect(v.items).toHaveLength(4);
    expect(v.value).toBe(450.1);
  });

  it('picking a status shows exactly those, gone or not', () => {
    const v = buildInventoryView('stock', groups, items, f({ statuses: ['sold'] }));
    expect(v.items.map((i) => i.id)).toEqual([b.id]);
    expect(v.groups.map((x) => x.group.id)).toEqual(['g1']);
  });

  it('search: every word, across the group and the piece, any case', () => {
    expect(buildInventoryView('stock', groups, items, f({ query: 'ohaus sn-aaa' })).items.map((i) => i.id)).toEqual([a.id]);
    expect(buildInventoryView('stock', groups, items, f({ query: 'สมชาย' })).items.map((i) => i.id)).toEqual([c.id]);
    expect(buildInventoryView('stock', groups, items, f({ query: 'จองแล้ว' })).items.map((i) => i.id)).toEqual([c.id]);
    expect(buildInventoryView('stock', groups, items, f({ query: c.code.toLowerCase() })).items.map((i) => i.id)).toEqual([c.id]);
    expect(buildInventoryView('stock', groups, items, f({ query: 'ohaus thermo' })).items).toEqual([]);
  });

  it('filters by category, place, supplier and purchase date (inclusive)', () => {
    expect(buildInventoryView('stock', groups, items, f({ category: 'แล็บ' })).items.map((i) => i.id)).toEqual([d.id]);
    expect(buildInventoryView('stock', groups, items, f({ location: 'คลัง A' })).items.map((i) => i.id)).toEqual([a.id]);
    expect(buildInventoryView('stock', groups, items, f({ supplier: 'Thermo' })).items.map((i) => i.id)).toEqual([d.id]);
    expect(buildInventoryView('stock', groups, items, f({ dateFrom: '2026-09-20', dateTo: '2026-09-20' })).items.map((i) => i.id)).toEqual([c.id]);
  });

  it('while filtering, groups without a match are left out', () => {
    expect(buildInventoryView('stock', groups, items, f({ query: 'ปิเปต' })).groups.map((x) => x.group.id)).toEqual(['g2']);
  });

  it('sorts groups by count, value, newest purchase', () => {
    expect(buildInventoryView('stock', groups, items, f({ query: ' ' }), 'count').groups[0].group.id).toBe('g1');
    expect(buildInventoryView('stock', groups, items, f(), 'value').groups[0].group.id).toBe('g1');
    expect(buildInventoryView('stock', groups, items, f(), 'newest').groups[0].group.id).toBe('g1');
  });

  it('pieces within a group: oldest code first', () => {
    const v = buildInventoryView('stock', groups, [c, a], f());
    expect(v.groups.find((x) => x.group.id === 'g1')!.items.map((i) => i.id)).toEqual([a.id, c.id]);
  });

  it('isFiltering ignores "show gone"', () => {
    expect(isFiltering(f({ showGone: true }))).toBe(false);
    expect(isFiltering(f({ query: '  ' }))).toBe(false);
    expect(isFiltering(f({ location: 'x' }))).toBe(true);
  });

  it('searchWords splits on any space', () => {
    expect(searchWords('  Ohaus\tPX 224 ')).toEqual(['ohaus', 'px', '224']);
  });
});

describe('filters ignore case and surrounding space, like their choices', () => {
  it('"Ohaus" also finds "ohaus "', () => {
    const g = group('g', { category: 'Lab ' });
    const x = item('g', { supplierName: 'Ohaus', location: 'คลัง A' });
    const y = item('g', { supplierName: 'ohaus ', location: ' คลัง a' });
    expect(buildInventoryView('stock', [g], [x, y], f({ supplier: 'Ohaus' })).items).toHaveLength(2);
    expect(buildInventoryView('stock', [g], [x, y], f({ location: 'คลัง A' })).items).toHaveLength(2);
    expect(buildInventoryView('stock', [g], [x, y], f({ category: 'lab' })).items).toHaveLength(2);
  });

  it('filterChoices: "all", the values in use, and the current one even when nothing carries it', () => {
    expect(filterChoices(['B', 'A', 'A'], '', 'ทั้งหมด').map((o) => o.value)).toEqual(['', 'A', 'B']);
    expect(filterChoices(['B'], 'คลังเก่า', 'ทั้งหมด').map((o) => o.value)).toEqual(['', 'คลังเก่า', 'B']);
    expect(filterChoices(['Ohaus'], 'ohaus', 'ทั้งหมด').map((o) => o.value)).toEqual(['', 'Ohaus']);
  });
});

describe('suggestionsFrom', () => {
  it('distinct, most used first, case and spaces folded', () => {
    expect(suggestionsFrom(['คลัง B', 'คลัง A', ' คลัง A ', '', 'Lab', 'lab', 'คลัง A'])).toEqual(['คลัง A', 'Lab', 'คลัง B']);
  });
});

describe('itemsWithSerial', () => {
  it('finds the same serial, any case, except the pieces named', () => {
    const x = item('g1', { serialNumber: 'AB-1' });
    const y = item('g1', { serialNumber: 'ab-1 ' });
    expect(itemsWithSerial([x, y], ' Ab-1').map((i) => i.id)).toEqual([x.id, y.id]);
    expect(itemsWithSerial([x, y], 'AB-1', [x.id]).map((i) => i.id)).toEqual([y.id]);
    expect(itemsWithSerial([x, y], '  ')).toEqual([]);
  });
});

describe('inventoryExportSheets', () => {
  it('one row per piece, one per group; asset columns for assets only', () => {
    const g = group('g1', { kind: 'asset', name: 'คอม', brand: 'Dell', model: 'X' });
    const p = item('g1', { kind: 'asset', code: 'AS-0001', status: 'loaned', statusParty: 'สมชาย', custodian: 'IT', price: 25000 });
    const view = buildInventoryView('asset', [g], [p], f());
    const [pieces, summary] = inventoryExportSheets('asset', view.groups);
    expect(pieces.name).toBe('รายชิ้น');
    expect(pieces.rows[0]).toMatchObject({
      'รหัส': 'AS-0001', 'ชื่อ': 'คอม', 'ราคาซื้อ': 25000, 'ผู้ดูแล': 'IT', 'สถานะ': 'ยืมออก', 'รายละเอียดสถานะ': 'ผู้ยืม: สมชาย',
    });
    expect(summary.rows[0]).toMatchObject({ 'ชื่อ': 'คอม', 'จำนวนชิ้น': 1, 'ยืมออก': 1, 'ใช้งานอยู่': 0, 'มูลค่า (ของที่ยังมีอยู่)': 25000 });

    const [stockPieces] = inventoryExportSheets('stock', buildInventoryView('stock', [group('s')], [item('s')], f()).groups);
    expect(Object.keys(stockPieces.rows[0])).not.toContain('ผู้ดูแล');
    expect(Object.keys(stockPieces.rows[0])).toContain('ราคาทุน');
  });

  it('filename names the register and the day', () => {
    expect(inventoryExportFilename('stock', '2026-10-05')).toBe('สต็อกสินค้า_2026-10-05.xlsx');
  });
});

describe('inventoryLabels', () => {
  it('every A4 preset fits the page', () => {
    for (const p of LABEL_PRESETS) {
      const right = p.marginLeftMm + p.cols * p.labelWidthMm + (p.cols - 1) * p.gapXMm;
      const bottom = p.marginTopMm + p.rows * p.labelHeightMm + (p.rows - 1) * p.gapYMm;
      expect(right, p.id).toBeLessThanOrEqual(p.pageWidthMm + 0.01);
      expect(bottom, p.id).toBeLessThanOrEqual(p.pageHeightMm + 0.01);
    }
  });

  it('starting at cell 5 leaves 1–4 empty', () => {
    const p = labelPreset('a4-3x8');
    const pages = layoutLabels(['x', 'y'], p, 5);
    expect(pages).toHaveLength(1);
    expect(pages[0].slice(0, 6)).toEqual([null, null, null, null, 'x', 'y']);
    expect(pages[0]).toHaveLength(24);
  });

  it('spills onto more pages', () => {
    const p = labelPreset('a4-3x8');
    const pages = layoutLabels(Array.from({ length: 30 }, (_, i) => i), p, 20);
    expect(pages).toHaveLength(3); // 19 empty + 30 = 49 cells → 24, 24, 1
    expect(pages[2].filter((c) => c !== null)).toEqual([29]);
  });

  it('start position is clamped to the sheet, and a roll is always 1', () => {
    expect(clampStartAt(labelPreset('a4-3x8'), 0)).toBe(1);
    expect(clampStartAt(labelPreset('a4-3x8'), 99)).toBe(24);
    expect(clampStartAt(labelPreset('roll-62x29'), 5)).toBe(1);
    expect(labelsPerPage(labelPreset('roll-62x29'))).toBe(1);
  });

  it('an unknown preset falls back to A4 3 × 8', () => {
    expect(labelPreset('nope').id).toBe('a4-3x8');
  });

  it('cell positions step by label + gap', () => {
    const p = labelPreset('a4-2x7');
    expect(labelPosition(p, 0)).toEqual({ topMm: 15.15, leftMm: 4.65 });
    expect(labelPosition(p, 3)).toEqual({ topMm: 15.15 + 38.1, leftMm: 4.65 + 99.1 + 2.5 });
  });

  it('nothing to print, no pages', () => {
    expect(layoutLabels([], labelPreset('a4-3x8'))).toEqual([]);
  });
});

describe('parseNonNegativeMoney', () => {
  it('zero and plain amounts pass, rounded to the satang', () => {
    expect(parseNonNegativeMoney(0)).toEqual({ ok: true, amount: 0 });
    expect(parseNonNegativeMoney('1500.005')).toEqual({ ok: true, amount: 1500.01 });
    expect(parseNonNegativeMoney('.5')).toEqual({ ok: true, amount: 0.5 });
  });

  it.each([-0.01, '-1', '1e3', '0x10', '', 'abc', null, undefined, true, Infinity, 10_000_000_000])('refuses %s', (v) => {
    expect(parseNonNegativeMoney(v).ok).toBe(false);
  });
});
