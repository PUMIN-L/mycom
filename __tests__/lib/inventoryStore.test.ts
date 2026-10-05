// @vitest-environment node
/**
 * The asset register and stock (app/lib/inventoryStore.ts), run against an
 * in-memory database that executes the store's statements and rolls a failed
 * transaction back (__tests__/helpers/fakeInventoryDb.ts). Assertions are on
 * the rows a later request would see.
 * Spec: openspec/changes/add-inventory-tracking.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createFakeInventoryDb, type FakeInventoryDb } from '../helpers/fakeInventoryDb';

let db: FakeInventoryDb;

vi.mock('@/app/lib/db', () => ({
  query: (sql: string, params?: unknown[]) => db.run(sql, params),
  withTransaction: (fn: (c: unknown) => Promise<unknown>) => db.transaction(fn as never),
}));

import {
  listInventory,
  getItem,
  createGroup,
  updateGroup,
  deleteGroup,
  mergeGroups,
  addItems,
  updateItem,
  deleteItem,
  bulkUpdateItems,
  cleanItemFields,
  mergeItemPatch,
  itemChangeEvents,
  isInventoryKind,
  InventoryValidationError,
  InventoryNotFoundError,
  GroupNotEmptyError,
} from '@/app/lib/inventoryStore';

const BASE = { purchaseDate: '2026-09-01', price: 1500 };

beforeEach(() => {
  db = createFakeInventoryDb({
    suppliers: [{ id: 'sup-1', companyName: 'Ohaus Thailand' }],
  });
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-01T03:00:00.000Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

const items = () => db.tables.inventory_items;
const events = () => db.tables.inventory_events;
const groups = () => db.tables.inventory_groups;

/** A snapshot of every table, to prove a refused call wrote nothing. */
const snapshot = () => JSON.stringify(db.tables);

async function newGroupWith(kind: 'asset' | 'stock', quantity: number, extra: Record<string, unknown> = {}) {
  return addItems(kind, { group: { name: 'เครื่องชั่ง', brand: 'Ohaus', model: 'PX224' }, quantity, ...BASE, ...extra });
}

describe('isInventoryKind', () => {
  it('only asset and stock', () => {
    expect(isInventoryKind('asset')).toBe(true);
    expect(isInventoryKind('stock')).toBe(true);
    expect(isInventoryKind('assets')).toBe(false);
    expect(isInventoryKind(undefined)).toBe(false);
  });
});

