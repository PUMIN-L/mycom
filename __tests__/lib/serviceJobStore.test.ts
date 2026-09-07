// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// The DB is mocked — these tests assert the SQL that is issued and its params.
const conn = { query: vi.fn() };
let runTransaction = async (fn: (c: typeof conn) => Promise<unknown>) => fn(conn);

vi.mock('@/app/lib/db', () => ({
  query: vi.fn(),
  withTransaction: vi.fn((fn: (c: typeof conn) => Promise<unknown>) => runTransaction(fn)),
}));

import { query } from '@/app/lib/db';
import {
  createJob,
  updateJob,
  completeJob,
  cancelJob,
  deleteJob,
  getJob,
  listJobs,
  listJobsForEquipment,
  ServiceJobValidationError,
  ServiceJobCustomerMismatchError,
  ServiceJobDuplicateEquipmentError,
  ServiceJobNotEditableError,
} from '@/app/lib/serviceJobStore';

// ── Fixture state the mocked connection answers from ─────────────────────────

const JOB_DATE = '2026-09-05'; // → 050926-NN
const CUSTOMER = 'cust-1';

let equipmentOwners: Record<string, string>; // equipmentId → customerId
let ledgerDocNos: string[]; // what used_docnos already owns
let ledgerRejects: string[]; // numbers that answer ER_DUP_ENTRY on INSERT
let ledgerFatal: boolean; // the ledger INSERT fails for a REAL reason
let jobRow: Record<string, unknown> | null; // the row a FOR UPDATE read returns
let jobEquipmentIds: string[]; // rows in service_job_equipments for that job
let scheduleExists: boolean; // is the linked appointment still there?
let statusFlipRows: number; // affectedRows of the guarded status UPDATE

const dupEntry = () => Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' });

const sqlOf = (call: unknown[]) => String(call[0]);
const callsMatching = (needle: string) =>
  conn.query.mock.calls.filter((c) => sqlOf(c).includes(needle));

beforeEach(() => {
  vi.clearAllMocks();
  runTransaction = async (fn) => fn(conn);
  equipmentOwners = { 'eq-1': CUSTOMER, 'eq-2': CUSTOMER, 'eq-3': CUSTOMER };
  ledgerDocNos = [];
  ledgerRejects = [];
  ledgerFatal = false;
  jobRow = {
    id: 'job-1',
    jobNo: '050926-22',
    jobDate: JOB_DATE,
    status: 'issued',
    scheduleId: null,
  };
  jobEquipmentIds = ['eq-1', 'eq-2'];
  scheduleExists = true;
  statusFlipRows = 1;

  conn.query.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (sql.includes('FROM customer_equipments')) {
      const ids = params as string[];
      return [
        ids
          .filter((id) => equipmentOwners[id] !== undefined)
          .map((id) => ({ id, customerId: equipmentOwners[id] })),
      ];
    }
    if (sql.includes('SELECT docNo FROM used_docnos')) {
      const prefix = String(params[0]).replace(/%$/, '').replace(/\\/g, '');
      return [ledgerDocNos.filter((d) => d.startsWith(prefix)).map((docNo) => ({ docNo }))];
    }
    if (sql.includes('INSERT INTO used_docnos')) {
      if (ledgerFatal) throw new Error('connection reset');
      const docNo = String(params[0]);
      if (ledgerRejects.includes(docNo) || ledgerDocNos.includes(docNo)) throw dupEntry();
      ledgerDocNos.push(docNo);
      return [{ affectedRows: 1 }];
    }
    if (sql.includes('FROM service_jobs WHERE id = ?')) {
      return [jobRow ? [jobRow] : []];
    }
    if (sql.includes('SELECT equipmentId FROM service_job_equipments')) {
      return [jobEquipmentIds.map((equipmentId, sortOrder) => ({ equipmentId, sortOrder }))];
    }
    if (sql.includes('FROM service_schedules WHERE id = ?')) {
      return [scheduleExists ? [{ id: params[0] }] : []];
    }
    if (sql.includes("SET status = 'completed'") && sql.includes('service_jobs')) {
      return [{ affectedRows: statusFlipRows }];
    }
    return [{ affectedRows: 1 }];
  });

  // getJob()'s read-back, on the pool rather than the transaction.
  (query as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    async (sql: string) => {
      if (sql.includes('FROM service_job_equipments')) {
        return [jobEquipmentIds.map((equipmentId, sortOrder) => ({
          equipmentId,
          sortOrder,
          serialNumber: `SN-${equipmentId}`,
          productName: 'เครื่องชั่ง XYZ',
          warrantyEndDate: null,
        }))];
      }
      if (sql.includes('FROM service_jobs')) {
        return [jobRow ? [{ ...jobRow, linkedScheduleId: scheduleExists ? jobRow.scheduleId : null }] : []];
      }
      return [[]];
    }
  );
});

