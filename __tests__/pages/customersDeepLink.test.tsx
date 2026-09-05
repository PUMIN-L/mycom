import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Customers from '@/app/customers/page';

// ── Mocks ───────────────────────────────────────────────────────────────────
// Deep linking is the whole subject here, so the query string has to be driven
// per test — the global setup's useSearchParams is a fixed empty one.
let mockSearch = '';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/customers',
  useSearchParams: () => new URLSearchParams(mockSearch),
  notFound: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('@/app/context/AuthContext', () => ({
  useAuth: () => ({ isLoggedIn: true, isLoading: false }),
}));

// The equipment tab owns its own data, modals and URL reading; here it only
// needs to prove which tab the page selected.
vi.mock('@/app/customers/EquipmentTab', () => ({
  default: () => <div data-testid="equipment-tab" />,
}));

vi.mock('@/app/components/modals/CustomerCallScheduleSection', () => ({
  default: () => <div data-testid="call-schedule" />,
}));

vi.mock('@/app/lib/xlsxExport', () => ({ downloadExcel: vi.fn() }));

// ── Helpers ─────────────────────────────────────────────────────────────────

const CUSTOMER = {
  id: 'c1',
  companyId: 'co1',
  companyName: 'บริษัททดสอบ',
  name: 'สมชาย ใจดี',
  department: 'ฝ่ายแล็บ',
  phone: '020000000',
  email: 'somchai@example.com',
  note: '',
};

/** Routes by URL so the page's three list fetches and the equipment probe can
 *  answer differently — the equipment probe is the only 404 in play. */
