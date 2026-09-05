// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// A single transaction connection whose queries we script per test.
// withTransaction is mocked to invoke the callback with it directly (matching
// the pattern in quotationSave.test.ts), so the real transaction body runs.
const conn = { query: vi.fn() };
const topQuery = vi.fn();
vi.mock('@/app/lib/db', () => ({
  query: (...args: unknown[]) => topQuery(...args),
  withTransaction: vi.fn(async (fn: (c: typeof conn) => Promise<unknown>) => fn(conn)),
}));

import { withTransaction } from '@/app/lib/db';
import {
  syncEquipmentsForSalesRecord,
  syncEquipmentRowsForSalesRecord,
  findEquipmentsBySerial,
  cleanupEquipmentsForSalesRecord,
  getAlerts,
  completeScheduleWithLog,
  ScheduleNotPendingError,
  snoozeAlert,
  addEquipment,
  updateEquipment,
  addSchedule,
  listSchedules,
  updateSchedule,
  ScheduleCompletionRequiresLogError,
  declineWarrantyRenewal,
} from '@/app/lib/crmStore';

beforeEach(() => {
  vi.clearAllMocks();
  conn.query.mockReset();
  topQuery.mockReset();
});

/**
 * Route conn.query calls by SQL shape:
 *  - the initial "fetch existing equipment for this sale" SELECT resolves to
 *    `existingRows`;
 *  - every other query (UPDATE/INSERT) resolves to a generic success and is
 *    just recorded for assertions.
 */
function mockConnFor(existingRows: { id: string; serialNumber: string }[]) {
  conn.query.mockImplementation((sql: string) => {
    if (sql.includes('SELECT id, serialNumber FROM customer_equipments')) {
      return Promise.resolve([existingRows]);
    }
    return Promise.resolve([{ affectedRows: 1 }]);
  });
}

function callsMatching(pattern: string) {
  return conn.query.mock.calls.filter((c) => String(c[0]).includes(pattern));
}

const base = { customerId: 'cust-1', productId: 'prod-1' };

describe('syncEquipmentsForSalesRecord', () => {
  it('no-op: resubmitting the same serials only UPDATEs, never inserts/unlinks', async () => {
    mockConnFor([
      { id: 'eq-A', serialNumber: 'SN-A' },
      { id: 'eq-B', serialNumber: 'SN-B' },
    ]);

    await syncEquipmentsForSalesRecord('sale-1', ['SN-A', 'SN-B'], base);

    const updates = callsMatching('UPDATE customer_equipments SET');
    const inserts = callsMatching('INSERT INTO customer_equipments');
    const unlinks = callsMatching("SET salesRecordId = ''");
    expect(updates).toHaveLength(2);
    expect(inserts).toHaveLength(0);
    expect(unlinks).toHaveLength(0);
    // Each update targets the correct existing row id (identity, not position).
    expect(updates.some((c) => c[1].at(-1) === 'eq-A')).toBe(true);
    expect(updates.some((c) => c[1].at(-1) === 'eq-B')).toBe(true);
  });

  it('reorder: swapping submitted order keeps each serial attached to ITS OWN existing row', async () => {
    mockConnFor([
      { id: 'eq-A', serialNumber: 'SN-A' },
      { id: 'eq-B', serialNumber: 'SN-B' },
    ]);

    // Submitted in the OPPOSITE order from how they were created.
    await syncEquipmentsForSalesRecord('sale-1', ['SN-B', 'SN-A'], base);

    const updates = callsMatching('UPDATE customer_equipments SET');
    expect(updates).toHaveLength(2);
    // The row whose serial is SN-A must still be updated with serial "SN-A"
    // (params: customerId, productId, productName, serialNumber, ... , id) —
    // find the call targeting eq-A and check its serial param.
    const eqACall = updates.find((c) => c[1].at(-1) === 'eq-A')!;
    const eqBCall = updates.find((c) => c[1].at(-1) === 'eq-B')!;
    expect(eqACall[1][3]).toBe('SN-A'); // serialNumber is the 4th bound param
    expect(eqBCall[1][3]).toBe('SN-B');
  });

  it('grow: adding a new serial inserts exactly one new row, leaves the existing one alone', async () => {
    mockConnFor([{ id: 'eq-A', serialNumber: 'SN-A' }]);

    await syncEquipmentsForSalesRecord('sale-1', ['SN-A', 'SN-NEW'], base);

    const updates = callsMatching('UPDATE customer_equipments SET');
    const inserts = callsMatching('INSERT INTO customer_equipments');
    expect(updates).toHaveLength(1);
    expect(updates[0][1].at(-1)).toBe('eq-A');
    expect(inserts).toHaveLength(1);
    expect(inserts[0][0]).toContain('salesRecordId');
  });

  it('shrink: a removed serial is UNLINKED (salesRecordId cleared), never deleted', async () => {
    mockConnFor([
      { id: 'eq-A', serialNumber: 'SN-A' },
      { id: 'eq-B', serialNumber: 'SN-B' },
    ]);

    await syncEquipmentsForSalesRecord('sale-1', ['SN-A'], base);

    const deletes = callsMatching('DELETE FROM customer_equipments');
    const unlinks = callsMatching("UPDATE customer_equipments SET salesRecordId = ''");
    expect(deletes).toHaveLength(0); // NEVER delete — see fix-crm-data-integrity
    expect(unlinks).toHaveLength(1);
    expect(unlinks[0][1]).toEqual(['eq-B']);
    // eq-A (still submitted) is updated normally, not touched by the unlink path.
    const updates = callsMatching('UPDATE customer_equipments SET').filter(
      (c) => !String(c[0]).includes("salesRecordId = ''")
    );
    expect(updates).toHaveLength(1);
    expect(updates[0][1].at(-1)).toBe('eq-A');
  });

  it('does not mix up which unit owns which history when reordering AND shrinking together', async () => {
    // A (has history), B, C all exist; new submission drops B and reorders C before A.
    mockConnFor([
      { id: 'eq-A', serialNumber: 'SN-A' },
      { id: 'eq-B', serialNumber: 'SN-B' },
      { id: 'eq-C', serialNumber: 'SN-C' },
    ]);

    await syncEquipmentsForSalesRecord('sale-1', ['SN-C', 'SN-A'], base);

    const updates = callsMatching('UPDATE customer_equipments SET').filter(
      (c) => !String(c[0]).includes("salesRecordId = ''")
    );
    const unlinks = callsMatching("UPDATE customer_equipments SET salesRecordId = ''");
    expect(updates).toHaveLength(2);
    expect(updates.find((c) => c[1].at(-1) === 'eq-A')?.[1][3]).toBe('SN-A');
    expect(updates.find((c) => c[1].at(-1) === 'eq-C')?.[1][3]).toBe('SN-C');
    // Only B (not submitted) is unlinked — A's identity/history is untouched.
    expect(unlinks).toHaveLength(1);
    expect(unlinks[0][1]).toEqual(['eq-B']);
  });

  it('blank serials fall back to positional pairing so unrelated saves do not spawn duplicates', async () => {
    // Two existing rows that have never had a serial filled in.
    mockConnFor([
      { id: 'eq-1', serialNumber: '' },
      { id: 'eq-2', serialNumber: '' },
    ]);

    // Re-saving with blanks again (e.g. editing an unrelated field) must pair
    // positionally, not create 2 more blank rows.
    await syncEquipmentsForSalesRecord('sale-1', ['', ''], base);

    const inserts = callsMatching('INSERT INTO customer_equipments');
    const unlinks = callsMatching("UPDATE customer_equipments SET salesRecordId = ''");
    expect(inserts).toHaveLength(0);
    expect(unlinks).toHaveLength(0);
  });

  it('does nothing when salesRecordId is empty', async () => {
    await syncEquipmentsForSalesRecord('', ['SN-A'], base);
    expect(conn.query).not.toHaveBeenCalled();
  });

  it('caps the submitted list at 50 entries', async () => {
    mockConnFor([]);
    const many = Array.from({ length: 60 }, (_, i) => `SN-${i}`);
    await syncEquipmentsForSalesRecord('sale-1', many, base);
    const inserts = callsMatching('INSERT INTO customer_equipments');
    expect(inserts).toHaveLength(50);
  });
});

