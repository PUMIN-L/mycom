// @vitest-environment node
/**
 * /api/admin/inventory/[kind]/** — the asset register and stock. Every route
 * is admin-only; the register in the URL must be "asset" or "stock"; the
 * store's own errors become 400 / 404 / 409 with their Thai message.
 * Spec: openspec/changes/add-inventory-tracking.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/app/lib/db', () => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock('@/app/lib/inventoryStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/lib/inventoryStore')>();
  return {
    ...actual,
    listInventory: vi.fn(),
    getItem: vi.fn(),
    createGroup: vi.fn(),
    updateGroup: vi.fn(),
    deleteGroup: vi.fn(),
    mergeGroups: vi.fn(),
    addItems: vi.fn(),
    updateItem: vi.fn(),
    deleteItem: vi.fn(),
    bulkUpdateItems: vi.fn(),
  };
});
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
  InventoryValidationError,
  InventoryNotFoundError,
  GroupNotEmptyError,
} from '@/app/lib/inventoryStore';

vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }));
import { getSession } from '@/app/lib/session';

import { GET as listGET } from '@/app/api/admin/inventory/[kind]/route';
import { POST as groupsPOST } from '@/app/api/admin/inventory/[kind]/groups/route';
import { PATCH as groupPATCH, DELETE as groupDELETE } from '@/app/api/admin/inventory/[kind]/groups/[id]/route';
import { POST as mergePOST } from '@/app/api/admin/inventory/[kind]/groups/[id]/merge/route';
import { POST as itemsPOST } from '@/app/api/admin/inventory/[kind]/items/route';
import { POST as bulkPOST } from '@/app/api/admin/inventory/[kind]/items/bulk/route';
import { GET as itemGET, PATCH as itemPATCH, DELETE as itemDELETE } from '@/app/api/admin/inventory/[kind]/items/[id]/route';

const BASE = 'http://localhost:3000/api/admin/inventory';
const req = (url: string, method = 'GET', body?: unknown, origin = 'http://localhost:3000') =>
  new NextRequest(url, {
    method,
    headers: { origin, host: 'localhost:3000' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const ctx = (kind: string, id = 'x') => ({ params: Promise.resolve({ kind, id }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(null);
});
const login = () => vi.mocked(getSession).mockResolvedValue({ userId: '1', username: 'admin', expiresAt: new Date() } as never);

describe('auth', () => {
  it('every route answers 401 to a visitor and touches nothing', async () => {
    const responses = await Promise.all([
      listGET(req(`${BASE}/asset`), ctx('asset')),
      groupsPOST(req(`${BASE}/asset/groups`, 'POST', { name: 'x' }), ctx('asset')),
      groupPATCH(req(`${BASE}/asset/groups/g`, 'PATCH', { name: 'x' }), ctx('asset', 'g')),
      groupDELETE(req(`${BASE}/asset/groups/g`, 'DELETE'), ctx('asset', 'g')),
      mergePOST(req(`${BASE}/asset/groups/g/merge`, 'POST', { intoId: 'h' }), ctx('asset', 'g')),
      itemsPOST(req(`${BASE}/asset/items`, 'POST', { quantity: 1 }), ctx('asset')),
      bulkPOST(req(`${BASE}/asset/items/bulk`, 'POST', { ids: ['a'] }), ctx('asset')),
      itemGET(req(`${BASE}/asset/items/i`), ctx('asset', 'i')),
      itemPATCH(req(`${BASE}/asset/items/i`, 'PATCH', { price: 1 }), ctx('asset', 'i')),
      itemDELETE(req(`${BASE}/asset/items/i`, 'DELETE'), ctx('asset', 'i')),
    ]);
    expect(responses.map((r) => r.status)).toEqual(Array(10).fill(401));
    for (const fn of [listInventory, getItem, createGroup, updateGroup, deleteGroup, mergeGroups, addItems, updateItem, deleteItem, bulkUpdateItems]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it('a write from another site is refused before anything runs', async () => {
    login();
    const res = await itemsPOST(req(`${BASE}/asset/items`, 'POST', { quantity: 1 }, 'https://evil.example'), ctx('asset'));
    expect(res.status).toBe(403);
    expect(addItems).not.toHaveBeenCalled();
  });
});

describe('the register in the URL', () => {
  it('anything but asset / stock is a 404', async () => {
    login();
    const res = await listGET(req(`${BASE}/assets`), ctx('assets'));
    expect(res.status).toBe(404);
    expect(listInventory).not.toHaveBeenCalled();
  });

  it('is passed through to the store', async () => {
    login();
    vi.mocked(listInventory).mockResolvedValue({ groups: [], items: [] });
    const res = await listGET(req(`${BASE}/stock`), ctx('stock'));
    expect(res.status).toBe(200);
    expect(listInventory).toHaveBeenCalledWith('stock');
  });
});

describe('the store’s errors', () => {
  it('validation → 400 with its message', async () => {
    login();
    vi.mocked(addItems).mockRejectedValue(new InventoryValidationError('จำนวนต้องเป็น 1–100 ชิ้น'));
    const res = await itemsPOST(req(`${BASE}/asset/items`, 'POST', { quantity: 0 }), ctx('asset'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('จำนวนต้องเป็น 1–100 ชิ้น');
  });

  it('not found → 404', async () => {
    login();
    vi.mocked(updateItem).mockRejectedValue(new InventoryNotFoundError());
    const res = await itemPATCH(req(`${BASE}/asset/items/i`, 'PATCH', { price: 1 }), ctx('asset', 'i'));
    expect(res.status).toBe(404);
  });

  it('a group that still holds pieces → 409', async () => {
    login();
    vi.mocked(deleteGroup).mockRejectedValue(new GroupNotEmptyError(3));
    const res = await groupDELETE(req(`${BASE}/asset/groups/g`, 'DELETE'), ctx('asset', 'g'));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain('3 ชิ้น');
  });

  it('anything else is a 500 with the route’s own message', async () => {
    login();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(bulkUpdateItems).mockRejectedValue(new Error('db down'));
    const res = await bulkPOST(req(`${BASE}/asset/items/bulk`, 'POST', { ids: ['a'], status: 'in_use' }), ctx('asset'));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('เปลี่ยนหลายชิ้นไม่สำเร็จ');
  });
});

describe('each route calls the store with the register, the id and the body', () => {
  beforeEach(login);

  it('groups: create (201), update, delete, merge', async () => {
    vi.mocked(createGroup).mockResolvedValue({ id: 'g' } as never);
    expect((await groupsPOST(req(`${BASE}/asset/groups`, 'POST', { name: 'n' }), ctx('asset'))).status).toBe(201);
    expect(createGroup).toHaveBeenCalledWith('asset', { name: 'n' });

    vi.mocked(updateGroup).mockResolvedValue({ id: 'g' } as never);
    await groupPATCH(req(`${BASE}/stock/groups/g`, 'PATCH', { name: 'm' }), ctx('stock', 'g'));
    expect(updateGroup).toHaveBeenCalledWith('stock', 'g', { name: 'm' });

    await groupDELETE(req(`${BASE}/stock/groups/g`, 'DELETE'), ctx('stock', 'g'));
    expect(deleteGroup).toHaveBeenCalledWith('stock', 'g');

    vi.mocked(mergeGroups).mockResolvedValue({ moved: 2, group: {} } as never);
    await mergePOST(req(`${BASE}/asset/groups/g/merge`, 'POST', { intoId: 'h' }), ctx('asset', 'g'));
    expect(mergeGroups).toHaveBeenCalledWith('asset', 'g', 'h');
  });

  it('items: add (201), get, update, delete, bulk', async () => {
    vi.mocked(addItems).mockResolvedValue({ group: {}, items: [] } as never);
    const added = await itemsPOST(req(`${BASE}/stock/items`, 'POST', { quantity: 2 }), ctx('stock'));
    expect(added.status).toBe(201);
    expect(addItems).toHaveBeenCalledWith('stock', { quantity: 2 });

    vi.mocked(getItem).mockResolvedValue(null);
    expect((await itemGET(req(`${BASE}/stock/items/i`), ctx('stock', 'i'))).status).toBe(404);
    vi.mocked(getItem).mockResolvedValue({ item: { id: 'i' }, group: null, events: [] } as never);
    expect((await itemGET(req(`${BASE}/stock/items/i`), ctx('stock', 'i'))).status).toBe(200);
    expect(getItem).toHaveBeenLastCalledWith('stock', 'i');

    vi.mocked(updateItem).mockResolvedValue({ id: 'i' } as never);
    await itemPATCH(req(`${BASE}/stock/items/i`, 'PATCH', { status: 'sold' }), ctx('stock', 'i'));
    expect(updateItem).toHaveBeenCalledWith('stock', 'i', { status: 'sold' });

    await itemDELETE(req(`${BASE}/stock/items/i`, 'DELETE'), ctx('stock', 'i'));
    expect(deleteItem).toHaveBeenCalledWith('stock', 'i');

    vi.mocked(bulkUpdateItems).mockResolvedValue({ updated: 2 });
    await bulkPOST(req(`${BASE}/stock/items/bulk`, 'POST', { ids: ['a', 'b'], location: 'คลัง' }), ctx('stock'));
    expect(bulkUpdateItems).toHaveBeenCalledWith('stock', { ids: ['a', 'b'], location: 'คลัง' });
  });

  it('a body that is not a JSON object is a 400', async () => {
    const res = await itemsPOST(req(`${BASE}/asset/items`, 'POST', [1, 2]), ctx('asset'));
    expect(res.status).toBe(400);
    expect(addItems).not.toHaveBeenCalled();
  });
});