const input = (over: Record<string, unknown> = {}) => ({
  companyId: 'co-1',
  customerId: CUSTOMER,
  jobDate: JOB_DATE,
  equipmentIds: ['eq-1', 'eq-2'],
  ...over,
});

// ── Issuing a sheet ──────────────────────────────────────────────────────────

describe('createJob', () => {
  it('claims the number by INSERTing into the SHARED used_docnos ledger BEFORE writing the sheet', async () => {
    await createJob(input());

    const ledger = callsMatching('INSERT INTO used_docnos');
    expect(ledger).toHaveLength(1);
    expect(ledger[0][1]).toEqual(['050926-22', expect.any(String), expect.any(String)]);

    const ledgerIndex = conn.query.mock.calls.findIndex((c) =>
      sqlOf(c).includes('INSERT INTO used_docnos')
    );
    const jobIndex = conn.query.mock.calls.findIndex((c) =>
      sqlOf(c).includes('INSERT INTO service_jobs')
    );
    expect(ledgerIndex).toBeGreaterThanOrEqual(0);
    expect(ledgerIndex).toBeLessThan(jobIndex);
    // The number belongs to THIS sheet: the ledger row and the job row carry
    // the same id.
    expect(ledger[0][1]![1]).toBe((callsMatching('INSERT INTO service_jobs')[0][1] as unknown[])[0]);
  });

  it('reads the ledger WITHOUT a date window, under both prefixes for the day', async () => {
    const reads = callsMatching('SELECT docNo FROM used_docnos');
    await createJob(input());
    const after = callsMatching('SELECT docNo FROM used_docnos');
    expect(after.length - reads.length).toBe(2); // current + legacy shape
    for (const call of after) {
      // A 7-day window cannot see last year's colliding numbers; minting from
      // one hands back a number the PRIMARY KEY then refuses.
      expect(sqlOf(call)).not.toContain('createdAt >=');
    }
  });

  it('steps PAST a number another admin claimed a moment ago instead of failing', async () => {
    // The ledger read saw nothing, but -22 is taken by the time we INSERT:
    // two admins pressed บันทึก at the same instant.
    ledgerRejects = ['050926-22'];

    await createJob(input());

    const ledger = callsMatching('INSERT INTO used_docnos');
    expect(ledger.map((c) => (c[1] as unknown[])[0])).toEqual([
      '050926-22',
      '050926-23',
    ]);
    expect(callsMatching('INSERT INTO service_jobs')).toHaveLength(1);
  });

  it('propagates a non-duplicate ledger error instead of treating it as a taken number', async () => {
    ledgerFatal = true;
    await expect(createJob(input({ equipmentIds: ['eq-1'] }))).rejects.toThrow('connection reset');
    expect(callsMatching('INSERT INTO service_jobs')).toHaveLength(0);
  });

  it('writes every machine in printed order, in ONE multi-row insert', async () => {
    await createJob(input({ equipmentIds: ['eq-3', 'eq-1', 'eq-2'] }));

    const rows = callsMatching('INSERT INTO service_job_equipments');
    expect(rows).toHaveLength(1);
    const params = rows[0][1] as unknown[];
    const jobId = (callsMatching('INSERT INTO service_jobs')[0][1] as unknown[])[0];
    expect(params).toEqual([jobId, 'eq-3', 0, jobId, 'eq-1', 1, jobId, 'eq-2', 2]);
  });

  it('WRITES NO SERVICE HISTORY — a sheet that has only been printed is not a visit', async () => {
    await createJob(input());
    expect(callsMatching('service_logs')).toHaveLength(0);
    expect(callsMatching('service_schedules')).toHaveLength(0);
  });

  it('never touches calibrationDate — the system cannot know what the technician actually did', async () => {
    await createJob(input());
    expect(callsMatching('calibrationDate')).toHaveLength(0);
    expect(callsMatching('UPDATE customer_equipments')).toHaveLength(0);
  });

  it('accepts an empty technician name — the printed sheet then carries a blank line', async () => {
    await createJob(input({ technicianName: '' }));
    const params = callsMatching('INSERT INTO service_jobs')[0][1] as unknown[];
    expect(params[5]).toBe('');
  });

  it('stores the schedule link as a plain id, and creates fine without one', async () => {
    await createJob(input({ scheduleId: 'sch-9' }));
    expect((callsMatching('INSERT INTO service_jobs')[0][1] as unknown[])[6]).toBe('sch-9');

    conn.query.mockClear();
    await createJob(input());
    expect((callsMatching('INSERT INTO service_jobs')[0][1] as unknown[])[6]).toBeNull();
  });

  it('mints the id INSIDE the transaction callback, so a retried transaction cannot claim two numbers for one save', async () => {
    // withTransaction replays its callback after a transient connection loss.
    // An id minted outside would be reused; ids minted inside differ per run,
    // which is what makes the replay a fresh, complete attempt.
    runTransaction = async (fn) => {
      await fn(conn);
      return fn(conn);
    };
    await createJob(input());
    const jobInserts = callsMatching('INSERT INTO service_jobs');
    expect(jobInserts).toHaveLength(2);
    const firstId = (jobInserts[0][1] as unknown[])[0];
    const secondId = (jobInserts[1][1] as unknown[])[0];
    expect(firstId).not.toBe(secondId);
  });
});