/**
 * Per-machine flavour (task 4.x / 9.8 / 9.9). Same invariants as the serial-list
 * flavour above — those tests still guard them — plus: each submitted row owns
 * its own model/warranty, and the positional fallback may only pair rows that
 * share a productId.
 *
 * The writer issues a SECOND read (`SELECT id, productId ...`) to learn which
 * model each existing row holds, but only when the leftovers span more than one
 * product group, so this helper answers both SELECTs from one fixture.
 */
type ExistingRow = { id: string; serialNumber: string; productId?: string };

function mockConnRowsFor(existingRows: ExistingRow[], target = conn) {
  target.query.mockImplementation((sql: string) => {
    if (sql.includes('SELECT id, serialNumber FROM customer_equipments')) {
      return Promise.resolve([
        existingRows.map((r) => ({ id: r.id, serialNumber: r.serialNumber })),
      ]);
    }
    if (sql.includes('SELECT id, productId FROM customer_equipments')) {
      return Promise.resolve([
        existingRows.map((r) => ({ id: r.id, productId: r.productId ?? '' })),
      ]);
    }
    return Promise.resolve([{ affectedRows: 1 }]);
  });
}

function updateCalls(target = conn) {
  return target.query.mock.calls.filter(
    (c) =>
      String(c[0]).includes('UPDATE customer_equipments SET') &&
      !String(c[0]).includes("salesRecordId = ''")
  );
}

// UPDATE bind order: customerId, productId, productName, serialNumber, ..., id
const P_PRODUCT_ID = 1;
const P_PRODUCT_NAME = 2;
const P_SERIAL = 3;
const P_WARRANTY_END = 8;