describe('addItems — a group and its pieces, with codes', () => {
  it('creates the group, one row per piece with its own code and serial, and a "received" line for each', async () => {
    const { group, items: added } = await newGroupWith('asset', 3, { serials: ['SN1', '', 'SN3'], location: 'คลัง A' });
    expect(groups()).toHaveLength(1);
    expect(group.name).toBe('เครื่องชั่ง');
    expect(added.map((i) => i.code)).toEqual(['AS-0001', 'AS-0002', 'AS-0003']);
    expect(added.map((i) => i.serialNumber)).toEqual(['SN1', '', 'SN3']);
    expect(items().map((r) => r.code)).toEqual(['AS-0001', 'AS-0002', 'AS-0003']);
    expect(items().every((r) => r.groupId === group.id && r.status === 'in_use' && r.location === 'คลัง A')).toBe(true);
    expect(events()).toHaveLength(3);
    expect(events().every((e) => e.eventType === 'created' && e.toValue === 'in_use')).toBe(true);
    expect(events()[0].detail).toBe('ที่เก็บ: คลัง A');
  });

  it('codes carry on across adds, and a deleted code is never handed out again', async () => {
    const first = await newGroupWith('asset', 2);
    await addItems('asset', { groupId: first.group.id, quantity: 1, ...BASE });
    expect(items().map((r) => r.code)).toEqual(['AS-0001', 'AS-0002', 'AS-0003']);

    const last = items().find((r) => r.code === 'AS-0003')!;
    await deleteItem('asset', String(last.id));
    await addItems('asset', { groupId: first.group.id, quantity: 1, ...BASE });
    expect(items().map((r) => r.code)).toEqual(['AS-0001', 'AS-0002', 'AS-0004']);
  });

  it('a lost counter row cannot hand out a code already in use', async () => {
    await newGroupWith('asset', 2);
    db.tables.inventory_counters = [];
    const { items: added } = await newGroupWith('asset', 1);
    expect(added[0].code).toBe('AS-0003');
  });

  it('assets and stock count separately', async () => {
    await newGroupWith('asset', 2);
    const { items: stock } = await newGroupWith('stock', 1);
    expect(stock[0].code).toBe('ST-0001');
    expect(stock[0].status).toBe('available');
  });

  it.each([0, 101, 1.5, 'x', undefined])('refuses quantity %s and writes nothing', async (quantity) => {
    const before = snapshot();
    await expect(addItems('asset', { group: { name: 'x' }, quantity, ...BASE })).rejects.toThrow(InventoryValidationError);
    expect(snapshot()).toBe(before);
  });

  it('refuses more serials than pieces', async () => {
    await expect(newGroupWith('asset', 1, { serials: ['a', 'b'] })).rejects.toThrow('ใส่ซีเรียลเกินจำนวนชิ้น');
  });

  it('refuses a new group without a name', async () => {
    await expect(addItems('asset', { group: { name: '  ' }, quantity: 1, ...BASE })).rejects.toThrow('กรุณาระบุชื่อรายการ');
  });

  it("will not add a piece to the other register's group", async () => {
    const { group } = await newGroupWith('stock', 1);
    const before = snapshot();
    await expect(addItems('asset', { groupId: group.id, quantity: 1, ...BASE })).rejects.toThrow(InventoryValidationError);
    expect(snapshot()).toBe(before);
  });

  it('a failure part-way rolls back the group, the pieces and the counter', async () => {
    const before = snapshot();
    db.failOn(/^INSERT INTO inventory_events/);
    await expect(newGroupWith('asset', 2)).rejects.toThrow('boom');
    expect(snapshot()).toBe(before);
  });
});

describe('suppliers — picked from the list, or typed', () => {
  it('a picked supplier is stored with its name; the list shows the CURRENT name', async () => {
    await newGroupWith('asset', 1, { supplierId: 'sup-1', supplierName: 'whatever the form sent' });
    expect(items()[0].supplierName).toBe('Ohaus Thailand');

    db.tables.suppliers[0].companyName = 'Ohaus Thailand Co., Ltd.';
    const { items: listed } = await listInventory('asset');
    expect(listed[0].supplierName).toBe('Ohaus Thailand Co., Ltd.');
  });

  it('a deleted supplier leaves the name the item carries', async () => {
    await newGroupWith('asset', 1, { supplierId: 'sup-1' });
    db.tables.suppliers = [];
    const { items: listed } = await listInventory('asset');
    expect(listed[0].supplierName).toBe('Ohaus Thailand');
  });

  it('an id that is not a supplier is dropped; the typed name stays', async () => {
    await newGroupWith('asset', 1, { supplierId: 'gone', supplierName: 'ร้านเครื่องมือ' });
    expect(items()[0].supplierId).toBeNull();
    expect(items()[0].supplierName).toBe('ร้านเครื่องมือ');
  });
});

