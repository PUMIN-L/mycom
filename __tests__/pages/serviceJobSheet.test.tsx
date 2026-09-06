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

function mockFetch() {
  const fetchMock = vi.fn(async (url: string) => {
    if (url === '/api/companies')
      return { ok: true, json: async () => [COMPANY, OTHER_COMPANY] };
    if (url === '/api/customers')
      return { ok: true, json: async () => [CONTACT, OTHER_CONTACT] };
    if (url.startsWith('/api/admin/equipments?customerId='))
      return { ok: true, json: async () => [MACHINE, MACHINE_2] };
    if (url === '/api/settings/company-profile')
      return {
        ok: true,
        json: async () => ({ phone: '062-000-0000', addressDisplay: 'ที่อยู่จากการตั้งค่า' }),
      };
    return { ok: true, json: async () => [] };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
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

  it('carries a ruled description area and two signature blocks', async () => {
    render(<ServiceJobPage />);
    await screen.findByText('เครื่องในใบงานนี้');

    // Ruled, not blank: unlined paper makes handwriting drift and scans badly.
    const notes = document.getElementById('job-notes')!;
    expect(notes.querySelectorAll('.border-b').length).toBeGreaterThanOrEqual(5);

    const signatures = document.getElementById('job-signatures')!;
    expect(within(signatures as HTMLElement).getByText('ช่างผู้ปฏิบัติงาน')).toBeInTheDocument();
    expect(within(signatures as HTMLElement).getByText('ลูกค้าผู้รับบริการ')).toBeInTheDocument();
    // Each block: a signature line, a printed-name line and a date line.
    expect(within(signatures as HTMLElement).getAllByText('ชื่อตัวบรรจง')).toHaveLength(2);
    expect(
      within(signatures as HTMLElement).getAllByText(/วันที่ ______ \/ ______ \/ ______/)
    ).toHaveLength(2);
  });

  it('gives the ruled note area the page the machine table does not use', async () => {
    render(<ServiceJobPage />);
    await screen.findByText('เครื่องในใบงานนี้');

    // The lines are the writing room. A fixed count meant a one-machine sheet
    // printed six lines and left a third of the A4 page blank — paper the
    // technician carries to the site and cannot write on.
    const ruledRows = () =>
      document.getElementById('job-notes')!.querySelectorAll<HTMLElement>('div[style*="8.5mm"]')
        .length;

    const empty = ruledRows();
    expect(empty).toBeGreaterThanOrEqual(10);

    pick('เลือกบริษัท...', 'บจก. ตัวอย่าง');
    pick('เลือกผู้ติดต่อ...', 'คุณสมชาย');
    await screen.findByRole('button', { name: literal('เลือกเครื่องเพื่อเพิ่มลงในใบ') });
    pick('เลือกเครื่องเพื่อเพิ่มลงในใบ', 'เครื่องชั่ง XYZ');
    const oneMachine = ruledRows();

    pick('เลือกเครื่องเพื่อเพิ่มลงในใบ', 'เครื่องวัดความชื้น ABC');
    const twoMachines = ruledRows();

    // Each machine takes its own 17mm writing cell in the table, so the note
    // area gives room back as the table grows — and never shrinks to a token.
    expect(twoMachines).toBeLessThan(oneMachine);
    expect(twoMachines).toBeGreaterThanOrEqual(3);
    // Every row is a real ruled line: all but the last carry the rule itself.
    expect(
      document.getElementById('job-notes')!.querySelectorAll('.border-b').length
    ).toBe(twoMachines - 1);
  });

  it('leaves a RULED LINE, not an empty gap, where an unnamed technician signs', async () => {
    render(<ServiceJobPage />);
    await screen.findByText('เครื่องในใบงานนี้');

    const signatures = document.getElementById('job-signatures')!;
    // Two blocks, and with no technician name typed BOTH printed-name slots
    // carry a ruled blank for someone to write on at the site.
    expect(signatures.querySelectorAll('span.border-b').length).toBe(2);

    fireEvent.change(
      screen.getByPlaceholderText('เว้นว่างไว้ก็ได้ — ให้ช่างเขียนชื่อเองบนกระดาษ'),
      { target: { value: 'ช่างเอก' } }
    );
    // The technician's slot is now his name; the customer's stays a blank line.
    expect(
      document.getElementById('job-signatures')!.querySelectorAll('span.border-b').length
    ).toBe(1);
  });

  it('shows a placeholder instead of inventing a job number before the first save', async () => {
    render(<ServiceJobPage />);
    await screen.findByText('เครื่องในใบงานนี้');
    // The number is minted by the server inside the transaction that writes the
    // row. A number this page chose is a number two browsers could both choose.
    expect(screen.getByText('— ออกเลขที่เมื่อบันทึก —')).toBeInTheDocument();
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
    await screen.findByRole('button', { name: literal('เลือกเครื่องเพื่อเพิ่มลงในใบ') });
    pick('เลือกเครื่องเพื่อเพิ่มลงในใบ', 'เครื่องชั่ง XYZ');

    // On the sheet, in the หมายเลขเครื่อง column — never typed by the admin.
    const tbody = document.getElementById('job-tbody')!;
    expect(within(tbody as HTMLElement).getByText('SN-001')).toBeInTheDocument();

    // And there is no input anywhere holding it: a typed serial binds the
    // service history of this visit to the wrong physical machine.
    for (const input of Array.from(document.querySelectorAll('input'))) {
      expect((input as HTMLInputElement).value).not.toBe('SN-001');
    }
  });

  it('refuses the same machine twice, in Thai', async () => {
    render(<ServiceJobPage />);
    await screen.findByText('เครื่องในใบงานนี้');

    pick('เลือกบริษัท...', 'บจก. ตัวอย่าง');
    pick('เลือกผู้ติดต่อ...', 'คุณสมชาย');
    await screen.findByRole('button', { name: literal('เลือกเครื่องเพื่อเพิ่มลงในใบ') });
    pick('เลือกเครื่องเพื่อเพิ่มลงในใบ', 'เครื่องชั่ง XYZ');

    // The option is now disabled and says so, so the duplicate cannot even be
    // clicked — the composite PRIMARY KEY behind it is the last line, not the
    // only one.
    fireEvent.click(screen.getByRole('button', { name: literal('เลือกเครื่องเพื่อเพิ่มลงในใบ') }));
    const option = screen.getByRole('button', { name: /อยู่ในใบนี้แล้ว/ });
    expect(option).toBeDisabled();

    // One row on the sheet, not two.
    expect(document.getElementById('job-tbody')!.querySelectorAll('tr').length).toBe(1);
  });
});