describe('syncEquipmentRowsForSalesRecord — mixed-model bills', () => {
  const shared = { customerId: 'cust-1', productId: 'P1', productName: 'รุ่น P1' };

  it('binds each service history to its OWN serial when a two-model bill is resubmitted out of order (9.8)', async () => {
    // P1 x2 + P2 x1, created in that order. eq-P1a is the unit carrying the
    // service history we must not hand to another machine.
    mockConnRowsFor([
      { id: 'eq-P1a', serialNumber: 'SN-1', productId: 'P1' },
      { id: 'eq-P1b', serialNumber: 'SN-2', productId: 'P1' },
      { id: 'eq-P2a', serialNumber: 'SN-9', productId: 'P2' },
    ]);

    // Submitted in a completely different order, and the P2 machine now comes
    // first — positional matching would drag SN-9 onto eq-P1a.
    await syncEquipmentRowsForSalesRecord(
      'sale-1',
      [
        { serialNumber: 'SN-9', productId: 'P2', productName: 'รุ่น P2', warrantyEndDate: '2027-06-30' },
        { serialNumber: 'SN-2', productId: 'P1', productName: 'รุ่น P1', warrantyEndDate: '2027-01-31' },
        { serialNumber: 'SN-1', productId: 'P1', productName: 'รุ่น P1', warrantyEndDate: '2027-01-31' },
      ],
      shared
    );

    const updates = updateCalls();
    expect(updates).toHaveLength(3);
    expect(callsMatching('INSERT INTO customer_equipments')).toHaveLength(0);
    expect(callsMatching("UPDATE customer_equipments SET salesRecordId = ''")).toHaveLength(0);

    const byId = (id: string) => updates.find((c) => c[1].at(-1) === id)![1];
    expect(byId('eq-P1a')[P_SERIAL]).toBe('SN-1');
    expect(byId('eq-P1b')[P_SERIAL]).toBe('SN-2');
    expect(byId('eq-P2a')[P_SERIAL]).toBe('SN-9');
    // ...and each row keeps its own model + warranty, never the sale-level P1
    // template or a neighbouring line's values.
    expect(byId('eq-P2a')[P_PRODUCT_ID]).toBe('P2');
    expect(byId('eq-P2a')[P_PRODUCT_NAME]).toBe('รุ่น P2');
    expect(byId('eq-P2a')[P_WARRANTY_END]).toBe('2027-06-30');
    expect(byId('eq-P1a')[P_PRODUCT_ID]).toBe('P1');
    expect(byId('eq-P1a')[P_WARRANTY_END]).toBe('2027-01-31');
  });

  it('pairs blank-serial rows only within the same productId group (9.8)', async () => {
    // Nothing has a serial yet, so every pairing goes through the positional
    // fallback. Existing order is P1, P1, P2 — submission order is P2 first.
    mockConnRowsFor([
      { id: 'eq-1', serialNumber: '', productId: 'P1' },
      { id: 'eq-2', serialNumber: '', productId: 'P1' },
      { id: 'eq-3', serialNumber: '', productId: 'P2' },
    ]);

    await syncEquipmentRowsForSalesRecord(
      'sale-1',
      [
        { serialNumber: '', productId: 'P2', productName: 'รุ่น P2' },
        { serialNumber: '', productId: 'P1', productName: 'รุ่น P1' },
        { serialNumber: '', productId: 'P1', productName: 'รุ่น P1' },
      ],
      shared
    );

    const updates = updateCalls();
    expect(updates).toHaveLength(3);
    // Blank serials must not spawn duplicates or unlink anything.
    expect(callsMatching('INSERT INTO customer_equipments')).toHaveLength(0);
    expect(callsMatching("UPDATE customer_equipments SET salesRecordId = ''")).toHaveLength(0);

    const byId = (id: string) => updates.find((c) => c[1].at(-1) === id)![1];
    // Naive position matching would have written P2 onto eq-1.
    expect(byId('eq-3')[P_PRODUCT_ID]).toBe('P2');
    expect(byId('eq-1')[P_PRODUCT_ID]).toBe('P1');
    expect(byId('eq-2')[P_PRODUCT_ID]).toBe('P1');
  });

  it('lets serial identity win over position, then falls back within the group for the rest (9.8)', async () => {
    mockConnRowsFor([
      { id: 'eq-A', serialNumber: 'SN-A', productId: 'P1' },
      { id: 'eq-B', serialNumber: '', productId: 'P1' },
      { id: 'eq-C', serialNumber: '', productId: 'P2' },
    ]);

    await syncEquipmentRowsForSalesRecord(
      'sale-1',
      [
        { serialNumber: '', productId: 'P2', productName: 'รุ่น P2' },
        { serialNumber: '', productId: 'P1', productName: 'รุ่น P1' },
        { serialNumber: 'SN-A', productId: 'P1', productName: 'รุ่น P1' },
      ],
      shared
    );

    const updates = updateCalls();
    expect(updates).toHaveLength(3);
    const byId = (id: string) => updates.find((c) => c[1].at(-1) === id)![1];
    // SN-A stays on eq-A even though it was submitted last.
    expect(byId('eq-A')[P_SERIAL]).toBe('SN-A');
    // The two blanks are left to the fallback, which stays inside its group.
    expect(byId('eq-C')[P_PRODUCT_ID]).toBe('P2');
    expect(byId('eq-B')[P_PRODUCT_ID]).toBe('P1');
    expect(callsMatching('INSERT INTO customer_equipments')).toHaveLength(0);
    expect(callsMatching("UPDATE customer_equipments SET salesRecordId = ''")).toHaveLength(0);
  });

  it('falls back to the sale-level template for rows that name no model of their own', async () => {
    mockConnRowsFor([]);

    await syncEquipmentRowsForSalesRecord('sale-1', [{ serialNumber: 'SN-X' }], shared);

    const inserts = callsMatching('INSERT INTO customer_equipments');
    expect(inserts).toHaveLength(1);
    // INSERT bind order: id, salesRecordId, customerId, productId, productName, serialNumber, ...
    expect(inserts[0][1][3]).toBe('P1');
    expect(inserts[0][1][4]).toBe('รุ่น P1');
    expect(inserts[0][1][5]).toBe('SN-X');
  });

  it('UNLINKS the surplus row and issues no DELETE when the machine count drops (9.9)', async () => {
    mockConnRowsFor([
      { id: 'eq-A', serialNumber: 'SN-A', productId: 'P1' },
      { id: 'eq-B', serialNumber: 'SN-B', productId: 'P1' },
      { id: 'eq-C', serialNumber: 'SN-C', productId: 'P2' },
    ]);

    // 3 machines down to 2 — the P1 unit in the middle is dropped.
    await syncEquipmentRowsForSalesRecord(
      'sale-1',
      [
        { serialNumber: 'SN-A', productId: 'P1', productName: 'รุ่น P1' },
        { serialNumber: 'SN-C', productId: 'P2', productName: 'รุ่น P2' },
      ],
      shared
    );

    const unlinks = callsMatching("UPDATE customer_equipments SET salesRecordId = ''");
    expect(unlinks).toHaveLength(1);
    expect(unlinks[0][1]).toEqual(['eq-B']);
    // NEVER delete — the row plus its schedules/logs stay under the customer.
    // Assert against every statement issued, not just DELETE FROM
    // customer_equipments, so no other purge can sneak in either.
    expect(conn.query.mock.calls.filter((c) => /DELETE/i.test(String(c[0])))).toHaveLength(0);
    // The two kept machines are updated in place, each with its own serial.
    const updates = updateCalls();
    expect(updates).toHaveLength(2);
    expect(updates.find((c) => c[1].at(-1) === 'eq-A')![1][P_SERIAL]).toBe('SN-A');
    expect(updates.find((c) => c[1].at(-1) === 'eq-C')![1][P_SERIAL]).toBe('SN-C');
  });

  it('unlinks every surplus row when the bill drops to a single machine (9.9)', async () => {
    mockConnRowsFor([
      { id: 'eq-A', serialNumber: 'SN-A', productId: 'P1' },
      { id: 'eq-B', serialNumber: 'SN-B', productId: 'P1' },
      { id: 'eq-C', serialNumber: 'SN-C', productId: 'P2' },
    ]);

    await syncEquipmentRowsForSalesRecord(
      'sale-1',
      [{ serialNumber: 'SN-B', productId: 'P1', productName: 'รุ่น P1' }],
      shared
    );

    const unlinks = callsMatching("UPDATE customer_equipments SET salesRecordId = ''");
    expect(unlinks.map((c) => c[1][0]).sort()).toEqual(['eq-A', 'eq-C']);
    expect(conn.query.mock.calls.filter((c) => /DELETE/i.test(String(c[0])))).toHaveLength(0);
  });

  it('runs on a caller-supplied transaction connection without opening its own (atomic sale path)', async () => {
    // salesDashboardStore's createSaleWithLineItems writes the sale, its line
    // items and its machines in ONE withTransaction and hands that connection
    // down — the writer must join it, not start a nested transaction.
    const txConn = { query: vi.fn() };
    mockConnRowsFor([{ id: 'eq-A', serialNumber: 'SN-A', productId: 'P1' }], txConn);

    await syncEquipmentRowsForSalesRecord(
      'sale-1',
      [
        { serialNumber: 'SN-A', productId: 'P1', productName: 'รุ่น P1' },
        { serialNumber: 'SN-NEW', productId: 'P2', productName: 'รุ่น P2' },
      ],
      { customerId: 'cust-1' },
      txConn
    );

    expect(vi.mocked(withTransaction)).not.toHaveBeenCalled();
    expect(conn.query).not.toHaveBeenCalled();
    const updates = updateCalls(txConn);
    const inserts = txConn.query.mock.calls.filter((c) =>
      String(c[0]).includes('INSERT INTO customer_equipments')
    );
    expect(updates).toHaveLength(1);
    expect(updates[0][1].at(-1)).toBe('eq-A');
    expect(inserts).toHaveLength(1);
    expect(inserts[0][1][5]).toBe('SN-NEW');
    // The insert's id is generated inside the callback body, so a
    // withTransaction retry re-derives it rather than replaying a stale one.
    expect(inserts[0][1][0]).toEqual(expect.any(String));
    expect(inserts[0][1][0]).not.toBe('');
  });

  it('does nothing when salesRecordId is empty, even with a transaction connection', async () => {
    const txConn = { query: vi.fn() };
    await syncEquipmentRowsForSalesRecord('', [{ serialNumber: 'SN-A' }], {}, txConn);
    expect(txConn.query).not.toHaveBeenCalled();
    expect(vi.mocked(withTransaction)).not.toHaveBeenCalled();
  });
});