describe('createJob — what it refuses', () => {


  it('refuses the same machine twice on one sheet, naming it in Thai', async () => {
    await expect(createJob(input({ equipmentIds: ['eq-1', 'eq-1'] }))).rejects.toBeInstanceOf(
      ServiceJobDuplicateEquipmentError
    );
    await expect(createJob(input({ equipmentIds: ['eq-1', 'eq-1'] }))).rejects.toThrow(
      'เครื่องนี้อยู่ในใบงานนี้แล้ว'
    );
    expect(conn.query).not.toHaveBeenCalled();
  });

  it('refuses a machine that is not in the system at all', async () => {
    await expect(createJob(input({ equipmentIds: ['eq-ghost'] }))).rejects.toThrow(
      'ไม่พบเครื่องที่เลือกในระบบ'
    );
    expect(callsMatching('INSERT INTO service_jobs')).toHaveLength(0);
  });

  it('refuses a sheet with no machine on it', async () => {
    await expect(createJob(input({ equipmentIds: [] }))).rejects.toBeInstanceOf(
      ServiceJobValidationError
    );
  });

  it('refuses a date that is not YYYY-MM-DD — the column is compared and sorted lexically', async () => {
    await expect(createJob(input({ jobDate: '05/09/2026' }))).rejects.toThrow('YYYY-MM-DD');
    await expect(createJob(input({ jobDate: '' }))).rejects.toBeInstanceOf(ServiceJobValidationError);
  });

  it('refuses a sheet with no customer or company', async () => {
    await expect(createJob(input({ customerId: '' }))).rejects.toThrow('ผู้ติดต่อ');
    await expect(createJob(input({ companyId: '' }))).rejects.toThrow('บริษัท');
  });
});

// ── Closing a sheet: the ONLY thing that writes history ──────────────────────

