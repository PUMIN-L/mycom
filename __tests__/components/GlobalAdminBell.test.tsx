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
    upcomingSchedules: [],
    incompleteEquipments: [],
    incompleteEquipmentsTotal: 0,
    missingDocuments: [],
    customerCallFollowUps: [],
    customerCallFollowUpsTotal: 0,
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