describe('findEquipmentsBySerial', () => {
  it('normalizes each serial with trim + lowercase, exactly like the sync matching (9.11)', async () => {
    topQuery.mockResolvedValue([[]]);

    await findEquipmentsBySerial(['  SN-a  ', 'sn-B']);

    const [sql, params] = topQuery.mock.calls[0];
    expect(String(sql)).toContain('LOWER(TRIM(e.serialNumber)) IN (?, ?)');
    expect(params).toEqual(['sn-a', 'sn-b']);
  });

  it('collapses serials that differ only by case/whitespace into one bind (9.11)', async () => {
    topQuery.mockResolvedValue([[]]);

    await findEquipmentsBySerial(['SN-A', ' sn-a', 'Sn-A  ']);

    const [sql, params] = topQuery.mock.calls[0];
    expect(params).toEqual(['sn-a']);
    expect(String(sql)).toContain('IN (?)');
  });

  it('returns the clashing machine with enough context to name it to the admin (9.11)', async () => {
    topQuery.mockResolvedValue([
      [
        {
          id: 'eq-A',
          serialNumber: 'SN-A',
          salesRecordId: 'sale-9',
          productName: 'รุ่น P1',
          customerName: 'สมชาย',
        },
      ],
    ]);

    const found = await findEquipmentsBySerial(['  sn-A ']);
    expect(found).toEqual([
      {
        id: 'eq-A',
        serialNumber: 'SN-A',
        salesRecordId: 'sale-9',
        productName: 'รุ่น P1',
        customerName: 'สมชาย',
      },
    ]);
  });

  it('skips the query entirely when every serial is blank', async () => {
    expect(await findEquipmentsBySerial(['', '   '])).toEqual([]);
    expect(await findEquipmentsBySerial([])).toEqual([]);
    expect(topQuery).not.toHaveBeenCalled();
  });

  it('is advisory only — a failed lookup degrades to "no duplicates" instead of blocking the save (D12/D13)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    topQuery.mockRejectedValue(new Error('db down'));

    await expect(findEquipmentsBySerial(['SN-A'])).resolves.toEqual([]);
    errSpy.mockRestore();
  });
});

