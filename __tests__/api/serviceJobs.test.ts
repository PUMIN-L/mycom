// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mocks ─────────────────────────────────────────────────────────────────────

// The routes must see the SAME error classes the store throws, because
// respondToJobError() maps them by `instanceof` — a mock that only shapes the
// functions would silently turn every Thai 400 into a 500.
vi.mock('@/app/lib/serviceJobStore', () => {
  class ServiceJobValidationError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'ServiceJobValidationError';
    }
  }
  class ServiceJobNotEditableError extends ServiceJobValidationError {
    constructor(message: string) {
      super(message);
      this.name = 'ServiceJobNotEditableError';
    }
  }
  return {
    listJobs: vi.fn(),
    listJobsForEquipment: vi.fn(),
    getJob: vi.fn(),
    createJob: vi.fn(),
    updateJob: vi.fn(),
    deleteJob: vi.fn(),
    completeJob: vi.fn(),
    cancelJob: vi.fn(),
    peekNextJobNo: vi.fn(),
    ServiceJobValidationError,
    ServiceJobNotEditableError,
  };
});
import {
  listJobs,
  listJobsForEquipment,
  getJob,
  createJob,
  updateJob,
  deleteJob,
  completeJob,
  cancelJob,
  peekNextJobNo,
  ServiceJobValidationError,
  ServiceJobNotEditableError,
} from '@/app/lib/serviceJobStore';

vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }));
import { getSession } from '@/app/lib/session';

import { GET as listRoute, POST as createRoute } from '@/app/api/service-jobs/route';
import {
  GET as getRoute,
  PUT as putRoute,
  DELETE as deleteRoute,
} from '@/app/api/service-jobs/[id]/route';
import { GET as nextNoRoute } from '@/app/api/service-jobs/next-no/route';
import { POST as completeRoute } from '@/app/api/service-jobs/[id]/complete/route';
import { POST as cancelRoute } from '@/app/api/service-jobs/[id]/cancel/route';

const admin = { userId: '1', username: 'admin', expiresAt: new Date() } as never;

const mutReq = (url: string, method: string, body?: unknown) =>
  new NextRequest(url, {
    method,
    headers: { origin: 'http://localhost:3000', host: 'localhost:3000' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const getReq = (url: string) => new NextRequest(url, { method: 'GET' });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

const BASE = 'http://localhost:3000/api/service-jobs';
const job = { id: 'job-1', jobNo: '050926-22', status: 'issued', equipments: [] };
const validBody = {
  companyId: 'co-1',
  customerId: 'cust-1',
  jobDate: '2026-09-05',
  equipmentIds: ['eq-1', 'eq-2'],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(admin);
});

// ── Auth ──────────────────────────────────────────────────────────────────────

describe('every ใบ Job route requires a session', () => {
  it('401s an anonymous read and write, and touches nothing', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await listRoute(getReq(BASE))).status).toBe(401);
    expect((await createRoute(mutReq(BASE, 'POST', validBody))).status).toBe(401);
    expect((await getRoute(getReq(`${BASE}/job-1`), ctx('job-1'))).status).toBe(401);
    expect(
      (await completeRoute(mutReq(`${BASE}/job-1/complete`, 'POST'), ctx('job-1'))).status
    ).toBe(401);
    expect(listJobs).not.toHaveBeenCalled();
    expect(createJob).not.toHaveBeenCalled();
    expect(completeJob).not.toHaveBeenCalled();
  });
});

// ── GET /api/service-jobs ─────────────────────────────────────────────────────