describe('completeJob', () => {
  it('flips the status, writes ONE service_logs row per machine under the job number, and closes the appointment', async () => {
    jobRow = {
      id: 'job-1',
      jobNo: '050926-22',
      jobDate: JOB_DATE,
      status: 'issued',
      scheduleId: 'sch-1',
    };
    jobEquipmentIds = ['eq-1', 'eq-2'];

    await completeJob('job-1');

    const logs = callsMatching('INSERT INTO service_logs');
    expect(logs).toHaveLength(2);
    for (const [, params] of logs) {
      const p = params as unknown[];
      expect(p[1]).toBe('sch-1'); // scheduleId — the appointment still exists
      expect(p[3]).toBe('job-1'); // jobId
      expect(p[4]).toBe('050926-22'); // serviceReportNumber === jobNo
      expect(p[5]).toBe(JOB_DATE); // actionDate
    }
    expect((logs[0][1] as unknown[])[2]).toBe('eq-1');
    expect((logs[1][1] as unknown[])[2]).toBe('eq-2');
    // Each log's id is minted inside the callback and is its own.
    expect((logs[0][1] as unknown[])[0]).not.toBe((logs[1][1] as unknown[])[0]);

    const flip = callsMatching('UPDATE service_jobs');
    expect(sqlOf(flip[0])).toContain("WHERE id = ? AND status = 'issued'");
    expect(callsMatching('UPDATE service_schedules')).toHaveLength(1);
  });

  it('marks the appointment with a status the rest of the CRM knows', async () => {
    jobRow = { id: 'job-1', jobNo: '050926-22', jobDate: JOB_DATE, status: 'issued', scheduleId: 'sch-1' };
    await completeJob('job-1');
    // SCHEDULE_STATUSES is pending | completed | cancelled — a value outside it
    // would be invisible to every existing filter and label.
    expect(sqlOf(callsMatching('UPDATE service_schedules')[0])).toContain("status = 'completed'");
  });

  it('CLOSING TWICE writes no second set of logs', async () => {
    jobRow = { id: 'job-1', jobNo: '050926-22', jobDate: JOB_DATE, status: 'completed', scheduleId: 'sch-1' };

    const result = await completeJob('job-1');

    expect(callsMatching('INSERT INTO service_logs')).toHaveLength(0);
    expect(callsMatching('UPDATE service_jobs')).toHaveLength(0);
    expect(callsMatching('UPDATE service_schedules')).toHaveLength(0);
    expect(result?.status).toBe('completed');
  });

  it('writes no logs when another writer won the status flip in between', async () => {
    statusFlipRows = 0; // the guarded UPDATE matched nothing
    await completeJob('job-1');
    expect(callsMatching('INSERT INTO service_logs')).toHaveLength(0);
  });

  it('a REPLAYED transaction callback still leaves exactly one set of logs', async () => {
    // withTransaction retries up to 3 times; the second run sees the sheet
    // already completed and stands down.
    jobRow = { id: 'job-1', jobNo: '050926-22', jobDate: JOB_DATE, status: 'issued', scheduleId: null };
    jobEquipmentIds = ['eq-1']; // one machine → one set is exactly one log
    runTransaction = async (fn) => {
      await fn(conn);
      // The first run committed before the connection dropped.
      jobRow = { ...(jobRow as object), status: 'completed' } as Record<string, unknown>;
      return fn(conn);
    };

    await completeJob('job-1');

    expect(callsMatching('INSERT INTO service_logs')).toHaveLength(1);
  });

  it('closes fine when the linked appointment has been DELETED — the sheet outlives it', async () => {
    jobRow = { id: 'job-1', jobNo: '050926-22', jobDate: JOB_DATE, status: 'issued', scheduleId: 'sch-gone' };
    scheduleExists = false;

    await expect(completeJob('job-1')).resolves.not.toBeNull();

    const logs = callsMatching('INSERT INTO service_logs');
    expect(logs).toHaveLength(2);
    // NULL, not the dangling id: service_logs.scheduleId carries a real FK, so
    // a dangling value would fail the whole close.
    expect((logs[0][1] as unknown[])[1]).toBeNull();
    expect(callsMatching('UPDATE service_schedules')).toHaveLength(0);
  });

  it('writes the log with no schedule at all for a walk-in sheet', async () => {
    jobRow = { id: 'job-1', jobNo: '050926-22', jobDate: JOB_DATE, status: 'issued', scheduleId: null };
    await completeJob('job-1');
    expect((callsMatching('INSERT INTO service_logs')[0][1] as unknown[])[1]).toBeNull();
    expect(callsMatching('FROM service_schedules')).toHaveLength(0);
  });

  it('never advances calibrationDate — the work was handwritten, the system cannot read it', async () => {
    await completeJob('job-1');
    expect(callsMatching('calibrationDate')).toHaveLength(0);
    expect(callsMatching('customer_equipments')).toHaveLength(0);
  });

  it('files the typed-back work summary on the sheet and in every log', async () => {
    await completeJob('job-1', { workSummary: 'เปลี่ยนโหลดเซลล์ + สอบเทียบ' });
    const flip = callsMatching('UPDATE service_jobs')[0][1] as unknown[];
    expect(flip[1]).toBe('เปลี่ยนโหลดเซลล์ + สอบเทียบ');
    expect((callsMatching('INSERT INTO service_logs')[0][1] as unknown[])[6]).toBe(
      'เปลี่ยนโหลดเซลล์ + สอบเทียบ'
    );
  });

  it('keeps the existing summary when the close sends none', async () => {
    await completeJob('job-1');
    const flip = callsMatching('UPDATE service_jobs')[0][1] as unknown[];
    expect(flip[1]).toBeNull();
    expect(sqlOf(callsMatching('UPDATE service_jobs')[0])).toContain('COALESCE(?, workSummary)');
  });

  it('returns null for a sheet that does not exist', async () => {
    jobRow = null;
    expect(await completeJob('nope')).toBeNull();
    expect(callsMatching('INSERT INTO service_logs')).toHaveLength(0);
  });

  it('refuses to close a cancelled sheet', async () => {
    jobRow = { id: 'job-1', jobNo: '050926-22', jobDate: JOB_DATE, status: 'cancelled', scheduleId: null };
    await expect(completeJob('job-1')).rejects.toBeInstanceOf(ServiceJobNotEditableError);
    expect(callsMatching('INSERT INTO service_logs')).toHaveLength(0);
  });
});