function mockFetch() {
  const fetchMock = vi.fn(async (url: string) => {
    if (url.startsWith('/api/admin/equipments/')) {
      const id = url.slice('/api/admin/equipments/'.length);
      if (id === 'eq-1') return { ok: true, status: 200, json: async () => ({ id }) };
      return { ok: false, status: 404, json: async () => ({ error: 'ไม่พบอุปกรณ์' }) };
    }
    if (url === '/api/customers') return { ok: true, status: 200, json: async () => [CUSTOMER] };
    return { ok: true, status: 200, json: async () => [] };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Point the browser at a query string; the page rewrites window.location, so
 *  tests assert on it afterwards. */
function visit(search: string) {
  mockSearch = search;
  window.history.replaceState({}, '', `/customers${search ? `?${search}` : ''}`);
}

const NOT_FOUND_CUSTOMER = /ไม่พบลูกค้าที่ลิงก์อ้างถึง/;
const NOT_FOUND_EQUIPMENT = /ไม่พบเครื่องที่ลิงก์อ้างถึง/;
const LOAD_FAILED_CUSTOMER = /โหลดรายชื่อลูกค้าไม่สำเร็จ/;

beforeEach(() => {
  mockFetch();
  visit('');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe('customers page deep linking', () => {
  it('with no parameters, behaves exactly as before: customers tab, no notice', async () => {
    render(<Customers />);
    await waitFor(() => expect(screen.getByText('สมชาย ใจดี')).toBeInTheDocument());
    expect(screen.queryByTestId('equipment-tab')).not.toBeInTheDocument();
    expect(screen.queryByText(NOT_FOUND_CUSTOMER)).not.toBeInTheDocument();
    // No modal: the customer's name appears once, in the table row.
    expect(screen.queryByRole('heading', { name: 'สมชาย ใจดี' })).not.toBeInTheDocument();
  });

  it('opens the named customer from ?customerId=', async () => {
    visit('customerId=c1');
    render(<Customers />);
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'สมชาย ใจดี' })).toBeInTheDocument()
    );
    expect(screen.queryByText(NOT_FOUND_CUSTOMER)).not.toBeInTheDocument();
    // The parameter is consumed so closing the modal doesn't reopen it.
    expect(window.location.search).not.toContain('customerId');
  });

  it('accepts ?id= as the customer id when the tab is not the equipment one', async () => {
    visit('tab=customers&id=c1');
    render(<Customers />);
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'สมชาย ใจดี' })).toBeInTheDocument()
    );
  });

  it('says so plainly when the linked customer no longer exists, without breaking the page', async () => {
    visit('customerId=deleted-long-ago');
    render(<Customers />);
    await waitFor(() => expect(screen.getByText(NOT_FOUND_CUSTOMER)).toBeInTheDocument());
    // The page is otherwise entirely normal: the list still rendered.
    expect(screen.getByText('สมชาย ใจดี')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'สมชาย ใจดี' })).not.toBeInTheDocument();
  });

  it('still calls a dead id deleted when the customer list is legitimately empty', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => [] }))
    );
    visit('customerId=deleted-long-ago');
    render(<Customers />);
    await waitFor(() => expect(screen.getByText(NOT_FOUND_CUSTOMER)).toBeInTheDocument());
    expect(screen.queryByText(LOAD_FAILED_CUSTOMER)).not.toBeInTheDocument();
  });

  it('blames the failed load, not a deletion, when /api/customers errors out', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/customers') return { ok: false, status: 500, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => [] };
      })
    );
    visit('customerId=c1');
    render(<Customers />);
    await waitFor(() => expect(screen.getByText(LOAD_FAILED_CUSTOMER)).toBeInTheDocument());
    expect(screen.queryByText(NOT_FOUND_CUSTOMER)).not.toBeInTheDocument();
  });

  it('keeps the existing ?tab=equipment link working', async () => {
    visit('tab=equipment');
    render(<Customers />);
    await waitFor(() => expect(screen.getByTestId('equipment-tab')).toBeInTheDocument());
    expect(screen.queryByText(NOT_FOUND_EQUIPMENT)).not.toBeInTheDocument();
  });

  it('normalises ?equipmentId= into the form EquipmentTab already reads', async () => {
    visit('equipmentId=eq-1');
    render(<Customers />);
    await waitFor(() => expect(screen.getByTestId('equipment-tab')).toBeInTheDocument());
    expect(window.location.search).toBe('?tab=equipment&edit_eq=eq-1&action=view');
    await waitFor(() =>
      expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/admin/equipments/eq-1')
    );
    expect(screen.queryByText(NOT_FOUND_EQUIPMENT)).not.toBeInTheDocument();
  });

  it('says so plainly when the linked machine no longer exists', async () => {
    visit('equipmentId=purged');
    render(<Customers />);
    await waitFor(() => expect(screen.getByText(NOT_FOUND_EQUIPMENT)).toBeInTheDocument());
    // Still lands on the equipment tab rather than an error page.
    expect(screen.getByTestId('equipment-tab')).toBeInTheDocument();
    // EquipmentTab only clears these when it finds the machine, so the page
    // clears them itself — otherwise a refresh would replay the notice forever.
    expect(window.location.search).toBe('?tab=equipment');
  });

  it('leaves the notice alone when the existence probe fails on the network', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.startsWith('/api/admin/equipments/')) throw new Error('offline');
        if (url === '/api/customers') return { ok: true, status: 200, json: async () => [CUSTOMER] };
        return { ok: true, status: 200, json: async () => [] };
      })
    );
    visit('equipmentId=eq-1');
    render(<Customers />);
    await waitFor(() => expect(screen.getByTestId('equipment-tab')).toBeInTheDocument());
    expect(screen.queryByText(NOT_FOUND_EQUIPMENT)).not.toBeInTheDocument();
  });

  it('ignores an unknown tab value instead of blanking the page', async () => {
    visit('tab=nonsense');
    render(<Customers />);
    await waitFor(() => expect(screen.getByText('สมชาย ใจดี')).toBeInTheDocument());
    expect(screen.queryByTestId('equipment-tab')).not.toBeInTheDocument();
  });
});
