import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import ServiceJobPage from '@/app/service-job/page';

/**
 * ใบ Job — the printed sheet.
 *
 * These tests guard the three properties the PAPER depends on, all of which
 * look like styling and are therefore easy to "clean up" out of existence:
 *
 *   • the serial number is never typed — it is copied off the chosen machine,
 *   • the งานที่ทำ column and the description area are left blank to write in,
 *   • an unnamed technician prints as a RULED LINE, not an empty gap.
 *
 * Plus the auth gate, which is the difference between an internal document and
 * a customer list on the open web.
 */

const replace = vi.fn();
const push = vi.fn();

// The global mock in __tests__/setup.ts returns a FRESH router on every call,
// so a spy taken from it can never be asserted against.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push, prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/service-job',
  useSearchParams: () => new URLSearchParams(),
  notFound: vi.fn(),
  redirect: vi.fn(),
}));

let auth = { isLoggedIn: true, isLoading: false };
vi.mock('@/app/context/AuthContext', () => ({
  useAuth: () => auth,
}));

// ── Fixtures ─────────────────────────────────────────────────────────────────

const COMPANY = { id: 'co-1', name: 'บจก. ตัวอย่าง' };
const OTHER_COMPANY = { id: 'co-2', name: 'บจก. อื่น' };
const CONTACT = { id: 'cust-1', companyId: 'co-1', name: 'คุณสมชาย' };
const OTHER_CONTACT = { id: 'cust-2', companyId: 'co-2', name: 'คุณสมหญิง' };
const MACHINE = {
  id: 'eq-1',
  customerId: 'cust-1',
  productName: 'เครื่องชั่ง XYZ',
  serialNumber: 'SN-001',
};
const MACHINE_2 = {
  id: 'eq-2',
  customerId: 'cust-1',
  productName: 'เครื่องวัดความชื้น ABC',
  serialNumber: 'SN-002',
};

/** The sheet the server answers a save with. The job NUMBER on it is the
 *  server's, which is the whole point: nothing on the page may invent one. */
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

/** What GET /api/service-jobs/next-no answers with. A PREVIEW of the next free
 *  number — it reserves nothing, so it must never end up on the paper. */
let previewJobNo: string | null = '120926-30';
/** The sheet ?id= reopens, when a test sets one. */
let reopenedJob: Record<string, unknown> | null = null;