describe('addEquipment', () => {
  it('stores a provided calibrationDate, truncated/sanitized like the warranty dates', async () => {
    topQuery.mockImplementation((sql: string) => {
      if (sql.startsWith('INSERT INTO customer_equipments')) return Promise.resolve([{ affectedRows: 1 }]);
      return Promise.resolve([[{ id: 'eq-1', calibrationDate: '2026-01-15' }]]);
    });

    await addEquipment({ customerId: 'c1', productId: 'p1', calibrationDate: '2026-01-15' });

    const insertCall = topQuery.mock.calls.find((c) => String(c[0]).startsWith('INSERT INTO customer_equipments'))!;
    const params = insertCall[1] as unknown[];
    // calibrationDate is the 2nd-to-last param, right before createdAt.
    expect(params[params.length - 2]).toBe('2026-01-15');
  });

  it('defaults calibrationDate to null when not provided', async () => {
    topQuery.mockImplementation((sql: string) => {
      if (sql.startsWith('INSERT INTO customer_equipments')) return Promise.resolve([{ affectedRows: 1 }]);
      return Promise.resolve([[{ id: 'eq-1' }]]);
    });

    await addEquipment({ customerId: 'c1', productId: 'p1' });

    const insertCall = topQuery.mock.calls.find((c) => String(c[0]).startsWith('INSERT INTO customer_equipments'))!;
    const params = insertCall[1] as unknown[];
    expect(params[params.length - 2]).toBeNull();
  });
});

describe('updateEquipment', () => {
  // getEquipment()'s SELECT resolves productName live via
  // COALESCE(NULLIF(e.productName, ''), p.title_th) — simulate that resolved
  // value coming back on the "existing" read, exactly as the real EQUIPMENT_SELECT
  // would when the raw column is empty but a catalog product is linked.
  function mockQueryFor(existingRow: Record<string, unknown>, updatedRow: Record<string, unknown>) {
    let updated = false;
    topQuery.mockImplementation((sql: string) => {
      if (sql.startsWith('UPDATE customer_equipments')) {
        updated = true;
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      return Promise.resolve([[updated ? updatedRow : existingRow]]);
    });
  }

  it('does not freeze the live catalog title into the raw column on an unrelated edit', async () => {
    mockQueryFor(
      {
        id: 'eq-1',
        productId: 'prod-1',
        productName: 'Live Catalog Title', // as resolved by the COALESCE
        warrantyStartDate: null,
      },
      { id: 'eq-1', productId: 'prod-1', productName: 'Live Catalog Title', warrantyStartDate: '2026-01-01' }
    );

    // Client echoes back the whole record it loaded (incl. the resolved
    // productName) even though only warrantyStartDate changed.
    await updateEquipment('eq-1', {
      productId: 'prod-1',
      productName: 'Live Catalog Title',
      warrantyStartDate: '2026-01-01',
    });

    const updateCall = topQuery.mock.calls.find((c) => String(c[0]).startsWith('UPDATE customer_equipments'))!;
    const [, params] = updateCall;
    // productName is the 2nd bound param (customerId, productId, productName, ...)
    expect((params as unknown[])[2]).toBe('');
  });

  it('keeps a custom equipment\'s own productName when there is no linked catalog product', async () => {
    mockQueryFor(
      { id: 'eq-2', productId: '', productName: 'ปั๊มมือสอง', warrantyStartDate: null },
      { id: 'eq-2', productId: '', productName: 'ปั๊มมือสอง', warrantyStartDate: '2026-01-01' }
    );

    await updateEquipment('eq-2', {
      productId: '_custom',
      productName: 'ปั๊มมือสอง',
      warrantyStartDate: '2026-01-01',
    });

    const updateCall = topQuery.mock.calls.find((c) => String(c[0]).startsWith('UPDATE customer_equipments'))!;
    const [, params] = updateCall;
    expect((params as unknown[])[2]).toBe('ปั๊มมือสอง');
  });

  it('persists note and calibrationDate', async () => {
    mockQueryFor(
      { id: 'eq-3', productId: 'p1', productName: '', note: null, calibrationDate: null },
      { id: 'eq-3', productId: 'p1', productName: '', note: 'x', calibrationDate: '2026-02-01' }
    );

    await updateEquipment('eq-3', { note: 'x', calibrationDate: '2026-02-01' });

    const updateCall = topQuery.mock.calls.find((c) => String(c[0]).startsWith('UPDATE customer_equipments'))!;
    const params = updateCall[1] as unknown[];
    // note = index 10, calibrationDate = index 11 (see the UPDATE column list).
    expect(params[10]).toBe('x');
    expect(params[11]).toBe('2026-02-01');
  });
});

describe('declineWarrantyRenewal', () => {
  function mockQueryFor(existingRow: Record<string, unknown>) {
    let updated = false;
    topQuery.mockImplementation((sql: string) => {
      if (sql.startsWith('UPDATE customer_equipments')) {
        updated = true;
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      return Promise.resolve([[updated ? { ...existingRow, status: 'Expired' } : existingRow]]);
    });
  }

  it('returns null when the equipment does not exist', async () => {
    topQuery.mockResolvedValue([[]]);
    expect(await declineWarrantyRenewal('missing')).toBeNull();
    expect(topQuery.mock.calls.some((c) => String(c[0]).startsWith('UPDATE customer_equipments'))).toBe(false);
  });

  it('flips status to Expired and writes a dated note when there was none before', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-04T10:00:00.000Z')); // Bangkok: Sep 4
    mockQueryFor({ id: 'eq-1', productId: 'prod-1', productName: '', status: 'Active', note: null });

    await declineWarrantyRenewal('eq-1');

    const updateCall = topQuery.mock.calls.find((c) => String(c[0]).startsWith('UPDATE customer_equipments'))!;
    const params = updateCall[1] as unknown[];
    // status is the 10th bound param, note is the 11th (see the UPDATE column list).
    expect(params[9]).toBe('Expired');
    expect(params[10]).toBe('หมดประกันแล้ว วันที่ 2026-09-04 - ลูกค้าไม่ต่อประกัน');
    vi.useRealTimers();
  });

  it('appends to an existing note instead of overwriting it', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-04T10:00:00.000Z'));
    mockQueryFor({ id: 'eq-1', productId: 'prod-1', productName: '', status: 'Active', note: 'ติดตั้งเมื่อ 2026-01-01' });

    await declineWarrantyRenewal('eq-1');

    const updateCall = topQuery.mock.calls.find((c) => String(c[0]).startsWith('UPDATE customer_equipments'))!;
    const params = updateCall[1] as unknown[];
    expect(params[10]).toBe(
      'ติดตั้งเมื่อ 2026-01-01\nหมดประกันแล้ว วันที่ 2026-09-04 - ลูกค้าไม่ต่อประกัน'
    );
    vi.useRealTimers();
  });
});

