// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/app/lib/salesDashboardStore', () => ({
  listSalesRecords: vi.fn(),
  addSalesRecord: vi.fn(),
  createSaleWithLineItems: vi.fn(),
  getSalesRecord: vi.fn(),
  updateSalesRecord: vi.fn(),
  deleteSalesRecord: vi.fn(),
}));
import {
  listSalesRecords,
  createSaleWithLineItems,
  getSalesRecord,
  updateSalesRecord,
  deleteSalesRecord,
} from '@/app/lib/salesDashboardStore';

// The [id] route touches equipment sync/cleanup; stubbed so no DB work leaks
// out of these route tests.
vi.mock('@/app/lib/crmStore', () => ({
  syncEquipmentRowsForSalesRecord: vi.fn(),
  cleanupEquipmentsForSalesRecord: vi.fn(),
}));
import {
  syncEquipmentRowsForSalesRecord,
  cleanupEquipmentsForSalesRecord,
} from '@/app/lib/crmStore';

// POST re-reads the machines it just wrote through `query` to build its
// `createdEquipments` response field.
vi.mock('@/app/lib/db', () => ({ query: vi.fn(), withTransaction: vi.fn() }));
import { query } from '@/app/lib/db';

vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }));
import { getSession } from '@/app/lib/session';

const admin = { userId: '1', username: 'admin', expiresAt: new Date() } as any;

/** Every rejection this API emits must be readable by a Thai-speaking admin. */
const THAI = /[฀-๿]/;

import { GET as listSales, POST as createSale } from '@/app/api/admin/sales/route';
import {
  GET as getSale,
  PUT as updateSale,
  DELETE as deleteSale,
} from '@/app/api/admin/sales/[id]/route';

