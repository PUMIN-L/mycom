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

import {
  syncEquipmentsForSalesRecord,
  cleanupEquipmentsForSalesRecord,
  getAlerts,
  completeScheduleWithLog,
  ScheduleNotPendingError,
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
    expect(missingDocCall![1]).toEqual(['2026-08-05', '2026-08-05']);

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
});