describe('listSchedules', () => {
  it('filters by equipmentId when given', async () => {
    topQuery.mockResolvedValue([[]]);
    await listSchedules('eq-1');
    expect(topQuery).toHaveBeenCalledWith(
      expect.stringContaining('WHERE equipmentId = ?'),
      ['eq-1']
    );
  });

  it('filters by customerId when given (and no equipmentId)', async () => {
    topQuery.mockResolvedValue([[]]);
    await listSchedules(undefined, 'cust-1');
    expect(topQuery).toHaveBeenCalledWith(
      expect.stringContaining('WHERE customerId = ?'),
      ['cust-1']
    );
  });

  it('returns everything when neither filter is given', async () => {
    topQuery.mockResolvedValue([[]]);
    await listSchedules();
    expect(topQuery).toHaveBeenCalledWith(expect.not.stringContaining('WHERE'));
  });
});

describe('addSchedule', () => {
  it('stores an equipment-scoped schedule with customerId left null', async () => {
    topQuery.mockImplementation((sql: string) => {
      if (sql.startsWith('INSERT INTO service_schedules')) return Promise.resolve([{ affectedRows: 1 }]);
      return Promise.resolve([[{ id: 'sch-1', equipmentId: 'eq-1' }]]);
    });

    await addSchedule({ equipmentId: 'eq-1', scheduleType: 'service', scheduledDate: '2026-09-04' });

    const insertCall = topQuery.mock.calls.find((c) => String(c[0]).startsWith('INSERT INTO service_schedules'))!;
    const params = insertCall[1] as unknown[];
    // (id, equipmentId, customerId, scheduleType, ...)
    expect(params[1]).toBe('eq-1');
    expect(params[2]).toBeNull();
    expect(params[3]).toBe('service');
  });

  it('stores a customer-scoped schedule with equipmentId left null and forces scheduleType to phone_call', async () => {
    topQuery.mockImplementation((sql: string) => {
      if (sql.startsWith('INSERT INTO service_schedules')) return Promise.resolve([{ affectedRows: 1 }]);
      return Promise.resolve([[{ id: 'sch-1', customerId: 'cust-1' }]]);
    });

    // Even if the caller asks for "service", there's no equipment context.
    await addSchedule({ customerId: 'cust-1', scheduleType: 'service' as any, scheduledDate: '2026-09-04' });

    const insertCall = topQuery.mock.calls.find((c) => String(c[0]).startsWith('INSERT INTO service_schedules'))!;
    const params = insertCall[1] as unknown[];
    expect(params[1]).toBeNull();
    expect(params[2]).toBe('cust-1');
    expect(params[3]).toBe('phone_call');
  });

  it('prefers equipmentId over customerId if a caller supplies both', async () => {
    topQuery.mockImplementation((sql: string) => {
      if (sql.startsWith('INSERT INTO service_schedules')) return Promise.resolve([{ affectedRows: 1 }]);
      return Promise.resolve([[{ id: 'sch-1' }]]);
    });

    await addSchedule({
      equipmentId: 'eq-1',
      customerId: 'cust-1',
      scheduleType: 'service',
      scheduledDate: '2026-09-04',
    });

    const insertCall = topQuery.mock.calls.find((c) => String(c[0]).startsWith('INSERT INTO service_schedules'))!;
    const params = insertCall[1] as unknown[];
    expect(params[1]).toBe('eq-1');
    expect(params[2]).toBeNull();
  });
});

describe('updateSchedule', () => {
  it('rejects setting status to completed — that transition must go through completeScheduleWithLog', async () => {
    topQuery.mockResolvedValue([[{ id: 'sch-1', status: 'pending', notes: '' }]]);

    await expect(updateSchedule('sch-1', { status: 'completed' })).rejects.toThrow(
      ScheduleCompletionRequiresLogError
    );
    expect(topQuery.mock.calls.some((c) => String(c[0]).startsWith('UPDATE service_schedules'))).toBe(false);
  });

  it('allows a normal field update that does not touch status', async () => {
    topQuery.mockImplementation((sql: string) => {
      if (String(sql).startsWith('UPDATE service_schedules')) return Promise.resolve([{ affectedRows: 1 }]);
      return Promise.resolve([[{ id: 'sch-1', status: 'pending', notes: 'old' }]]);
    });

    const result = await updateSchedule('sch-1', { notes: 'new' });
    expect(result?.status).toBe('pending');
  });

  it('keeps a customer-scoped schedule as phone_call even if asked to change scheduleType', async () => {
    topQuery.mockImplementation((sql: string) => {
      if (String(sql).startsWith('UPDATE service_schedules')) return Promise.resolve([{ affectedRows: 1 }]);
      return Promise.resolve([[{ id: 'sch-1', customerId: 'cust-1', status: 'pending', scheduleType: 'phone_call', notes: '' }]]);
    });

    await updateSchedule('sch-1', { scheduleType: 'service' as any });

    const updateCall = topQuery.mock.calls.find((c) => String(c[0]).startsWith('UPDATE service_schedules'))!;
    const params = updateCall[1] as unknown[];
    expect(params[0]).toBe('phone_call'); // scheduleType is the 1st SET value
  });
});