describe('cleanItemFields — what may be stored', () => {
  const ok = { ...BASE, status: 'in_use' };

  it('a borrowed piece needs a borrower', () => {
    expect(() => cleanItemFields('asset', { ...ok, status: 'loaned' })).toThrow('กรุณาระบุผู้ยืม');
    expect(cleanItemFields('asset', { ...ok, status: 'loaned', statusParty: 'สมชาย', statusDate: '2026-10-20' })).toMatchObject({
      statusParty: 'สมชาย',
      statusDate: '2026-10-20',
    });
  });

  it('a sale needs a date, not before the purchase', () => {
    expect(() => cleanItemFields('stock', { ...BASE, status: 'sold' })).toThrow('กรุณาระบุวันที่ขาย');
    expect(() => cleanItemFields('stock', { ...BASE, status: 'sold', statusDate: '2026-08-31' })).toThrow('ต้องไม่ก่อนวันที่ซื้อ');
    expect(cleanItemFields('stock', { ...BASE, status: 'sold', statusDate: '2026-09-01' }).statusDate).toBe('2026-09-01');
  });

  it("drops the extra fields a status does not use", () => {
    const f = cleanItemFields('asset', { ...ok, status: 'in_storage', statusParty: 'สมชาย', statusDate: '2026-10-20' });
    expect(f.statusParty).toBe('');
    expect(f.statusDate).toBeNull();
  });

  it('keeps custodian and warranty for assets only', () => {
    const asset = cleanItemFields('asset', { ...ok, custodian: 'ฝ่ายขาย', warrantyUntil: '2027-09-01' });
    expect(asset).toMatchObject({ custodian: 'ฝ่ายขาย', warrantyUntil: '2027-09-01' });
    const stock = cleanItemFields('stock', { ...BASE, status: 'available', custodian: 'ฝ่ายขาย', warrantyUntil: '2027-09-01' });
    expect(stock).toMatchObject({ custodian: '', warrantyUntil: null });
  });

  it.each([-1, '1e3', 'abc', '', null, true])('refuses price %s', (price) => {
    expect(() => cleanItemFields('asset', { ...ok, price })).toThrow(InventoryValidationError);
  });

  it('a price of 0 is fine, and is rounded to the satang', () => {
    expect(cleanItemFields('asset', { ...ok, price: 0 }).price).toBe(0);
    expect(cleanItemFields('asset', { ...ok, price: '1500.005' }).price).toBe(1500.01);
  });

  it('refuses an unknown status, or one of the other register', () => {
    expect(() => cleanItemFields('asset', { ...BASE, status: 'available' })).toThrow('สถานะไม่ถูกต้อง');
    expect(() => cleanItemFields('stock', { ...BASE, status: 'in_use' })).toThrow('สถานะไม่ถูกต้อง');
  });

  it('refuses a date that is not a real YYYY-MM-DD', () => {
    expect(() => cleanItemFields('asset', { ...ok, purchaseDate: '2026-02-30' })).toThrow('วันที่ซื้อ');
    expect(() => cleanItemFields('asset', { ...ok, purchaseDate: '' })).toThrow('กรุณาระบุวันที่ซื้อ');
    expect(() => cleanItemFields('asset', { ...ok, warrantyUntil: '1/9/2026' })).toThrow('วันหมดประกัน');
  });

  it('strips markup and trims text', () => {
    expect(cleanItemFields('asset', { ...ok, location: '  <b>คลัง</b> A ' }).location).toBe('คลัง A');
  });
});

describe('mergeItemPatch — a changed status brings its own extra fields', () => {
  const current = cleanItemFields('asset', { ...BASE, status: 'repair', statusParty: 'ร้าน A' });

  it("a new status does not inherit the old one's detail", () => {
    const merged = mergeItemPatch(current, { status: 'loaned' });
    expect(merged.statusParty).toBe('');
    expect(() => cleanItemFields('asset', merged)).toThrow('กรุณาระบุผู้ยืม');
  });

  it('the same status keeps its detail unless the patch changes it', () => {
    expect(mergeItemPatch(current, { status: 'repair' }).statusParty).toBe('ร้าน A');
    expect(mergeItemPatch(current, { price: 10 }).statusParty).toBe('ร้าน A');
  });
});

