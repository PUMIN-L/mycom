import { render, screen, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import GlobalAdminBell from '@/app/components/GlobalAdminBell';

// ── Mocks ───────────────────────────────────────────────────────────────────
// The global setup mocks next/navigation with a fixed usePathname; this file
// needs to drive the path per test (the bell hides itself on /crm/alerts).
let mockPathname = '/crm';
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  notFound: vi.fn(),
  redirect: vi.fn(),
}));

let mockIsLoggedIn = true;
vi.mock('@/app/context/AuthContext', () => ({
  useAuth: () => ({ isLoggedIn: mockIsLoggedIn }),
}));

// ── Helpers ─────────────────────────────────────────────────────────────────

/** A full, current-shape alerts payload with every count at zero. */
function payload(over: Record<string, unknown> = {}) {
  return {
    expiringWarranties: [],
    nearingCalibration: [],
    nearingCalibrationTotal: 0,
    upcomingSchedules: [],
    incompleteEquipments: [],
    incompleteEquipmentsTotal: 0,
    missingDocuments: [],
    customerCallFollowUps: [],
    customerCallFollowUpsTotal: 0,
    overdueReceivables: [],
    overdueReceivablesTotal: 0,
    dueTaskCount: 0,
    ...over,
  };
}

function rows(n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: `r-${i}` }));
}

function mockFetchOnce(body: unknown, ok = true) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    json: async () => body,
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** The badge only renders when the count is > 0, so absence means zero. */
function badgeText(): string | null {
  const badge = document.querySelector('span.bg-red-600');
  return badge ? badge.textContent : null;
}