describe('cleanupEquipmentsForSalesRecord', () => {
  it('unlinks equipment from the sale — never deletes the rows', async () => {
    topQuery.mockResolvedValue([{ affectedRows: 2 }]);
    await cleanupEquipmentsForSalesRecord('sale-1');
    expect(topQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = topQuery.mock.calls[0];
    expect(sql).not.toContain('DELETE');
    expect(sql).toContain("UPDATE customer_equipments SET salesRecordId = ''");
    expect(params).toEqual(['sale-1']);
  });

  it('does nothing when salesRecordId is empty', async () => {
    await cleanupEquipmentsForSalesRecord('');
    expect(topQuery).not.toHaveBeenCalled();
  });
});

describe('completeScheduleWithLog', () => {
  it('inserts the log and flips the schedule to completed in one transaction, then returns the persisted row', async () => {
    conn.query.mockImplementation((sql: string) => {
      if (sql.includes('SELECT status FROM service_schedules')) {
        return Promise.resolve([[{ status: 'pending' }]]);
      }
      return Promise.resolve([{ affectedRows: 1 }]);
    });
    topQuery.mockResolvedValue([[{ id: 'log-1', scheduleId: 's1', resultDetails: 'Fixed it' }]]);

    const result = await completeScheduleWithLog('s1', {
      serviceReportNumber: 'SR-1',
      resultDetails: 'Fixed it',
      customerFeedback: 'Happy',
    });

    expect(result).toEqual({ id: 'log-1', scheduleId: 's1', resultDetails: 'Fixed it' });

    const insertCall = conn.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO service_logs'));
    expect(insertCall![1]).toEqual(
      expect.arrayContaining(['s1', 'SR-1', 'Fixed it', 'Happy'])
    );
    const updateCall = conn.query.mock.calls.find(([sql]) => String(sql).includes('UPDATE service_schedules'));
    expect(updateCall![1]).toEqual(['s1']);

    // The insert must run before the status flip (log<->completed invariant).
    const insertIdx = conn.query.mock.calls.findIndex(([sql]) => String(sql).includes('INSERT INTO service_logs'));
    const updateIdx = conn.query.mock.calls.findIndex(([sql]) => String(sql).includes('UPDATE service_schedules'));
    expect(insertIdx).toBeLessThan(updateIdx);
  });

  it('rejects with ScheduleNotPendingError (no insert/update) when the schedule is not pending', async () => {
    conn.query.mockImplementation((sql: string) => {
      if (sql.includes('SELECT status FROM service_schedules')) {
        return Promise.resolve([[{ status: 'completed' }]]);
      }
      return Promise.resolve([{ affectedRows: 1 }]);
    });

    await expect(completeScheduleWithLog('s1', {})).rejects.toThrow(ScheduleNotPendingError);
    expect(conn.query).toHaveBeenCalledTimes(1); // only the SELECT ... FOR UPDATE
    expect(topQuery).not.toHaveBeenCalled();
  });

  it('rejects with ScheduleNotPendingError when the schedule does not exist', async () => {
    conn.query.mockResolvedValue([[]]);
    await expect(completeScheduleWithLog('missing', {})).rejects.toThrow(ScheduleNotPendingError);
  });

  it('propagates a failure from the log insert without flipping the schedule status', async () => {
    conn.query.mockImplementation((sql: string) => {
      if (sql.includes('SELECT status FROM service_schedules')) {
        return Promise.resolve([[{ status: 'pending' }]]);
      }
      if (sql.includes('INSERT INTO service_logs')) {
        return Promise.reject(new Error('insert failed'));
      }
      return Promise.resolve([{ affectedRows: 1 }]);
    });

    await expect(completeScheduleWithLog('s1', {})).rejects.toThrow('insert failed');
    const updateCall = conn.query.mock.calls.find(([sql]) => String(sql).includes('UPDATE service_schedules'));
    expect(updateCall).toBeUndefined();
    expect(topQuery).not.toHaveBeenCalled();
  });
});

describe('getAlerts — "today" must be Bangkok (UTC+7) time, not server UTC', () => {
  beforeEach(() => {
    topQuery.mockResolvedValue([[]]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses the Bangkok calendar date for overdue/cutoff comparisons during the UTC-lag window', async () => {
    // UTC 2026-08-04T19:00:00Z = Bangkok 2026-08-05T02:00:00+07:00. A naive
    // server-UTC "today" would say "2026-08-04"; the correct Bangkok "today"
    // is "2026-08-05".
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-04T19:00:00.000Z'));

    await getAlerts(30, 7);

    const warrantyCall = topQuery.mock.calls.find(([sql]) =>
      String(sql).includes('warrantyEndDate')
    );
    expect(warrantyCall![1][0]).toBe('2026-08-05'); // today
    expect(warrantyCall![1][1]).toBe('2026-09-04'); // +30 days from Bangkok today

    const missingDocCall = topQuery.mock.calls.find(([sql]) =>
      String(sql).includes('DATEDIFF')
    );
    expect(missingDocCall![1]).toEqual(['2026-08-05', '2026-08-05', '2026-08-04T19:00:00.000Z']);

    const scheduleCall = topQuery.mock.calls.find(([sql]) =>
      String(sql).includes('service_schedules')
    );
    expect(scheduleCall![1][0]).toBe('2026-08-12'); // +7 days from Bangkok today
  });

  it('marks a pending schedule from "yesterday" (server-UTC) as overdue during the lag window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-04T19:00:00.000Z')); // Bangkok: Aug 5, 02:00

    topQuery.mockImplementation((sql: string) => {
      if (String(sql).includes('service_schedules')) {
        return Promise.resolve([[{ id: 's1', scheduledDate: '2026-08-04', status: 'pending' }]]);
      }
      return Promise.resolve([[]]);
    });

    const alerts = await getAlerts();
    expect(alerts.upcomingSchedules[0].overdue).toBe(true);
  });

  it('resolves customerName/companyName for a customer-scoped schedule (no linked equipment)', async () => {
    topQuery.mockImplementation((sql: string) => {
      if (String(sql).includes('FROM service_schedules')) {
        return Promise.resolve([[
          { id: 's1', equipmentId: null, customerId: 'cust-1', scheduledDate: '2026-08-01', status: 'pending', customerName: 'สมชาย', companyName: 'ACME' },
        ]]);
      }
      return Promise.resolve([[]]);
    });

    const alerts = await getAlerts();
    expect(alerts.upcomingSchedules[0].customerName).toBe('สมชาย');
    expect(alerts.upcomingSchedules[0].companyName).toBe('ACME');
  });

  it('joins through customerId (not just the equipment path) to resolve customer/company', async () => {
    await getAlerts();
    const scheduleCall = topQuery.mock.calls.find(([sql]) => String(sql).includes('FROM service_schedules'));
    expect(String(scheduleCall![0])).toContain('LEFT JOIN customers c2 ON s.customerId = c2.id');
    expect(String(scheduleCall![0])).toContain('COALESCE(c.name, c2.name)');
  });

  it('reports the true incomplete-equipment total separately from the capped list', async () => {
    topQuery.mockImplementation((sql: string) => {
      if (String(sql).includes('SELECT COUNT(*) AS cnt')) {
        return Promise.resolve([[{ cnt: 137 }]]);
      }
      if (String(sql).includes('customer_equipments e') && String(sql).includes("e.serialNumber = ''")) {
        return Promise.resolve([Array.from({ length: 100 }, (_, i) => ({ id: `eq-${i}` }))]);
      }
      return Promise.resolve([[]]);
    });

    const alerts = await getAlerts();
    expect(alerts.incompleteEquipments).toHaveLength(100);
    expect(alerts.incompleteEquipmentsTotal).toBe(137);
  });

  it('excludes equipment manually marked Expired from the warranty-expiry alert query', async () => {
    // A warranty ending inside the alert window is normally worth flagging,
    // but an admin can also manually set an equipment's status to "Expired" —
    // that override must suppress the alert even if the date math still says
    // "expiring soon".
    await getAlerts();
    const warrantyCall = topQuery.mock.calls.find(([sql]) => String(sql).includes('warrantyEndDate'));
    expect(String(warrantyCall![0])).toContain("e.status != 'Expired'");
  });

  it('alerts starting 2 months before the 1-year calibration anniversary (i.e. 10 months after calibrationDate), compared against Bangkok "today"', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-04T19:00:00.000Z')); // Bangkok: Aug 5, 02:00

    await getAlerts(30, 7);

    const calibrationCall = topQuery.mock.calls.find(([sql]) => String(sql).includes('calibrationDate'));
    expect(calibrationCall![0]).toContain('DATE_ADD(e.calibrationDate, INTERVAL ? MONTH)');
    // 12 (1-year validity) - 2 (alert lead time) = 10 months; compared against
    // Bangkok "today" with no upper bound (see the next test for why).
    expect(calibrationCall![1]).toEqual([10, '2026-08-05', '2026-08-04T19:00:00.000Z']);
  });

  it('still surfaces a calibration that is already overdue, not just ones approaching', async () => {
    // Unlike warranty (silenced by status='Expired'), nothing marks a
    // calibration as "done" except recording a NEW calibrationDate — so an
    // overdue one must keep alerting indefinitely, not just while it's still
    // within the upcoming window.
    await getAlerts();
    const calibrationCall = topQuery.mock.calls.find(([sql]) => String(sql).includes('calibrationDate'));
    expect(String(calibrationCall![0])).not.toMatch(/DATE_ADD\(e\.calibrationDate, INTERVAL \? MONTH\)\s*>=/);
  });

  it('returns nearingCalibration rows separately from expiringWarranties', async () => {
    topQuery.mockImplementation((sql: string) => {
      if (String(sql).includes('calibrationDate')) {
        return Promise.resolve([[{ id: 'eq-1', calibrationDate: '2025-11-05' }]]);
      }
      return Promise.resolve([[]]);
    });

    const alerts = await getAlerts();
    expect(alerts.nearingCalibration).toEqual([{ id: 'eq-1', calibrationDate: '2025-11-05' }]);
  });

  it('excludes an alert whose snoozeUntil filter would match in the real query (SQL shape regression guard)', async () => {
    // We can't exercise MySQL's actual filtering through a mocked query(), so
    // this asserts the query TEXT joins alert_snoozes and compares against
    // "now" for every alert type — the thing a future refactor could
    // accidentally drop and still pass every other getAlerts test here.
    await getAlerts();
    const queries = topQuery.mock.calls.map(([sql]) => String(sql));
    for (const sql of queries) {
      expect(sql).toContain('LEFT JOIN alert_snoozes');
      expect(sql).toContain('sno.snoozeUntil IS NULL OR sno.snoozeUntil <=');
    }
  });
});