describe('itemChangeEvents', () => {
  const a = cleanItemFields('asset', { ...BASE, status: 'in_storage', location: 'คลัง A' });

  it('status and place changes, nothing for other fields', () => {
    const b = cleanItemFields('asset', { ...BASE, status: 'loaned', statusParty: 'สมชาย', location: 'คลัง B', price: 99 });
    expect(itemChangeEvents('asset', a, b)).toEqual([
      { eventType: 'status', fromValue: 'in_storage', toValue: 'loaned', detail: 'ผู้ยืม: สมชาย' },
      { eventType: 'location', fromValue: 'คลัง A', toValue: 'คลัง B', detail: '' },
    ]);
    expect(itemChangeEvents('asset', a, { ...a, price: 5, note: 'x' })).toEqual([]);
  });

  it("a status's detail changing on its own is a line too: a new borrower, a new return date", () => {
    const lent = cleanItemFields('asset', { ...BASE, status: 'loaned', statusParty: 'สมชาย', statusDate: '2026-10-20' });
    const otherBorrower = { ...lent, statusParty: 'สมหญิง' };
    const later = { ...lent, statusDate: '2026-10-31' };
    expect(itemChangeEvents('asset', lent, otherBorrower)).toEqual([
      { eventType: 'status', fromValue: 'loaned', toValue: 'loaned', detail: 'ผู้ยืม: สมหญิง · กำหนดคืน: 2026-10-20' },
    ]);
    expect(itemChangeEvents('asset', lent, later)).toEqual([
      { eventType: 'status', fromValue: 'loaned', toValue: 'loaned', detail: 'ผู้ยืม: สมชาย · กำหนดคืน: 2026-10-31' },
    ]);
  });
});

describe('updateItem', () => {
  async function onePiece(kind: 'asset' | 'stock' = 'asset', extra: Record<string, unknown> = {}) {
    const { items: [item] } = await newGroupWith(kind, 1, { location: 'คลัง A', ...extra });
    return item;
  }

  it('lend it out, then bring it back: the detail is cleared, the timeline keeps it', async () => {
    const item = await onePiece();
    vi.setSystemTime(new Date('2026-10-02T03:00:00.000Z'));
    await updateItem('asset', item.id, { status: 'loaned', statusParty: 'สมชาย', statusDate: '2026-10-20' });
    vi.setSystemTime(new Date('2026-10-03T03:00:00.000Z'));
    const back = await updateItem('asset', item.id, { status: 'in_storage' });

    expect(back).toMatchObject({ status: 'in_storage', statusParty: '', statusDate: null });
    const got = await getItem('asset', item.id);
    expect(got!.events.map((e) => [e.eventType, e.fromValue, e.toValue])).toEqual([
      ['status', 'loaned', 'in_storage'],
      ['status', 'in_use', 'loaned'],
      ['created', '', 'in_use'],
    ]);
    expect(got!.events[1].detail).toBe('ผู้ยืม: สมชาย · กำหนดคืน: 2026-10-20');
  });

  it('changing only the price writes no timeline line', async () => {
    const item = await onePiece();
    await updateItem('asset', item.id, { price: 2000 });
    expect(items()[0].price).toBe('2000.00');
    expect(events()).toHaveLength(1);
  });

  it('a move of place is on the timeline', async () => {
    const item = await onePiece();
    await updateItem('asset', item.id, { location: 'ห้องแล็บ' });
    expect(events().at(-1)).toMatchObject({ eventType: 'location', fromValue: 'คลัง A', toValue: 'ห้องแล็บ' });
  });

  it('checks the whole row: an earlier sale date set against a later purchase date', async () => {
    const item = await onePiece('stock');
    await updateItem('stock', item.id, { status: 'sold', statusDate: '2026-09-05' });
    const before = snapshot();
    await expect(updateItem('stock', item.id, { purchaseDate: '2026-09-10' })).rejects.toThrow('ต้องไม่ก่อนวันที่ซื้อ');
    expect(snapshot()).toBe(before);
  });

  it('moves to another group of the same register, with a timeline line', async () => {
    const item = await onePiece();
    const other = await createGroup('asset', { name: 'เครื่องชั่ง', model: 'PX225' });
    await updateItem('asset', item.id, { groupId: other.id });
    expect(items()[0].groupId).toBe(other.id);
    expect(events().at(-1)).toMatchObject({ eventType: 'group', fromValue: 'เครื่องชั่ง Ohaus PX224', toValue: 'เครื่องชั่ง PX225' });
  });

  it("will not move into the other register's group", async () => {
    const item = await onePiece();
    const stockGroup = await createGroup('stock', { name: 'x' });
    const before = snapshot();
    await expect(updateItem('asset', item.id, { groupId: stockGroup.id })).rejects.toThrow(InventoryValidationError);
    expect(snapshot()).toBe(before);
  });

  it('an item of the other register is not found', async () => {
    const item = await onePiece('stock');
    await expect(updateItem('asset', item.id, { price: 1 })).rejects.toThrow(InventoryNotFoundError);
    await expect(updateItem('asset', 'nope', { price: 1 })).rejects.toThrow(InventoryNotFoundError);
  });

  it('switching from a picked supplier to a typed one drops the link', async () => {
    const item = await onePiece('asset', { supplierId: 'sup-1' });
    await updateItem('asset', item.id, { supplierId: null, supplierName: 'ร้านข้างบ้าน' });
    expect(items()[0]).toMatchObject({ supplierId: null, supplierName: 'ร้านข้างบ้าน' });
  });
});