beforeEach(() => {
  mockPathname = '/crm';
  mockIsLoggedIn = true;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ── 15.1 / 15.2: the seven-value sum ────────────────────────────────────────

describe('GlobalAdminBell badge total', () => {
  it('sums all seven categories, including follow-up calls and due tasks', async () => {
    // 2 + 1 + 3 + 4 + 1 + 5 + 2 = 18 (spec scenario "นับรวมหมวดใหม่")
    mockFetchOnce(
      payload({
        expiringWarranties: rows(2),
        nearingCalibration: rows(1),
        nearingCalibrationTotal: 1,
        upcomingSchedules: rows(3),
        incompleteEquipments: rows(4),
        incompleteEquipmentsTotal: 4,
        missingDocuments: rows(1),
        customerCallFollowUps: rows(5),
        customerCallFollowUpsTotal: 5,
        dueTaskCount: 2,
      })
    );

    render(<GlobalAdminBell />);
    await waitFor(() => expect(badgeText()).toBe('18'));
  });

  it('uses customerCallFollowUpsTotal, not the display-capped array length', async () => {
    // The API caps the array at 100 rows but reports the true total.
    mockFetchOnce(
      payload({
        customerCallFollowUps: rows(100),
        customerCallFollowUpsTotal: 137,
      })
    );

    render(<GlobalAdminBell />);
    // 137, not 100 — and capped for display at 99+.
    await waitFor(() => expect(badgeText()).toBe('99+'));
  });

  it('falls back to customerCallFollowUps.length when the total is absent', async () => {
    const body = payload({ customerCallFollowUps: rows(3) });
    delete (body as Record<string, unknown>).customerCallFollowUpsTotal;
    mockFetchOnce(body);

    render(<GlobalAdminBell />);
    await waitFor(() => expect(badgeText()).toBe('3'));
  });

  it('counts a zero total rather than falling back to the array length', async () => {
    // ?? (not ||) matters: a true total of 0 must win over a non-empty array.
    mockFetchOnce(
      payload({
        customerCallFollowUps: rows(4),
        customerCallFollowUpsTotal: 0,
        expiringWarranties: rows(1),
      })
    );

    render(<GlobalAdminBell />);
    await waitFor(() => expect(badgeText()).toBe('1'));
  });
});

// ── 15.5: only tasks whose due date has arrived move the number ─────────────

describe('GlobalAdminBell due tasks', () => {
  it('adds dueTaskCount to the total', async () => {
    mockFetchOnce(payload({ dueTaskCount: 2 }));

    render(<GlobalAdminBell />);
    await waitFor(() => expect(badgeText()).toBe('2'));
  });

  it('does not move when the board only holds undated / future tasks', async () => {
    // Three board tasks exist (one undated, two due next week) but the backend
    // counts none of them as due, so the bell must stay empty.
    mockFetchOnce(payload({ dueTaskCount: 0 }));

    render(<GlobalAdminBell />);
    await waitFor(() => expect(screen.getByTitle(/CRM Alerts/)).toBeInTheDocument());
    expect(badgeText()).toBeNull();
  });
});

// ── 15.3: defensive reads against an old-version payload ───────────────────

describe('GlobalAdminBell defensive parsing', () => {
  it('treats missing new keys as 0 instead of NaN', async () => {
    // A pre-deploy build's response: no customerCallFollowUps*, no dueTaskCount.
    mockFetchOnce({
      expiringWarranties: rows(2),
      nearingCalibration: [],
      upcomingSchedules: [],
      incompleteEquipments: rows(1),
      incompleteEquipmentsTotal: 1,
      missingDocuments: [],
    });

    render(<GlobalAdminBell />);
    await waitFor(() => expect(badgeText()).toBe('3'));
  });

  it('survives an entirely empty payload', async () => {
    mockFetchOnce({});

    render(<GlobalAdminBell />);
    await waitFor(() => expect(screen.getByTitle(/CRM Alerts/)).toBeInTheDocument());
    expect(badgeText()).toBeNull();
  });
});

// ── 15.4: unchanged behaviour ──────────────────────────────────────────────

describe('GlobalAdminBell existing behaviour', () => {
  it('renders nothing on /crm/alerts', () => {
    mockPathname = '/crm/alerts';
    const fetchMock = mockFetchOnce(payload({ dueTaskCount: 5 }));

    const { container } = render(<GlobalAdminBell />);
    expect(container).toBeEmptyDOMElement();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('renders nothing when logged out', () => {
    mockIsLoggedIn = false;
    const fetchMock = mockFetchOnce(payload({ dueTaskCount: 5 }));

    const { container } = render(<GlobalAdminBell />);
    expect(container).toBeEmptyDOMElement();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the last number when a later request fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => payload({ dueTaskCount: 7 }) })
      .mockRejectedValueOnce(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.useFakeTimers({ shouldAdvanceTime: true });

    render(<GlobalAdminBell />);
    await waitFor(() => expect(badgeText()).toBe('7'));

    // The 5-minute poll fires and blows up; the badge must not reset to 0.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(badgeText()).toBe('7');
  });

  it('polls again every 5 minutes', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => payload({ dueTaskCount: 1 }) });
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers({ shouldAdvanceTime: true });

    render(<GlobalAdminBell />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4 * 60 * 1000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// ── The bell is mounted in app/layout.tsx, which wraps the PUBLIC site ──────

describe('GlobalAdminBell public pages', () => {
  const PUBLIC_PATHS = [
    '/',
    '/about',
    '/contact',
    '/catalog',
    '/catalog/ph-meter',
    '/showcase/abc-123',
    '/login',
    '/th/about',
    '/en',
    '/zh/catalog',
  ];

  for (const path of PUBLIC_PATHS) {
    it(`renders nothing — and fetches nothing — on the public page ${path}`, () => {
      mockPathname = path;
      const fetchMock = mockFetchOnce(payload({ overdueReceivablesTotal: 9, dueTaskCount: 4 }));

      const { container } = render(<GlobalAdminBell />);

      // A logged-in admin browsing the customer-facing site must not be shown
      // a floating badge of internal overdue-receivable / due-task counts on
      // top of the page a customer is looking at.
      expect(container).toBeEmptyDOMElement();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  }

  it('does not treat a public path that merely starts like an admin one as admin', () => {
    mockPathname = '/settings-public';
    const fetchMock = mockFetchOnce(payload({ dueTaskCount: 4 }));

    const { container } = render(<GlobalAdminBell />);
    expect(container).toBeEmptyDOMElement();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  const ADMIN_PATHS = [
    '/dashboard',
    '/crm',
    '/crm/customers',
    '/billing',
    '/billing/new',
    '/customers',
    '/documents',
    '/document/123',
    '/expenses',
    '/quotation',
    '/service-job',
    '/settings',
    '/suppliers',
    '/tools/pdf-editor',
    '/adminpanel',
    '/create-content',
    '/create-product',
    '/edit-product',
    '/product-specs',
    '/purchase-order',
  ];

  for (const path of ADMIN_PATHS) {
    it(`still renders and polls on the admin page ${path}`, async () => {
      mockPathname = path;
      const fetchMock = mockFetchOnce(payload({ dueTaskCount: 4 }));

      render(<GlobalAdminBell />);

      await waitFor(() => expect(badgeText()).toBe('4'));
      expect(fetchMock).toHaveBeenCalled();
    });
  }
});

// ── ใกล้ถึงกำหนดสอบเทียบ is capped for display like its siblings ───────────

describe('GlobalAdminBell — ใกล้ถึงกำหนดสอบเทียบ', () => {
  it('uses nearingCalibrationTotal, not the display-capped array length', async () => {
    // 3,000 machines carrying a stale calibration date; the API ships 100 rows
    // and the true count. Reading .length would say "100 things need doing".
    mockFetchOnce(payload({ nearingCalibration: rows(100), nearingCalibrationTotal: 3000 }));

    render(<GlobalAdminBell />);
    await waitFor(() => expect(badgeText()).toBe('99+'));
  });

  it('counts a true total of 0 over a non-empty array', async () => {
    mockFetchOnce(
      payload({
        nearingCalibration: rows(4),
        nearingCalibrationTotal: 0,
        missingDocuments: rows(2),
      })
    );

    render(<GlobalAdminBell />);
    await waitFor(() => expect(badgeText()).toBe('2'));
  });

  it('falls back to the array length when an old build answers without the total', async () => {
    const stale = payload({ nearingCalibration: rows(3) });
    delete (stale as Record<string, unknown>).nearingCalibrationTotal;
    mockFetchOnce(stale);

    render(<GlobalAdminBell />);
    await waitFor(() => expect(badgeText()).toBe('3'));
  });
});

describe('GlobalAdminBell — ลูกหนี้ค้างชำระ', () => {
  it('counts overdue receivables into the badge', async () => {
    mockFetchOnce(payload({ overdueReceivables: rows(3), overdueReceivablesTotal: 3 }));
    render(<GlobalAdminBell />);
    await waitFor(() => expect(badgeText()).toBe('3'));
  });

  it('uses overdueReceivablesTotal, not the display-capped array length', async () => {
    // Nothing closes this category but the money arriving, so the backlog can
    // run well past the 100-row display cap.
    mockFetchOnce(payload({ overdueReceivables: rows(100), overdueReceivablesTotal: 143 }));
    render(<GlobalAdminBell />);
    // 143, not 100 — and capped for display at 99+, like every other category.
    await waitFor(() => expect(badgeText()).toBe('99+'));
  });

  it('counts 0, not NaN, when an old build answers without the receivable keys', async () => {
    // A tab left open across a deploy is still talking to the previous build.
    const stale = payload();
    delete (stale as Record<string, unknown>).overdueReceivables;
    delete (stale as Record<string, unknown>).overdueReceivablesTotal;
    mockFetchOnce({ ...stale, missingDocuments: rows(2) });
    render(<GlobalAdminBell />);
    await waitFor(() => expect(badgeText()).toBe('2'));
  });
});