describe('GET /api/service-jobs', () => {
  it('passes the filters through', async () => {
    vi.mocked(listJobs).mockResolvedValue([]);
    const res = await listRoute(
      getReq(`${BASE}?status=completed&customerId=cust-1&from=2026-09-01&to=2026-09-30&search=JOB05&limit=10`)
    );
    expect(res.status).toBe(200);
    expect(listJobs).toHaveBeenCalledWith({
      status: 'completed',
      customerId: 'cust-1',
      companyId: undefined,
      fromDate: '2026-09-01',
      toDate: '2026-09-30',
      search: 'JOB05',
      limit: 10,
    });
  });

  it('lists everything when no filter is given', async () => {
    vi.mocked(listJobs).mockResolvedValue([]);
    await listRoute(getReq(BASE));
    expect(vi.mocked(listJobs).mock.calls[0][0]).toMatchObject({
      status: undefined,
      limit: undefined,
    });
  });

  // The equipment history view: "every sheet this ONE machine has been on".
  // It is a different query (it joins service_job_equipments), so it must not
  // fall through to the plain list, which knows nothing about machines and
  // would answer with EVERY sheet in the system.
  it('answers ?equipmentId= from the per-machine history query, not the plain list', async () => {
    vi.mocked(listJobsForEquipment).mockResolvedValue([]);
    const res = await listRoute(getReq(`${BASE}?equipmentId=eq-1&status=completed`));
    expect(res.status).toBe(200);
    expect(listJobsForEquipment).toHaveBeenCalledWith('eq-1');
    expect(listJobs).not.toHaveBeenCalled();
  });

  it('falls back to the plain list when equipmentId is blank', async () => {
    vi.mocked(listJobs).mockResolvedValue([]);
    await listRoute(getReq(`${BASE}?equipmentId=`));
    expect(listJobsForEquipment).not.toHaveBeenCalled();
    expect(listJobs).toHaveBeenCalled();
  });
});

// ── POST /api/service-jobs ────────────────────────────────────────────────────

