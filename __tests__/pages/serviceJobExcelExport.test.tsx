import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import ServiceJobPage from '@/app/service-job/page';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/service-job',
  useSearchParams: () => new URLSearchParams(),
  notFound: vi.fn(),
  redirect: vi.fn(),
}));

let auth = { isLoggedIn: true, isLoading: false };
vi.mock('@/app/context/AuthContext', () => ({
  useAuth: () => auth,
}));

const downloadDocumentFormExcelMock = vi.fn(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async (_filename: string, _sheetName: string, _opts: any) => {}
);
vi.mock('@/app/lib/documentFormExcel', () => ({
  downloadDocumentFormExcel: downloadDocumentFormExcelMock,
}));

const COMPANY = { id: 'co-1', name: 'บจก. ตัวอย่าง' };
const CONTACT = { id: 'cust-1', companyId: 'co-1', name: 'คุณสมชาย' };
const MACHINE = {
  id: 'eq-1',
  customerId: 'cust-1',
  productName: 'เครื่องชั่ง XYZ',
  serialNumber: 'SN-001',
};

const SAVED_JOB = {
  id: 'job-1',
  jobNo: '120926-22',
  status: 'issued',
  companyId: 'co-1',
  customerId: 'cust-1',
  jobDate: '2026-09-12',
  technicianName: '',
  scheduleId: null,
  equipments: [
    { equipmentId: 'eq-1', productName: 'เครื่องชั่ง XYZ', serialNumber: 'SN-001' },
  ],
};

let previewJobNo: string | null = '120926-30';
let reopenedJob: Record<string, unknown> | null = null;

function mockFetch() {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/companies') return { ok: true, json: async () => [COMPANY] };
    if (url === '/api/customers') return { ok: true, json: async () => [CONTACT] };
    if (url.startsWith('/api/admin/equipments')) return { ok: true, json: async () => [MACHINE] };
    if (url === '/api/settings/company-profile')
      return { ok: true, json: async () => ({ phone: '062-000-0000', addressDisplay: 'ที่อยู่จากการตั้งค่า' }) };
    if (url.startsWith('/api/service-jobs/next-no'))
      return previewJobNo === null
        ? { ok: false, json: async () => ({ error: 'ไม่สำเร็จ' }) }
        : { ok: true, json: async () => ({ jobNo: previewJobNo }) };
    if (url.startsWith('/api/service-jobs/') && !init)
      return reopenedJob
        ? { ok: true, json: async () => reopenedJob }
        : { ok: false, json: async () => ({ error: 'ไม่พบใบ Job' }) };
    if (url === '/api/service-jobs' && init?.method === 'POST')
      return { ok: true, json: async () => SAVED_JOB };
    return { ok: true, json: async () => [] };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function setSearch(search: string) {
  window.history.replaceState({}, '', `/service-job${search}`);
}

const literal = (text: string) => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

function pick(placeholder: string, option: string) {
  fireEvent.click(screen.getByRole('button', { name: literal(placeholder) }));
  const choices = screen.getAllByRole('button', { name: literal(option) });
  fireEvent.click(choices[choices.length - 1]);
}

beforeEach(() => {
  auth = { isLoggedIn: true, isLoading: false };
  previewJobNo = '120926-30';
  reopenedJob = null;
  setSearch('');
  vi.clearAllMocks();
  mockFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('/service-job — ดาวน์โหลด Excel', () => {
  it('saves the (unsaved) sheet first, then builds a form sheet under the server-minted job number', async () => {
    const fetchMock = mockFetch();
    render(<ServiceJobPage />);
    await screen.findByText('เครื่องในใบงานนี้');

    pick('เลือกบริษัท...', 'บจก. ตัวอย่าง');
    pick('เลือกผู้ติดต่อ...', 'คุณสมชาย');
    await screen.findByRole('button', { name: literal('เลือกเครื่องเพื่อเพิ่มลงในใบ...') });
    pick('เลือกเครื่องเพื่อเพิ่มลงในใบ...', 'เครื่องชั่ง XYZ');

    fireEvent.click(screen.getByRole('button', { name: /ดาวน์โหลด Excel/ }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => c[0] === '/api/service-jobs' && (c[1] as RequestInit)?.method === 'POST')).toBe(true)
    );
    await waitFor(() => expect(downloadDocumentFormExcelMock).toHaveBeenCalledTimes(1));

    const [filename, sheetName, opts] = downloadDocumentFormExcelMock.mock.calls[0];
    expect(filename).toBe('ServiceJob-120926-22.xlsx');
    expect(sheetName).toBe('ใบบันทึกงานบริการ');
    expect(opts.metaRows.some((m: { label: string; value: string }) => m.value === '120926-22')).toBe(true);
    expect(opts.items).toHaveLength(1);
    expect(opts.items[0]).toMatchObject({ name: 'เครื่องชั่ง XYZ', serial: 'SN-001' });
    // No money in this document.
    expect(opts.totals).toBeUndefined();
  });

  it('REFUSES to build an Excel sheet for a closed job whose number the database has never seen', async () => {
    reopenedJob = { ...SAVED_JOB, jobNo: '', status: 'completed' };
    setSearch('?id=job-1');
    render(<ServiceJobPage />);
    await screen.findByText('เครื่องในใบงานนี้');
    await waitFor(() => expect(screen.getAllByText(/ปิดงานแล้ว/).length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole('button', { name: /ดาวน์โหลด Excel/ }));
    expect(await screen.findByText(/ยังไม่มีเลขที่ใบงาน/)).toBeInTheDocument();
    expect(downloadDocumentFormExcelMock).not.toHaveBeenCalled();
  });
});