const postSale = (body: unknown) =>
  createSale(
    new NextRequest('http://localhost:3000/api/admin/sales', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  );

/** Rejects with 400 + a Thai message, and writes nothing. */
async function expectRejected(body: unknown) {
  const res = await postSale(body);
  expect(res.status).toBe(400);
  const json = await res.json();
  expect(json.error).toMatch(THAI);
  expect(createSaleWithLineItems).not.toHaveBeenCalled();
  return json.error as string;
}

describe('Admin Sales API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSession).mockResolvedValue(null);
    vi.mocked(query).mockResolvedValue([[]] as any);
    vi.mocked(createSaleWithLineItems).mockResolvedValue({ id: 'rec-1' } as any);
  });

  describe('GET /api/admin/sales', () => {
    it('returns 401 if unauthenticated', async () => {
      const res = await listSales(new NextRequest('http://localhost:3000/api/admin/sales'));
      expect(res.status).toBe(401);
    });

    it('returns list of sales records for authenticated user', async () => {
      vi.mocked(getSession).mockResolvedValue(admin);
      const records = [{ id: '1', totalAmount: 5000 }];
      vi.mocked(listSalesRecords).mockResolvedValue(records as any);

      const res = await listSales(new NextRequest('http://localhost:3000/api/admin/sales'));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(records);
    });
  });

  describe('POST /api/admin/sales — auth', () => {
    it('returns 401 if unauthenticated', async () => {
      const res = await postSale({});
      expect(res.status).toBe(401);
      expect(createSaleWithLineItems).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/admin/sales — validation (task 7.2)', () => {
    beforeEach(() => {
      vi.mocked(getSession).mockResolvedValue(admin);
    });

    it('rejects a missing or malformed saleDate', async () => {
      await expectRejected({ productName: 'Scale' });
      await expectRejected({ saleDate: '22-08-2026', productName: 'Scale' });
    });

    it('rejects a calendar-impossible saleDate that still matches the pattern', async () => {
      await expectRejected({ saleDate: '2026-13-45', productName: 'Scale' });
    });

    it('rejects a delivery reference with no invoice reference', async () => {
      await expectRejected({
        saleDate: '2026-08-22',
        productName: 'Scale',
        deliveryRef: 'DN-1',
      });
    });

    it('rejects an empty items[] — a sale needs at least one line', async () => {
      const error = await expectRejected({ saleDate: '2026-08-22', items: [] });
      expect(error).toContain('อย่างน้อย 1 รายการ');
    });

    it('rejects a non-array items[]', async () => {
      await expectRejected({ saleDate: '2026-08-22', items: 'Scale A' });
    });

    it('rejects qty below 1, naming the offending line', async () => {
      const error = await expectRejected({
        saleDate: '2026-08-22',
        items: [
          { productName: 'Scale A', qty: 1, unitPrice: 100 },
          { productName: 'Scale B', qty: 0, unitPrice: 100 },
        ],
      });
      expect(error).toContain('รายการที่ 2');
      expect(error).toContain('qty');
    });

    it('rejects a non-numeric qty instead of silently treating it as 1', async () => {
      await expectRejected({
        saleDate: '2026-08-22',
        items: [{ productName: 'Scale A', qty: 'สอง', unitPrice: 100 }],
      });
    });

    it('rejects a negative unitPrice', async () => {
      const error = await expectRejected({
        saleDate: '2026-08-22',
        items: [{ productName: 'Scale A', qty: 1, unitPrice: -1 }],
      });
      expect(error).toContain('ราคาต่อหน่วย');
    });

    it('rejects a negative costAmount', async () => {
      const error = await expectRejected({
        saleDate: '2026-08-22',
        items: [{ productName: 'Scale A', qty: 1, unitPrice: 100, costAmount: -5 }],
      });
      expect(error).toContain('ต้นทุนสินค้า');
    });

    it('accepts an omitted unitPrice/costAmount (the store defaults them to 0)', async () => {
      const res = await postSale({
        saleDate: '2026-08-22',
        items: [{ productName: 'Scale A', qty: 1 }],
      });
      expect(res.status).toBe(201);
    });

    // Report 7 REVERSED the rule this used to pin ("ทุกเครื่องต้องมี serial
    // ก่อนบันทึก"). The owner hit the real bill the old rule assumed away — the
    // machine is sold and has to be recorded before the serial is in hand — so a
    // blank serial now SAVES and the machine is chased afterwards by the
    // «ข้อมูลไม่ครบ» alert category. The route must not resurrect the blocker.
    it('saves a machine whose serial is not in hand yet (report 7)', async () => {
      const res = await postSale({
        saleDate: '2026-08-22',
        items: [{ productName: 'Scale A', qty: 2, unitPrice: 100 }],
        equipments: [{ serialNumber: 'SN-1' }, { serialNumber: '   ' }],
      });
      expect(res.status).toBe(201);
      // BOTH machines are written — the blank one is a physical unit the alert
      // feed has to be able to chase, so dropping it would lose it silently.
      expect(vi.mocked(createSaleWithLineItems).mock.calls[0][0].equipments).toEqual([
        { serialNumber: 'SN-1' },
        { serialNumber: '   ' },
      ]);
    });

    it('saves a machine with the serialNumber key left out entirely', async () => {
      const res = await postSale({
        saleDate: '2026-08-22',
        items: [{ productName: 'Scale A', qty: 1, unitPrice: 100 }],
        equipments: [{ productId: 'p-1' }],
      });
      expect(res.status).toBe(201);
    });

    // Shape is still enforced: a non-string serial is a malformed request, not
    // a machine whose serial is unknown — it would land in the column as
    // "[object Object]".
    it('still rejects a serialNumber that is not a string at all', async () => {
      const error = await expectRejected({
        saleDate: '2026-08-22',
        items: [{ productName: 'Scale A', qty: 2, unitPrice: 100 }],
        equipments: [{ serialNumber: 'SN-1' }, { serialNumber: { oops: true } }],
      });
      expect(error).toContain('เครื่องที่ 2');
      expect(error).toContain('Serial');
    });

    it('rejects a non-array equipments[]', async () => {
      await expectRejected({
        saleDate: '2026-08-22',
        items: [{ productName: 'Scale A', qty: 1, unitPrice: 100 }],
        equipments: { serialNumber: 'SN-1' },
      });
    });

    it('rejects more than 50 machines on one bill rather than truncating silently', async () => {
      const error = await expectRejected({
        saleDate: '2026-08-22',
        items: [{ productName: 'Scale A', qty: 51, unitPrice: 100 }],
        equipments: Array.from({ length: 51 }, (_, i) => ({ serialNumber: `SN-${i}` })),
      });
      expect(error).toContain('50');
    });

    it('rejects a legacy payload with no product at all', async () => {
      const error = await expectRejected({ saleDate: '2026-08-22' });
      expect(error).toContain('สินค้า');
    });

    it('rejects a legacy equipment sale whose serialNumbers is not an array', async () => {
      await expectRejected({
        saleDate: '2026-08-22',
        saleType: 'equipment',
        productName: 'Scale A',
        qty: 1,
        serialNumbers: 'SN-1',
      });
    });

    // Report 7 — the legacy flat form is the plain "เพิ่มรายการขาย" form, and it
    // lost the per-machine "ขาดชิ้นที่ N" blocker for the same reason as above.
    // Only the SHAPE survives (see the serialNumbers-is-not-an-array test).
    it('saves a legacy equipment sale with a serial left blank (report 7)', async () => {
      const res = await postSale({
        saleDate: '2026-08-22',
        saleType: 'equipment',
        productName: 'Scale A',
        qty: 2,
        serialNumbers: ['SN-1', '  '],
      });
      expect(res.status).toBe(201);
      expect(vi.mocked(createSaleWithLineItems).mock.calls[0][0].equipments).toEqual([
        { serialNumber: 'SN-1' },
        { serialNumber: '' },
      ]);
    });

    // The list is PADDED to one row per machine sold. "3 machines, no serial
    // typed" has to become THREE rows, not zero — each is a unit the
    // «ข้อมูลไม่ครบ» alert must be able to chase.
    it('pads a short serial list to one machine row per qty', async () => {
      const res = await postSale({
        saleDate: '2026-08-22',
        saleType: 'equipment',
        productName: 'Scale A',
        qty: 3,
        serialNumbers: [],
      });
      expect(res.status).toBe(201);
      expect(vi.mocked(createSaleWithLineItems).mock.calls[0][0].equipments).toEqual([
        { serialNumber: '' },
        { serialNumber: '' },
        { serialNumber: '' },
      ]);
    });
  });

  describe('POST /api/admin/sales — multi-line save (task 7.1)', () => {
    beforeEach(() => {
      vi.mocked(getSession).mockResolvedValue(admin);
    });

    it('saves several product lines and their machines in one call', async () => {
      const created = { id: 'rec-9', totalAmount: 4500, saleDate: '2026-08-22' };
      vi.mocked(createSaleWithLineItems).mockResolvedValue(created as any);
      const machines = [
        { id: 'eq-1', serialNumber: 'SN-1' },
        { id: 'eq-2', serialNumber: 'SN-2' },
        { id: 'eq-3', serialNumber: 'SN-3' },
      ];
      vi.mocked(query).mockResolvedValue([machines] as any);

      const items = [
        { productId: 'p-1', productName: 'Scale A', categoryId: 3, qty: 2, unitPrice: 1000, totalAmount: 2000, costAmount: 1200, quotationItemId: 'qi-1', sortOrder: 0 },
        { productId: 'p-2', productName: 'Scale B', categoryId: 4, qty: 1, unitPrice: 2000, totalAmount: 2000, costAmount: 900, quotationItemId: 'qi-2', sortOrder: 1 },
        { productId: '', productName: 'ค่าติดตั้ง', categoryId: null, qty: 1, unitPrice: 500, totalAmount: 500, costAmount: 0, quotationItemId: null, sortOrder: 2 },
      ];
      const equipments = [
        { serialNumber: 'SN-1', productId: 'p-1', warrantyStartDate: '2026-08-22', warrantyEndDate: '2027-08-22' },
        { serialNumber: 'SN-2', productId: 'p-1', warrantyStartDate: '2026-08-22', warrantyEndDate: '2027-08-22' },
        { serialNumber: 'SN-3', productId: 'p-2', warrantyStartDate: '2026-09-01', warrantyEndDate: '2028-09-01' },
      ];

      const res = await postSale({
        saleDate: '2026-08-22',
        saleType: 'equipment',
        customerId: 'cus-1',
        quotationId: 'quo-1',
        quotationRef: 'QT-2026-001',
        items,
        equipments,
      });

      expect(res.status).toBe(201);
      expect(createSaleWithLineItems).toHaveBeenCalledTimes(1);
      const arg = vi.mocked(createSaleWithLineItems).mock.calls[0][0];
      expect(arg.items).toEqual(items);
      expect(arg.equipments).toEqual(equipments);
      // Task 7.7 — both the hard link and the printed reference ride along.
      expect(arg.sale).toMatchObject({ quotationId: 'quo-1', quotationRef: 'QT-2026-001' });

      const body = await res.json();
      expect(body.record).toEqual(created);
      expect(body.createdEquipments).toEqual(machines);
      // Atomic write → no 207 partial-success shape any more (task 3.6).
      expect(body).not.toHaveProperty('warning');
    });

    it('accepts a hand-typed quotationRef with no quotationId (task 7.7)', async () => {
      await postSale({
        saleDate: '2026-08-22',
        quotationRef: 'พิมพ์เอง-001',
        items: [{ productName: 'Scale A', qty: 1, unitPrice: 100 }],
      });
      const arg = vi.mocked(createSaleWithLineItems).mock.calls[0][0];
      expect(arg.sale).toMatchObject({ quotationRef: 'พิมพ์เอง-001' });
      expect(arg.sale.quotationId).toBeUndefined();
    });

    it('accepts items[] with no equipments[] (a service sale has no machines)', async () => {
      const res = await postSale({
        saleDate: '2026-08-22',
        saleType: 'service',
        items: [{ productName: 'ค่าสอบเทียบ', qty: 1, unitPrice: 3000 }],
      });
      expect(res.status).toBe(201);
      expect(vi.mocked(createSaleWithLineItems).mock.calls[0][0].equipments).toEqual([]);
    });

    // D12: duplicate serials are legal (a machine legitimately comes back on a
    // new bill). The route must warn-not-block — the duplicate check lives in
    // GET /api/admin/equipments/serial-check and only feeds a confirm dialog.
    it('saves a serial that already exists on another machine instead of rejecting it', async () => {
      const res = await postSale({
        saleDate: '2026-08-22',
        saleType: 'equipment',
        items: [{ productName: 'Scale A', qty: 2, unitPrice: 100 }],
        equipments: [{ serialNumber: 'SN-ALREADY-USED' }, { serialNumber: 'sn-already-used' }],
      });
      expect(res.status).toBe(201);
      expect(vi.mocked(createSaleWithLineItems).mock.calls[0][0].equipments).toEqual([
        { serialNumber: 'SN-ALREADY-USED' },
        { serialNumber: 'sn-already-used' },
      ]);
    });
  });

  describe('POST /api/admin/sales — legacy single-product payload (task 7.1)', () => {
    beforeEach(() => {
      vi.mocked(getSession).mockResolvedValue(admin);
    });

    it('creates sale record on valid payload', async () => {
      const created = { id: 'rec-1', totalAmount: 1000, saleDate: '2026-08-22' };
      vi.mocked(createSaleWithLineItems).mockResolvedValue(created as any);

      const res = await postSale({
        saleDate: '2026-08-22',
        productName: 'Scale A',
        qty: 2,
        unitPrice: 500,
      });
      const body = await res.json();
      expect(res.status).toBe(201);
      expect(body.record).toEqual(created);
      expect(body.createdEquipments).toEqual([]);
    });

    // SalesRecordEditModal still POSTs exactly this flat shape. It must keep
    // working untouched, and must be normalized into ONE line item — a legacy
    // sale with no `sales_record_items` row would vanish from the product and
    // category reports, which now read line items only.
    it('normalizes the modal payload into one line item and its machines', async () => {
      const res = await postSale({
        saleDate: '2026-08-22',
        saleType: 'equipment',
        productId: 'p-1',
        productName: 'Scale A',
        categoryId: 3,
        qty: 2,
        unitPrice: 500,
        totalAmount: 1000,
        costAmount: 600,
        poRef: 'PO-1',
        customerId: 'cus-1',
        warrantyStartDate: '2026-08-22',
        warrantyEndDate: '2027-08-22',
        serialNumbers: ['SN-1', 'SN-2'],
      });

      expect(res.status).toBe(201);
      const arg = vi.mocked(createSaleWithLineItems).mock.calls[0][0];
      expect(arg.items).toEqual([
        {
          productId: 'p-1',
          productName: 'Scale A',
          categoryId: 3,
          qty: 2,
          unitPrice: 500,
          totalAmount: 1000,
          costAmount: 600,
          quotationItemId: null,
          sortOrder: 0,
        },
      ]);
      expect(arg.equipments).toEqual([
        { serialNumber: 'SN-1' },
        { serialNumber: 'SN-2' },
      ]);
      // The flat sale fields are forwarded to the store unchanged.
      expect(arg.sale).toMatchObject({ poRef: 'PO-1', customerId: 'cus-1', qty: 2 });
    });

    it('creates no machines for a legacy service sale', async () => {
      const res = await postSale({
        saleDate: '2026-08-22',
        saleType: 'service',
        productName: 'ค่าสอบเทียบ',
        qty: 1,
        unitPrice: 3000,
        serialNumbers: ['SN-STALE'],
      });
      expect(res.status).toBe(201);
      expect(vi.mocked(createSaleWithLineItems).mock.calls[0][0].equipments).toEqual([]);
    });

    it('ignores stale serials sent beyond qty, as the old route did', async () => {
      await postSale({
        saleDate: '2026-08-22',
        saleType: 'equipment',
        productName: 'Scale A',
        qty: 1,
        unitPrice: 500,
        serialNumbers: ['SN-1', 'SN-STALE'],
      });
      expect(vi.mocked(createSaleWithLineItems).mock.calls[0][0].equipments).toEqual([
        { serialNumber: 'SN-1' },
      ]);
    });

    it('keeps working when only productId is given (no productName)', async () => {
      const res = await postSale({
        saleDate: '2026-08-22',
        productId: 'p-1',
        qty: 1,
        unitPrice: 500,
      });
      expect(res.status).toBe(201);
      expect(vi.mocked(createSaleWithLineItems).mock.calls[0][0].items[0]).toMatchObject({
        productId: 'p-1',
        productName: '',
      });
    });
  });

  describe('GET /api/admin/sales/[id]', () => {
    it('returns 404 when not found', async () => {
      vi.mocked(getSession).mockResolvedValue(admin);
      vi.mocked(getSalesRecord).mockResolvedValue(null);

      const res = await getSale(
        new NextRequest('http://localhost:3000/api/admin/sales/999'),
        { params: Promise.resolve({ id: '999' }) }
      );
      expect(res.status).toBe(404);
    });
  });

  describe('PUT /api/admin/sales/[id]', () => {
    it('validates invalid saleDate format if provided', async () => {
      vi.mocked(getSession).mockResolvedValue(admin);

      const res = await updateSale(
        new NextRequest('http://localhost:3000/api/admin/sales/1', {
          method: 'PUT',
          body: JSON.stringify({ saleDate: 'invalid-date' }),
        }),
        { params: Promise.resolve({ id: '1' }) }
      );
      expect(res.status).toBe(400);
    });

    it('updates sale record successfully', async () => {
      vi.mocked(getSession).mockResolvedValue(admin);
      const updated = { id: '1', qty: 5 };
      vi.mocked(updateSalesRecord).mockResolvedValue(updated as any);

      const res = await updateSale(
        new NextRequest('http://localhost:3000/api/admin/sales/1', {
          method: 'PUT',
          body: JSON.stringify({ qty: 5 }),
        }),
        { params: Promise.resolve({ id: '1' }) }
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(updated);
    });

    /**
     * The edit form is the ONE place a sale that already owns machines is
     * re-synced, so this is where the row ids have to survive the trip.
     */
    describe('equipment sync', () => {
      const putSale = (body: unknown, id = '1') =>
        updateSale(
          new NextRequest(`http://localhost:3000/api/admin/sales/${id}`, {
            method: 'PUT',
            body: JSON.stringify(body),
          }),
          { params: Promise.resolve({ id }) }
        );

      beforeEach(() => {
        vi.mocked(getSession).mockResolvedValue(admin);
        vi.mocked(updateSalesRecord).mockResolvedValue({
          id: '1',
          qty: 2,
          customerId: 'cus-1',
          productId: 'p-1',
        } as any);
        vi.mocked(getSalesRecord).mockResolvedValue({ id: '1' } as any);
      });

      it('forwards each machine’s row id alongside its serial', async () => {
        await putSale({
          saleType: 'equipment',
          qty: 2,
          serialNumbers: ['SN-1', 'SN-2'],
          equipments: [
            { id: 'eq-1', serialNumber: 'SN-1' },
            { id: 'eq-2', serialNumber: 'SN-2' },
          ],
        });

        expect(vi.mocked(syncEquipmentRowsForSalesRecord).mock.calls[0][1]).toEqual([
          { id: 'eq-1', serialNumber: 'SN-1' },
          { id: 'eq-2', serialNumber: 'SN-2' },
        ]);
      });

      it('cuts ids and serials as ONE list when qty shrinks (never two separate slices)', async () => {
        await putSale({
          saleType: 'equipment',
          qty: 1,
          serialNumbers: ['SN-1', 'SN-STALE'],
          equipments: [
            { id: 'eq-1', serialNumber: 'SN-1' },
            { id: 'eq-2', serialNumber: 'SN-STALE' },
          ],
        });

        // eq-1 keeps ITS serial. A pair split across two slices is exactly how
        // machine #1 would inherit machine #2's serial and history.
        expect(vi.mocked(syncEquipmentRowsForSalesRecord).mock.calls[0][1]).toEqual([
          { id: 'eq-1', serialNumber: 'SN-1' },
        ]);
      });

      it('still accepts a serial-only payload, with no id on any row', async () => {
        await putSale({ saleType: 'equipment', qty: 2, serialNumbers: ['SN-1', ''] });

        expect(vi.mocked(syncEquipmentRowsForSalesRecord).mock.calls[0][1]).toEqual([
          { serialNumber: 'SN-1' },
          { serialNumber: '' },
        ]);
      });

      it('drops a non-string id instead of forwarding it', async () => {
        await putSale({
          saleType: 'equipment',
          qty: 2,
          equipments: [{ id: { $ne: null }, serialNumber: 'SN-1' }, 'nonsense'],
        });

        expect(vi.mocked(syncEquipmentRowsForSalesRecord).mock.calls[0][1]).toEqual([
          { serialNumber: 'SN-1' },
          { serialNumber: '' },
        ]);
      });

      it('syncs nothing when the body carries neither machines nor serials', async () => {
        await putSale({ saleType: 'equipment', qty: 2 });
        expect(syncEquipmentRowsForSalesRecord).not.toHaveBeenCalled();
        expect(cleanupEquipmentsForSalesRecord).not.toHaveBeenCalled();
      });

      it('an EMPTY equipments[] does not outrank the serials and unlink every machine', async () => {
        // An equipment sale always has qty >= 1, so an empty machine list is
        // never an instruction to detach the bill's machines — taking it at
        // face value would unlink every row and orphan its service history.
        await putSale({
          saleType: 'equipment',
          qty: 2,
          equipments: [],
          serialNumbers: ['SN-1', 'SN-2'],
        });

        expect(vi.mocked(syncEquipmentRowsForSalesRecord).mock.calls[0][1]).toEqual([
          { serialNumber: 'SN-1' },
          { serialNumber: 'SN-2' },
        ]);
      });
    });
  });

  describe('DELETE /api/admin/sales/[id]', () => {
    it('deletes record successfully', async () => {
      vi.mocked(getSession).mockResolvedValue(admin);
      vi.mocked(deleteSalesRecord).mockResolvedValue(true);

      const res = await deleteSale(
        new NextRequest('http://localhost:3000/api/admin/sales/1', {
          method: 'DELETE',
        }),
        { params: Promise.resolve({ id: '1' }) }
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true });
    });
  });
});