describe('POST /api/service-jobs', () => {
  it('creates the sheet and answers 201', async () => {
    vi.mocked(createJob).mockResolvedValue(job as never);
    const res = await createRoute(mutReq(BASE, 'POST', validBody));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ jobNo: '050926-22' });
  });

  it('400s a sheet with no machine on it — neither picked nor typed', async () => {
    const res = await createRoute(mutReq(BASE, 'POST', { ...validBody, equipmentIds: [] }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('อย่างน้อย 1 เครื่อง');
    expect(createJob).not.toHaveBeenCalled();
  });

  // v39 lets a sheet carry machines that are not in the registry at all (the
  // technician is going to a customer whose machine nobody has entered yet).
  // The store permits equipmentIds: [] when custom entries are present, so a
  // shape check that refuses it makes that feature unreachable — the only way
  // in is this API.
  it('accepts a sheet whose machines are ALL typed by hand', async () => {
    vi.mocked(createJob).mockResolvedValue(job as never);
    const res = await createRoute(
      mutReq(BASE, 'POST', {
        ...validBody,
        equipmentIds: [],
        customEquipments: [{ productName: 'เครื่องชั่ง', serialNumber: 'X1' }],
      })
    );
    expect(res.status).toBe(201);
    expect(vi.mocked(createJob).mock.calls[0][0].customEquipments).toEqual([
      { productName: 'เครื่องชั่ง', serialNumber: 'X1' },
    ]);
  });

  it('carries the typed machines through to the store, sanitized', async () => {
    vi.mocked(createJob).mockResolvedValue(job as never);
    await createRoute(
      mutReq(BASE, 'POST', {
        ...validBody,
        customEquipments: [
          { productName: '<b>เครื่องชั่ง</b>', serialNumber: '<i>X1</i>' },
          { productName: '', serialNumber: '' },
        ],
      })
    );
    // The blank row is dropped — it would print as an empty line on the paper.
    expect(vi.mocked(createJob).mock.calls[0][0].customEquipments).toEqual([
      { productName: 'เครื่องชั่ง', serialNumber: 'X1' },
    ]);
  });

  it('leaves customEquipments UNDEFINED when the caller sent no such key', async () => {
    vi.mocked(createJob).mockResolvedValue(job as never);
    await createRoute(mutReq(BASE, 'POST', validBody));
    // undefined ≠ []: on a PUT the store reads it as "leave the column alone".
    // Folding it into [] is how an edit from a client with no typed-machine UI
    // silently blanks the ones another client wrote.
    expect(vi.mocked(createJob).mock.calls[0][0].customEquipments).toBeUndefined();
  });

  it('400s a malformed date — the column is compared and sorted lexically', async () => {
    for (const jobDate of ['05/09/2026', '2026-9-5', '', 'yesterday']) {
      const res = await createRoute(mutReq(BASE, 'POST', { ...validBody, jobDate }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain('YYYY-MM-DD');
    }
    expect(createJob).not.toHaveBeenCalled();
  });

  it('sanitizes every incoming value before it reaches the store', async () => {
    vi.mocked(createJob).mockResolvedValue(job as never);
    await createRoute(
      mutReq(BASE, 'POST', {
        ...validBody,
        technicianName: '  <b>ช่างสมชาย</b>  ',
        workSummary: '<img src=x onerror=alert(1)>เปลี่ยนโหลดเซลล์',
        equipmentIds: ['<i>eq-1</i>'],
      })
    );
    const passed = vi.mocked(createJob).mock.calls[0][0];
    expect(passed.technicianName).toBe('ช่างสมชาย');
    expect(passed.workSummary).toBe('เปลี่ยนโหลดเซลล์');
    expect(passed.equipmentIds).toEqual(['eq-1']);
  });

  it('keeps an empty technician name — the printed sheet gets a blank line for a pen', async () => {
    vi.mocked(createJob).mockResolvedValue(job as never);
    await createRoute(mutReq(BASE, 'POST', { ...validBody, technicianName: '' }));
    expect(vi.mocked(createJob).mock.calls[0][0].technicianName).toBe('');
  });

  // The route's own contract: "the job number is never accepted from the
  // client". `used_docnos` is ONE ledger shared with quotations and billing and
  // is never purged, so a number off the wire is written verbatim into it — a
  // client that posts 'QT150926-03' burns a quotation number for good, and two
  // clients can post the same number for the same day.
  it('DROPS a client-supplied job number instead of passing it to the store', async () => {
    vi.mocked(createJob).mockResolvedValue(job as never);
    await createRoute(
      mutReq(BASE, 'POST', { ...validBody, jobNo: 'QT150926-03' })
    );
    const passed = vi.mocked(createJob).mock.calls[0][0] as Record<string, unknown>;
    expect(passed.jobNo).toBeUndefined();
    expect(JSON.stringify(passed)).not.toContain('QT150926-03');
  });

  it('DROPS a client-supplied job number on an edit too', async () => {
    vi.mocked(updateJob).mockResolvedValue(job as never);
    await putRoute(
      mutReq(`${BASE}/job-1`, 'PUT', { ...validBody, jobNo: '999999-99' }),
      ctx('job-1')
    );
    const passed = vi.mocked(updateJob).mock.calls[0][1] as Record<string, unknown>;
    expect(passed.jobNo).toBeUndefined();
  });

  it('turns a store refusal into a THAI 400, not a 500', async () => {
    vi.mocked(createJob).mockRejectedValue(
      new ServiceJobValidationError('เครื่องที่เลือกไม่ได้เป็นของลูกค้ารายนี้ ใบ Job หนึ่งใบใช้ได้กับลูกค้ารายเดียว')
    );
    const res = await createRoute(mutReq(BASE, 'POST', validBody));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('ลูกค้ารายเดียว');
  });

  it('still 500s a REAL failure instead of dressing it up as the admin’s mistake', async () => {
    vi.mocked(createJob).mockRejectedValue(new Error('connection reset'));
    const res = await createRoute(mutReq(BASE, 'POST', validBody));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('สร้างใบ Job ไม่สำเร็จ');
  });
});

// ── /api/service-jobs/[id] ────────────────────────────────────────────────────

describe('GET/PUT/DELETE /api/service-jobs/[id]', () => {
  it('returns the sheet, and 404s one that does not exist', async () => {
    vi.mocked(getJob).mockResolvedValue(job as never);
    expect((await getRoute(getReq(`${BASE}/job-1`), ctx('job-1'))).status).toBe(200);

    vi.mocked(getJob).mockResolvedValue(null);
    const res = await getRoute(getReq(`${BASE}/nope`), ctx('nope'));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('ไม่พบใบ Job');
  });

  it('edits an issued sheet, and 404s a missing one', async () => {
    vi.mocked(updateJob).mockResolvedValue(job as never);
    expect((await putRoute(mutReq(`${BASE}/job-1`, 'PUT', validBody), ctx('job-1'))).status).toBe(200);

    vi.mocked(updateJob).mockResolvedValue(null);
    expect((await putRoute(mutReq(`${BASE}/nope`, 'PUT', validBody), ctx('nope'))).status).toBe(404);
  });

  it('400s an edit of a CLOSED sheet with the store’s Thai reason', async () => {
    vi.mocked(updateJob).mockRejectedValue(
      new ServiceJobNotEditableError('ใบงานที่ปิดแล้วแก้ไขไม่ได้ เพราะถูกบันทึกเป็นประวัติการเข้าบริการแล้ว')
    );
    const res = await putRoute(mutReq(`${BASE}/job-1`, 'PUT', validBody), ctx('job-1'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('ปิดแล้วแก้ไขไม่ได้');
  });

  it('400s an edit that empties the machine list, before it reaches the store', async () => {
    const res = await putRoute(
      mutReq(`${BASE}/job-1`, 'PUT', { ...validBody, equipmentIds: [] }),
      ctx('job-1')
    );
    expect(res.status).toBe(400);
    expect(updateJob).not.toHaveBeenCalled();
  });

  it('deletes an issued sheet, 404s a missing one, and 400s a closed one', async () => {
    vi.mocked(deleteJob).mockResolvedValue(true);
    expect((await deleteRoute(mutReq(`${BASE}/job-1`, 'DELETE'), ctx('job-1'))).status).toBe(200);

    vi.mocked(deleteJob).mockResolvedValue(false);
    expect((await deleteRoute(mutReq(`${BASE}/nope`, 'DELETE'), ctx('nope'))).status).toBe(404);

    vi.mocked(deleteJob).mockRejectedValue(
      new ServiceJobNotEditableError('ใบงานที่ปิดแล้วลบไม่ได้ เพราะเป็นประวัติการเข้าบริการของเครื่อง')
    );
    const res = await deleteRoute(mutReq(`${BASE}/job-1`, 'DELETE'), ctx('job-1'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('ประวัติการเข้าบริการ');
  });
});

// ── ปิดงาน ────────────────────────────────────────────────────────────────────

describe('POST /api/service-jobs/[id]/complete', () => {
  it('closes the sheet — this request, and only this one, writes the history', async () => {
    vi.mocked(completeJob).mockResolvedValue({ ...job, status: 'completed' } as never);
    const res = await completeRoute(mutReq(`${BASE}/job-1/complete`, 'POST'), ctx('job-1'));
    expect(res.status).toBe(200);
    expect(completeJob).toHaveBeenCalledWith('job-1', { workSummary: null });
  });

  it('accepts a close with NO body at all (the button sends none)', async () => {
    vi.mocked(completeJob).mockResolvedValue(job as never);
    const res = await completeRoute(
      new NextRequest(`${BASE}/job-1/complete`, {
        method: 'POST',
        headers: { origin: 'http://localhost:3000', host: 'localhost:3000' },
      }),
      ctx('job-1')
    );
    expect(res.status).toBe(200);
    expect(completeJob).toHaveBeenCalledWith('job-1', { workSummary: null });
  });

  it('sanitizes the typed-back work summary', async () => {
    vi.mocked(completeJob).mockResolvedValue(job as never);
    await completeRoute(
      mutReq(`${BASE}/job-1/complete`, 'POST', { workSummary: '<b>เช็คไฟ</b>' }),
      ctx('job-1')
    );
    expect(completeJob).toHaveBeenCalledWith('job-1', { workSummary: 'เช็คไฟ' });
  });

  it('404s a sheet that does not exist', async () => {
    vi.mocked(completeJob).mockResolvedValue(null);
    const res = await completeRoute(mutReq(`${BASE}/nope/complete`, 'POST'), ctx('nope'));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('ไม่พบใบ Job');
  });

  it('400s closing a cancelled sheet, in Thai', async () => {
    vi.mocked(completeJob).mockRejectedValue(
      new ServiceJobNotEditableError('ใบงานที่ยกเลิกแล้วปิดงานไม่ได้')
    );
    const res = await completeRoute(mutReq(`${BASE}/job-1/complete`, 'POST'), ctx('job-1'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('ใบงานที่ยกเลิกแล้วปิดงานไม่ได้');
  });
});

describe('POST /api/service-jobs/[id]/cancel', () => {
  it('cancels an issued sheet and 404s a missing one', async () => {
    vi.mocked(cancelJob).mockResolvedValue({ ...job, status: 'cancelled' } as never);
    expect((await cancelRoute(mutReq(`${BASE}/job-1/cancel`, 'POST'), ctx('job-1'))).status).toBe(200);

    vi.mocked(cancelJob).mockResolvedValue(null);
    expect((await cancelRoute(mutReq(`${BASE}/nope/cancel`, 'POST'), ctx('nope'))).status).toBe(404);
  });

  it('400s cancelling a CLOSED sheet — its logs would describe a visit it denies', async () => {
    vi.mocked(cancelJob).mockRejectedValue(
      new ServiceJobNotEditableError('ใบงานที่ปิดแล้วยกเลิกไม่ได้ เพราะถูกบันทึกเป็นประวัติการเข้าบริการแล้ว')
    );
    const res = await cancelRoute(mutReq(`${BASE}/job-1/cancel`, 'POST'), ctx('job-1'));
    expect(res.status).toBe(400);
  });
});

// ── GET /api/service-jobs/next-no ─────────────────────────────────────────────
//
// The screen has to be able to say what number the sheet will carry BEFORE it
// is printed — otherwise the only way to find out is to save. This is that
// answer, and it is an ESTIMATE: the real number is minted in the transaction.

describe('GET /api/service-jobs/next-no', () => {
  it('needs a session', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await nextNoRoute(getReq(`${BASE}/next-no?date=2026-09-05`));
    expect(res.status).toBe(401);
    expect(peekNextJobNo).not.toHaveBeenCalled();
  });

  it('answers the next free number for the date', async () => {
    vi.mocked(peekNextJobNo).mockResolvedValue('050926-03');
    const res = await nextNoRoute(getReq(`${BASE}/next-no?date=2026-09-05`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ jobNo: '050926-03' });
    expect(peekNextJobNo).toHaveBeenCalledWith('2026-09-05');
  });

  it('400s a malformed date in Thai rather than guessing one', async () => {
    vi.mocked(peekNextJobNo).mockRejectedValue(
      new ServiceJobValidationError('กรุณาระบุวันที่ให้ถูกต้อง (YYYY-MM-DD)')
    );
    const res = await nextNoRoute(getReq(`${BASE}/next-no?date=05/09/2026`));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('YYYY-MM-DD');
  });

  it('sanitizes the date before it reaches the store', async () => {
    vi.mocked(peekNextJobNo).mockResolvedValue('050926-01');
    await nextNoRoute(getReq(`${BASE}/next-no?date=${encodeURIComponent('<b>2026-09-05</b>')}`));
    expect(peekNextJobNo).toHaveBeenCalledWith('2026-09-05');
  });
});