describe('deleteItem', () => {
  it('removes the piece and its timeline', async () => {
    const { items: [a, b] } = await newGroupWith('asset', 2);
    await deleteItem('asset', a.id);
    expect(items().map((r) => r.id)).toEqual([b.id]);
    expect(events().map((e) => e.itemId)).toEqual([b.id]);
  });

  it("not found for the other register's piece", async () => {
    const { items: [a] } = await newGroupWith('stock', 1);
    await expect(deleteItem('asset', a.id)).rejects.toThrow(InventoryNotFoundError);
    expect(items()).toHaveLength(1);
  });
});

describe('groups', () => {
  it('update renames; another register cannot', async () => {
    const g = await createGroup('asset', { name: 'เก่า' });
    await updateGroup('asset', g.id, { name: 'ใหม่', category: 'เครื่องมือ' });
    expect(groups()[0]).toMatchObject({ name: 'ใหม่', category: 'เครื่องมือ' });
    await expect(updateGroup('stock', g.id, { name: 'x' })).rejects.toThrow(InventoryNotFoundError);
  });

  it('a group with pieces cannot be deleted; an empty one can', async () => {
    const { group } = await newGroupWith('asset', 2);
    const err = await deleteGroup('asset', group.id).catch((e) => e);
    expect(err).toBeInstanceOf(GroupNotEmptyError);
    expect((err as GroupNotEmptyError).itemCount).toBe(2);
    expect(groups()).toHaveLength(1);

    const empty = await createGroup('asset', { name: 'ว่าง' });
    await deleteGroup('asset', empty.id);
    expect(groups().map((g) => g.id)).toEqual([group.id]);
  });

  it('merge moves every piece, notes it on each, and deletes the source', async () => {
    const a = await newGroupWith('asset', 2);
    const b = await createGroup('asset', { name: 'เครื่องชั่ง', brand: 'Ohaus', model: 'PX-224' });
    const result = await mergeGroups('asset', a.group.id, b.id);
    expect(result.moved).toBe(2);
    expect(groups().map((g) => g.id)).toEqual([b.id]);
    expect(items().every((r) => r.groupId === b.id)).toBe(true);
    expect(events().filter((e) => e.eventType === 'group')).toHaveLength(2);
  });

  it('merge refuses itself, and a group of the other register, writing nothing', async () => {
    const a = await newGroupWith('asset', 1);
    const s = await createGroup('stock', { name: 'x' });
    const before = snapshot();
    await expect(mergeGroups('asset', a.group.id, a.group.id)).rejects.toThrow('รวมรายการเข้ากับตัวเองไม่ได้');
    await expect(mergeGroups('asset', a.group.id, s.id)).rejects.toThrow(InventoryValidationError);
    expect(snapshot()).toBe(before);
  });
});