describe('snoozeAlert', () => {
  it('upserts a snooze row keyed on (alertType, referenceId)', async () => {
    topQuery.mockResolvedValue([{ affectedRows: 1 }]);
    await snoozeAlert('schedule', 's1', '2026-08-07T23:00:00.000Z');

    expect(topQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = topQuery.mock.calls[0];
    expect(sql).toContain('INSERT INTO alert_snoozes');
    expect(sql).toContain('ON DUPLICATE KEY UPDATE');
    expect(params[0]).toBe('schedule');
    expect(params[1]).toBe('s1');
    expect(params[2]).toBe('2026-08-07T23:00:00.000Z');
    // The UPDATE branch's snoozeUntil must match the INSERT branch's, so a
    // re-snooze of the same alert actually moves the date instead of no-op'ing.
    expect(params[4]).toBe('2026-08-07T23:00:00.000Z');
  });

  it('works for every alert type the UI can snooze', async () => {
    topQuery.mockResolvedValue([{ affectedRows: 1 }]);
    for (const type of ['warranty', 'incomplete', 'schedule', 'missing_doc']) {
      await snoozeAlert(type, 'ref-1', '2026-08-07T23:00:00.000Z');
      const [, params] = topQuery.mock.calls.at(-1)!;
      expect(params[0]).toBe(type);
    }
  });
});
