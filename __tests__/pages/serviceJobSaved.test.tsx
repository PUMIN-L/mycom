import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import SavedServiceJobsPage from '@/app/service-job/saved/page';

/**
 * The register of printed job sheets, and the only place ปิดงาน is pressed.
 *
 * ปิดงาน is the moment the service history of every machine on the sheet is
 * written, so the two things worth pinning down here are that it goes through a
 * confirmation (nobody closes a sheet whose paper has not come back) and that a
 * refusal from the store reaches the screen as its own Thai sentence rather
 * than a generic failure.
 */

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/service-job/saved',
  useSearchParams: () => new URLSearchParams(),
  notFound: vi.fn(),
  redirect: vi.fn(),
}));

let auth = { isLoggedIn: true, isLoading: false };
vi.mock('@/app/context/AuthContext', () => ({ useAuth: () => auth }));

const OPEN_JOB = {
  id: 'job-1',
  jobNo: 'JOB050926-22',
  companyId: 'co-1',
  customerId: 'cust-1',
  jobDate: '2026-09-05',
  technicianName: '',
  status: 'issued' as const,
  completedAt: null,
  createdAt: '2026-09-05T02:00:00.000Z',
  equipmentCount: 2,
  customerName: 'คุณสมชาย',
  companyName: 'บจก. ตัวอย่าง',
};

let listResponse: unknown[] = [OPEN_JOB];
let actionResponse = { ok: true, body: {} as Record<string, unknown> };

function mockFetch() {
  const fetchMock = vi.fn(async (url: string) => {
    if (url.startsWith('/api/service-jobs?'))
      return { ok: true, json: async () => listResponse };
    return { ok: actionResponse.ok, json: async () => actionResponse.body };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  auth = { isLoggedIn: true, isLoading: false };
  listResponse = [OPEN_JOB];
  actionResponse = { ok: true, body: {} };
  vi.clearAllMocks();
  mockFetch();
});

afterEach(() => vi.unstubAllGlobals());

describe('ใบ Job ที่ออกแล้ว', () => {
  it('redirects a logged-out visitor and lists nothing', async () => {
    auth = { isLoggedIn: false, isLoading: false };
    render(<SavedServiceJobsPage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
    expect(screen.queryByText('JOB050926-22')).not.toBeInTheDocument();
  });

  it('shows the stored YYYY-MM-DD date through formatDisplayDate', async () => {
    render(<SavedServiceJobsPage />);
    // Stored "2026-09-05" (lexically sortable), READ as "5 Sep 2026".
    expect(await screen.findByText('5 Sep 2026')).toBeInTheDocument();
    expect(screen.queryByText('2026-09-05')).not.toBeInTheDocument();
  });

  it('names an unnamed technician as one to be written on the paper', async () => {
    render(<SavedServiceJobsPage />);
    expect(await screen.findByText('(เขียนเองหน้างาน)')).toBeInTheDocument();
  });

  it('puts ปิดงาน behind a confirmation that says what will be recorded', async () => {
    const fetchMock = mockFetch();
    render(<SavedServiceJobsPage />);
    await screen.findByText('JOB050926-22');

    fireEvent.click(screen.getByRole('button', { name: /ปิดงาน/ }));
    // The dialog names the machines whose history is about to be written.
    expect(screen.getByText(/ประวัติของเครื่องทั้ง 2 เครื่อง/)).toBeInTheDocument();
    // Nothing has been posted yet — the dialog is a decision, not a delay.
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).includes('/complete'))
    ).toHaveLength(0);

    listResponse = [{ ...OPEN_JOB, status: 'completed', completedAt: '2026-09-08T02:00:00.000Z' }];
    fireEvent.click(screen.getByRole('button', { name: 'ปิดงาน' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/service-jobs/job-1/complete', {
        method: 'POST',
      })
    );
    expect(await screen.findByText(/ปิดงาน JOB050926-22 แล้ว/)).toBeInTheDocument();
  });

  it("shows the store's own Thai refusal instead of a generic failure", async () => {
    listResponse = [{ ...OPEN_JOB, status: 'completed' }];
    render(<SavedServiceJobsPage />);
    await screen.findByText('JOB050926-22');
    // A completed sheet offers neither ปิดงาน nor ลบ — its logs are the service
    // history of real machines and name this job number.
    expect(screen.queryByRole('button', { name: /ปิดงาน/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ลบ/ })).not.toBeInTheDocument();
  });

  it('surfaces a refused delete with the reason the store gave', async () => {
    listResponse = [{ ...OPEN_JOB, status: 'cancelled' }];
    const fetchMock = mockFetch();
    render(<SavedServiceJobsPage />);
    await screen.findByText('JOB050926-22');

    fireEvent.click(screen.getByTitle('ลบใบที่ยกเลิกแล้ว'));
    actionResponse = { ok: false, body: { error: 'ใบงานที่ปิดแล้วลบไม่ได้ เพราะเป็นประวัติการเข้าบริการของเครื่อง' } };
    fireEvent.click(screen.getByRole('button', { name: 'ลบใบงาน' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/service-jobs/job-1', { method: 'DELETE' }));
    expect(
      await screen.findByText(/ใบงานที่ปิดแล้วลบไม่ได้/)
    ).toBeInTheDocument();
  });
});