describe('bulkUpdateItems', () => {
  it('gives every piece the status, each with a timeline line', async () => {
    const { items: added } = await newGroupWith('stock', 3);
    await bulkUpdateItems('stock', { ids: added.map((i) => i.id), status: 'sold', statusParty: 'บ. เอ', statusDate: '2026-09-20' });
    expect(items().every((r) => r.status === 'sold' && r.statusParty === 'บ. เอ' && r.statusDate === '2026-09-20')).toBe(true);
    expect(events().filter((e) => e.eventType === 'status')).toHaveLength(3);
  });

  it('one piece that cannot take it refuses the lot, naming it', async () => {
    const { items: [a] } = await newGroupWith('stock', 1, { purchaseDate: '2026-09-01' });
    const { items: [b] } = await newGroupWith('stock', 1, { purchaseDate: '2026-09-25' });
    const before = snapshot();
    await expect(bulkUpdateItems('stock', { ids: [a.id, b.id], status: 'sold', statusDate: '2026-09-20' })).rejects.toThrow(
      'ST-0002: วันที่ขายต้องไม่ก่อนวันที่ซื้อ'
    );
    expect(snapshot()).toBe(before);
  });

  it('a new place only: lines only for the pieces that actually moved', async () => {
    const { items: [a] } = await newGroupWith('asset', 1, { location: 'คลัง A' });
    const { items: [b] } = await newGroupWith('asset', 1, { location: 'คลัง B' });
    await bulkUpdateItems('asset', { ids: [a.id, b.id], location: 'คลัง B' });
    expect(items().every((r) => r.location === 'คลัง B' && r.status === 'in_use')).toBe(true);
    expect(events().filter((e) => e.eventType === 'location').map((e) => e.itemId)).toEqual([a.id]);
  });

  it('refuses: nothing chosen, nothing to change, too many, a missing or foreign piece', async () => {
    const { items: [a] } = await newGroupWith('asset', 1);
    const { items: [s] } = await newGroupWith('stock', 1);
    await expect(bulkUpdateItems('asset', { ids: [], status: 'in_use' })).rejects.toThrow('กรุณาเลือกอย่างน้อย 1 ชิ้น');
    await expect(bulkUpdateItems('asset', { ids: [a.id] })).rejects.toThrow('ยังไม่ได้เลือกว่าจะเปลี่ยนอะไร');
    await expect(
      bulkUpdateItems('asset', { ids: Array.from({ length: 501 }, (_, i) => `id-${i}`), status: 'in_use' })
    ).rejects.toThrow('ไม่เกิน 500');
    await expect(bulkUpdateItems('asset', { ids: [a.id, s.id], status: 'in_storage' })).rejects.toThrow('โหลดหน้าใหม่');
    expect(items().find((r) => r.id === a.id)!.status).toBe('in_use');
  });
});

describe('reads', () => {
  it('list and get see only their own register', async () => {
    const { items: [a] } = await newGroupWith('asset', 1);
    await newGroupWith('stock', 2);
    const assets = await listInventory('asset');
    expect(assets.items.map((i) => i.code)).toEqual(['AS-0001']);
    expect(assets.groups).toHaveLength(1);
    expect(await getItem('stock', a.id)).toBeNull();
    expect((await getItem('asset', a.id))!.group!.name).toBe('เครื่องชั่ง');
  });

  it('newest pieces first, prices as numbers', async () => {
    await newGroupWith('asset', 2, { price: '1500.50' });
    const { items: listed } = await listInventory('asset');
    expect(listed.map((i) => i.code)).toEqual(['AS-0002', 'AS-0001']);
    expect(listed[0].price).toBe(1500.5);
  });
});