// ── Editing, cancelling, deleting ────────────────────────────────────────────

describe('updateJob', () => {
  it('replaces the machine list without ever rewriting the job number', async () => {
    await updateJob('job-1', input({ equipmentIds: ['eq-2', 'eq-3'] }));

    const del = callsMatching('DELETE FROM service_job_equipments');
    expect(del).toHaveLength(1);
    expect(del[0][1]).toEqual(['job-1', 'eq-2', 'eq-3']);
    expect(sqlOf(del[0])).toContain('NOT IN');
    expect(sqlOf(callsMatching('UPDATE service_jobs')[0])).not.toContain('jobNo');
    expect(callsMatching('INSERT INTO used_docnos')).toHaveLength(0);
  });

  it('writes nothing to customer_equipments — the registry is read, never edited, by a job sheet', async () => {
    await updateJob('job-1', input({ equipmentIds: ['eq-1', 'eq-3'] }));
    // The ONLY statement this store may aim at the equipment registry is the
    // ownership SELECT. Any write here — a calibrationDate nudged forward above
    // all — would be the system guessing what the handwriting on the paper said.
    const registryCalls = callsMatching('customer_equipments');
    expect(registryCalls).toHaveLength(1);
    expect(sqlOf(registryCalls[0])).toMatch(/^\s*SELECT/);
    expect(callsMatching('calibrationDate')).toHaveLength(0);
  });

  it('refuses to edit a CLOSED sheet — it is already service history', async () => {
    jobRow = { id: 'job-1', status: 'completed' };
    await expect(updateJob('job-1', input())).rejects.toBeInstanceOf(ServiceJobNotEditableError);
    expect(callsMatching('UPDATE service_jobs')).toHaveLength(0);
  });

  it('refuses to edit a cancelled sheet, and returns null for a missing one', async () => {
    jobRow = { id: 'job-1', status: 'cancelled' };
    await expect(updateJob('job-1', input())).rejects.toBeInstanceOf(ServiceJobNotEditableError);
    jobRow = null;
    expect(await updateJob('job-1', input())).toBeNull();
  });


});