function mockFetch() {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/companies')
      return { ok: true, json: async () => [COMPANY, OTHER_COMPANY] };
    if (url === '/api/customers')
      return { ok: true, json: async () => [CONTACT, OTHER_CONTACT] };
    if (url.startsWith('/api/admin/equipments'))
      return { ok: true, json: async () => [MACHINE, MACHINE_2] };
    if (url === '/api/settings/company-profile')
      return {
        ok: true,
        json: async () => ({ phone: '062-000-0000', addressDisplay: 'ที่อยู่จากการตั้งค่า' }),
      };
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

/** The hydrate effect reads window.location.search directly (the page stays
 *  mounted across query-string changes), so deep links are driven from here. */
function setSearch(search: string) {
  window.history.replaceState({}, '', `/service-job${search}`);
}

/** A literal string as a regex. "เลือกบริษัท..." unescaped would also match
 *  the contact picker's "เลือกบริษัทก่อน", since `.` matches anything. */
const literal = (text: string) => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

/** Open a SearchableDropdown by the placeholder on its closed button, then
 *  click the option whose label contains `option`. */
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

// ── Auth gate ────────────────────────────────────────────────────────────────

describe('auth gate', () => {
  it('renders only a spinner and redirects when logged out — no customer data on screen', async () => {
    auth = { isLoggedIn: false, isLoading: false };
    render(<ServiceJobPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
    // The early return is the point: without it the form paints for a frame
    // and flashes company names and serial numbers before the redirect lands.
    expect(screen.queryByText('เครื่องในใบงานนี้')).not.toBeInTheDocument();
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('shows the spinner, not the form, while the session is still loading', () => {
    auth = { isLoggedIn: false, isLoading: true };
    render(<ServiceJobPage />);
    expect(replace).not.toHaveBeenCalled();
    expect(screen.queryByText('เครื่องในใบงานนี้')).not.toBeInTheDocument();
  });
});

// ── The printed sheet ────────────────────────────────────────────────────────

describe('the printed sheet', () => {
  it('prints the four columns, with งานที่ทำ present and EMPTY to write in', async () => {
    render(<ServiceJobPage />);
    await screen.findByText('เครื่องในใบงานนี้');

    const table = document.getElementById('job-table')!;
    const headers = within(table as HTMLElement)
      .getAllByRole('columnheader')
      .map((th) => th.textContent);
    expect(headers).toEqual(['ลำดับ', 'ชื่อเครื่อง', 'หมายเลขเครื่อง', 'งานที่ทำ']);
  });

  it('carries a description area and one customer signature block', async () => {
    render(<ServiceJobPage />);
    await screen.findByText('เครื่องในใบงานนี้');

    // Description area exists as a border box (no internal ruled lines).
    const notes = document.getElementById('job-notes')!;
    expect(notes).toBeInTheDocument();

    const signatures = document.getElementById('job-signatures')!;
    // Only customer signature block, technician removed.
    expect(within(signatures as HTMLElement).getByText('ลูกค้าผู้รับบริการ')).toBeInTheDocument();
    expect(within(signatures as HTMLElement).queryByText('ช่างผู้ปฏิบัติงาน')).toBeNull();
    // No 'ชื่อตัวบรรจง' text or parentheses.
    expect(within(signatures as HTMLElement).queryByText('ชื่อตัวบรรจง')).toBeNull();
    expect(
      within(signatures as HTMLElement).getAllByText(/วันที่ ______ \/ ______ \/ ______/)
    ).toHaveLength(1);
  });

  it('gives the ruled note area the page the machine table does not use', async () => {
    render(<ServiceJobPage />);
    await screen.findByText('เครื่องในใบงานนี้');

    // The lines are the writing room. A fixed count meant a one-machine sheet
    // printed six lines and left a third of the A4 page blank — paper the
    // technician carries to the site and cannot write on.
    const noteHeight = () => {
      const el = document.getElementById('job-notes')!.querySelector<HTMLElement>('div[style]');
      return el ? parseFloat(el.style.height) : 0;
    };

    const empty = noteHeight();
    expect(empty).toBeGreaterThanOrEqual(10 * 8.5);

    pick('เลือกบริษัท...', 'บจก. ตัวอย่าง');
    pick('เลือกผู้ติดต่อ...', 'คุณสมชาย');
    await screen.findByRole('button', { name: literal('เลือกเครื่องเพื่อเพิ่มลงในใบ...') });
    pick('เลือกเครื่องเพื่อเพิ่มลงในใบ...', 'เครื่องชั่ง XYZ');
    const oneMachine = noteHeight();

    pick('เลือกเครื่องเพื่อเพิ่มลงในใบ...', 'เครื่องวัดความชื้น ABC');
    const twoMachines = noteHeight();

    // Each machine takes its own 17mm writing cell in the table, so the note
    // area gives room back as the table grows — and never shrinks to a token.
    expect(twoMachines).toBeLessThan(oneMachine);
    expect(twoMachines).toBeGreaterThanOrEqual(3);
    // The note area is a single box whose height reflects the line count.
    expect(noteHeight()).toBe(twoMachines);
  });

  it('leaves a RULED LINE, not an empty gap, where the customer signs', async () => {
    render(<ServiceJobPage />);
    await screen.findByText('เครื่องในใบงานนี้');

    const signatures = document.getElementById('job-signatures')!;
    // Customer signature block has a ruled blank for writing a name.
    expect(signatures.querySelectorAll('span.border-b').length).toBe(1);
  });

  it('leaves the DOC NO. box saying so until the server has minted a number', async () => {
    render(<ServiceJobPage />);
    await screen.findByText('เครื่องในใบงานนี้');

    // The preview is an ESTIMATE — it reserves nothing. Printing it would put
    // a number on paper that the ledger may hand to somebody else.
    await screen.findByText('120926-30');
    const sheet = document.getElementById('job-sheet')!;
    expect(within(sheet).getByText('— ออกเลขที่เมื่อบันทึก —')).toBeInTheDocument();
    expect(within(sheet).queryByText('120926-30')).toBeNull();
  });
});

// ── The job number ───────────────────────────────────────────────────────────
//
// It is not a field: it is a claim on `used_docnos`, the never-purged ledger
// quotations (QT…) and billing (INV/BN/RC) also draw from. The page shows it
// and the server owns it.

describe('เลขที่ใบงาน (JOB NO.)', () => {
  it('offers NO way to type a job number', async () => {
    render(<ServiceJobPage />);
    await screen.findByText('เครื่องในใบงานนี้');

    // The old free-text field let an admin type `QT150926-03` and burn a
    // quotation number in the shared ledger, permanently.
    expect(screen.queryByPlaceholderText('ระบบจะสร้างให้อัตโนมัติ หรือพิมพ์เอง')).toBeNull();
    for (const box of screen.getAllByRole('textbox')) {
      expect((box as HTMLInputElement).value).not.toMatch(/^\d{6}-\d{2}$/);
    }
  });

  it('SHOWS what number the sheet will carry, straight from the ledger', async () => {
    render(<ServiceJobPage />);
    await screen.findByText('เครื่องในใบงานนี้');

    await waitFor(() =>
      expect(screen.getByTestId('job-no').textContent).toBe('120926-30')
    );
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      expect.stringContaining('/api/service-jobs/next-no?date=')
    );
    // …and says plainly that it is only an estimate until บันทึก.
    expect(screen.getByText(/ตัวอย่างเลขที่ถัดไป/)).toBeInTheDocument();
  });

  it('never sends a job number to the server — not even the previewed one', async () => {
    const fetchMock = vi.mocked(fetch);
    render(<ServiceJobPage />);
    await screen.findByText('เครื่องในใบงานนี้');

    pick('เลือกบริษัท...', 'บจก. ตัวอย่าง');
    pick('เลือกผู้ติดต่อ...', 'คุณสมชาย');
    await screen.findByRole('button', { name: literal('เลือกเครื่องเพื่อเพิ่มลงในใบ...') });
    pick('เลือกเครื่องเพื่อเพิ่มลงในใบ...', 'เครื่องชั่ง XYZ');

    fireEvent.click(screen.getByRole('button', { name: /บันทึกและออกเลขที่ใบ/ }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        (c) => c[0] === '/api/service-jobs' && (c[1] as RequestInit)?.method === 'POST'
      );
      expect(post).toBeTruthy();
      const body = JSON.parse(String((post![1] as RequestInit).body));
      expect(body.jobNo).toBeUndefined();
      expect(JSON.stringify(body)).not.toContain('120926-30');
    });

    // And the sheet then carries the number the SERVER minted.
    await waitFor(() => expect(screen.getByTestId('job-no').textContent).toBe('120926-22'));
  });

  it('REFUSES to print a sheet whose number the database has never seen', async () => {
    // A closed sheet cannot be saved, so there is no way to mint a number for
    // it here — and paper stamped with a number in no row of used_docnos is
    // paper nobody can close. Refuse, in Thai, rather than print it.
    reopenedJob = { ...SAVED_JOB, jobNo: '', status: 'completed' };
    setSearch('?id=job-1');
    render(<ServiceJobPage />);
    await screen.findByText('เครื่องในใบงานนี้');
    await waitFor(() => expect(screen.getAllByText(/ปิดงานแล้ว/).length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole('button', { name: /ดาวน์โหลด PDF/ }));
    expect(await screen.findByText(/ยังไม่มีเลขที่ใบงาน/)).toBeInTheDocument();
  });
});

// ── The chained pickers ──────────────────────────────────────────────────────

describe('บริษัท → ผู้ติดต่อ → เครื่อง', () => {
  it('uses no native <select> anywhere on the page (AGENTS.md)', async () => {
    render(<ServiceJobPage />);
    await screen.findByText('เครื่องในใบงานนี้');
    expect(document.querySelectorAll('select').length).toBe(0);
  });

  it('filters contacts to the chosen company', async () => {
    render(<ServiceJobPage />);
    await screen.findByText('เครื่องในใบงานนี้');

    pick('เลือกบริษัท...', 'บจก. ตัวอย่าง');
    fireEvent.click(screen.getByRole('button', { name: literal('เลือกผู้ติดต่อ...') }));
    expect(screen.getByText('คุณสมชาย')).toBeInTheDocument();
    // The other company's contact is not on the list — a sheet must never name
    // a contact who does not work at the company printed above him.
    expect(screen.queryByText('คุณสมหญิง')).not.toBeInTheDocument();
  });

  it('takes the serial number off the chosen machine and offers no field to type one', async () => {
    render(<ServiceJobPage />);
    await screen.findByText('เครื่องในใบงานนี้');

    pick('เลือกบริษัท...', 'บจก. ตัวอย่าง');
    pick('เลือกผู้ติดต่อ...', 'คุณสมชาย');
    await screen.findByRole('button', { name: literal('เลือกเครื่องเพื่อเพิ่มลงในใบ...') });
    pick('เลือกเครื่องเพื่อเพิ่มลงในใบ...', 'เครื่องชั่ง XYZ');

    // On the sheet, in the หมายเลขเครื่อง column — never typed by the admin.
    const tbody = document.getElementById('job-tbody')!;
    expect(within(tbody as HTMLElement).getByText('SN-001')).toBeInTheDocument();
  });

  it('refuses the same machine twice, in Thai', async () => {
    render(<ServiceJobPage />);
    await screen.findByText('เครื่องในใบงานนี้');

    pick('เลือกบริษัท...', 'บจก. ตัวอย่าง');
    pick('เลือกผู้ติดต่อ...', 'คุณสมชาย');
    await screen.findByRole('button', { name: literal('เลือกเครื่องเพื่อเพิ่มลงในใบ...') });
    pick('เลือกเครื่องเพื่อเพิ่มลงในใบ...', 'เครื่องชั่ง XYZ');

    // The option is now disabled and says so, so the duplicate cannot even be
    // clicked — the composite PRIMARY KEY behind it is the last line, not the
    // only one.
    fireEvent.click(screen.getByRole('button', { name: literal('เลือกเครื่องเพื่อเพิ่มลงในใบ...') }));
    const option = screen.getByRole('button', { name: /อยู่ในใบนี้แล้ว/ });
    expect(option).toBeDisabled();

    // One row on the sheet, not two.
    expect(document.getElementById('job-tbody')!.querySelectorAll('tr').length).toBe(1);
  });
});