describe('cancelJob / deleteJob', () => {
  it('cancels an issued sheet but KEEPS its number claimed in the ledger', async () => {
    await cancelJob('job-1');
    expect(sqlOf(callsMatching('UPDATE service_jobs')[0])).toContain("status = 'cancelled'");
    expect(callsMatching('DELETE FROM used_docnos')).toHaveLength(0);
  });

  it('refuses to cancel a closed sheet — its logs would describe a visit the sheet denies', async () => {
    jobRow = { id: 'job-1', status: 'completed' };
    await expect(cancelJob('job-1')).rejects.toBeInstanceOf(ServiceJobNotEditableError);
    expect(callsMatching('UPDATE service_jobs')).toHaveLength(0);
  });

  it('deletes an issued sheet with its machine rows, and never its number', async () => {
    expect(await deleteJob('job-1')).toBe(true);
    expect(callsMatching('DELETE FROM service_job_equipments')).toHaveLength(1);
    expect(callsMatching('DELETE FROM service_jobs')).toHaveLength(1);
    expect(callsMatching('DELETE FROM used_docnos')).toHaveLength(0);
  });

  it('refuses to delete a CLOSED sheet — machines’ service history names it', async () => {
    jobRow = { id: 'job-1', status: 'completed' };
    await expect(deleteJob('job-1')).rejects.toBeInstanceOf(ServiceJobNotEditableError);
    expect(callsMatching('DELETE FROM service_jobs')).toHaveLength(0);
  });

  it('returns false for a sheet that is not there', async () => {
    jobRow = null;
    expect(await deleteJob('job-1')).toBe(false);
  });
});

// ── Reads ────────────────────────────────────────────────────────────────────

describe('reads', () => {
  const lastQuerySql = () => {
    const mock = query as unknown as ReturnType<typeof vi.fn>;
    return String(mock.mock.calls[mock.mock.calls.length - 1][0]);
  };

  it('getJob reports a DELETED appointment as scheduleExists:false instead of failing', async () => {
    jobRow = { id: 'job-1', jobNo: '050926-22', jobDate: JOB_DATE, status: 'issued', scheduleId: 'sch-gone' };
    scheduleExists = false;
    const job = await getJob('job-1');
    expect(job?.scheduleExists).toBe(false);
    expect(job?.scheduleId).toBe('sch-gone');
    expect(job?.equipments).toHaveLength(2);
  });

  it('getJob returns null when there is no such sheet', async () => {
    jobRow = null;
    expect(await getJob('nope')).toBeNull();
  });

  it('lists by createdAt, NEVER by job number (DDMMYY does not sort)', async () => {
    await listJobs();
    expect(lastQuerySql()).toContain('ORDER BY j.createdAt DESC');
    expect(lastQuerySql()).not.toContain('ORDER BY j.jobNo');
  });

  it('filters on status, customer and a date window, ignoring a malformed date', async () => {
    const mock = query as unknown as ReturnType<typeof vi.fn>;
    await listJobs({ status: 'completed', customerId: CUSTOMER, fromDate: '2026-09-01', toDate: 'nope' });
    const [sql, params] = mock.mock.calls[mock.mock.calls.length - 1];
    expect(String(sql)).toContain('j.status = ?');
    expect(String(sql)).toContain('j.jobDate >= ?');
    expect(String(sql)).not.toContain('j.jobDate <= ?');
    expect(params).toEqual(['completed', CUSTOMER, '2026-09-01']);
  });

  it('ignores a status outside the known set rather than filtering on garbage', async () => {
    const mock = query as unknown as ReturnType<typeof vi.fn>;
    await listJobs({ status: 'whatever' });
    expect(String(mock.mock.calls[mock.mock.calls.length - 1][0])).not.toContain('j.status = ?');
  });

  it('listJobsForEquipment asks for every sheet this machine has been on', async () => {
    const mock = query as unknown as ReturnType<typeof vi.fn>;
    await listJobsForEquipment('eq-1');
    const [sql, params] = mock.mock.calls[mock.mock.calls.length - 1];
    expect(String(sql)).toContain('sjel.equipmentId = ?');
    expect(String(sql)).toContain('ORDER BY j.createdAt DESC');
    expect(params).toEqual(['eq-1']);
  });
});
