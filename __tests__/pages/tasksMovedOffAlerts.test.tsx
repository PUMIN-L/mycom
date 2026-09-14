/**
 * The "สิ่งที่ต้องทำ" board moved off `/crm/alerts` onto its own page at
 * `/crm/tasks` (spec: move-task-board-to-own-page) — this file asserts the
 * seam between the two pages: `/crm/alerts` no longer fetches or renders
 * anything board-related and instead shows a link to `/crm/tasks` TWICE
 * (once in the header actions row, once as a card in the exact spot the
 * inline board used to occupy — a later, separate request added the header
 * one so the page top has a way there without scrolling past the whole
 * feed), both badged with the same `dueTaskCount` the board's old floating
 * jump button used to show; `/crm/tasks` renders the board itself and a way
 * back to `/crm/alerts`.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";

const pushMock = vi.fn();
const routerMock = { push: pushMock, replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() };
vi.mock("next/navigation", () => ({
  usePathname: () => "/crm/alerts",
  useRouter: () => routerMock,
  useSearchParams: () => new URLSearchParams(),
  notFound: vi.fn(),
  redirect: vi.fn(),
}));
vi.mock("@/app/context/AuthContext", () => ({
  useAuth: () => ({ isLoggedIn: true, isLoading: false }),
}));

import AlertsPage from "@/app/crm/alerts/page";
import TasksPage from "@/app/crm/tasks/page";

function alertsPayload(over: Record<string, unknown> = {}) {
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

function stubFetch(payload: Record<string, unknown>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("/api/admin/alerts")) {
      return { ok: true, status: 200, json: async () => payload } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => [] } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  pushMock.mockClear();
});

describe("/crm/alerts — the board is gone, replaced by a button to /crm/tasks", () => {
  it("never fetches tasks/topics — nothing board-related is rendered inline anymore", async () => {
    const fetchMock = stubFetch(alertsPayload());
    render(<AlertsPage />);

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => String(u).startsWith("/api/admin/alerts"))).toBe(true)
    );

    expect(screen.queryByRole("button", { name: /สร้างงานใหม่/ })).not.toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([u]) => String(u).startsWith("/api/admin/tasks"))
    ).toBe(false);
    expect(
      fetchMock.mock.calls.some(([u]) => String(u).startsWith("/api/admin/task-topics"))
    ).toBe(false);
  });

  it("shows two badged links to /crm/tasks (header + bottom card) when there are due tasks", async () => {
    stubFetch(alertsPayload({ dueTaskCount: 4 }));
    render(<AlertsPage />);

    const links = await screen.findAllByRole("link", { name: /ไปที่หน้าสิ่งที่ต้องทำ/ });
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link).toHaveAttribute("href", "/crm/tasks");
      expect(within(link).getByText("4")).toBeInTheDocument();
    }
  });

  it("shows no badge on either link when there are no due tasks", async () => {
    stubFetch(alertsPayload({ dueTaskCount: 0 }));
    render(<AlertsPage />);

    const links = await screen.findAllByRole("link", { name: /ไปที่หน้าสิ่งที่ต้องทำ/ });
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link).toHaveAttribute("href", "/crm/tasks");
      expect(within(link).queryByText("0")).not.toBeInTheDocument();
    }
  });
});

describe("/crm/tasks — the board's new home", () => {
  it("renders the board and a way back to /crm/alerts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.startsWith("/api/admin/task-topics")) {
          return { ok: true, status: 200, json: async () => [] } as unknown as Response;
        }
        return { ok: true, status: 200, json: async () => [] } as unknown as Response;
      })
    );
    render(<TasksPage />);

    expect(await screen.findByRole("button", { name: /สร้างงานใหม่/ })).toBeInTheDocument();
    const back = screen.getByRole("link", { name: /กลับไปหน้าแจ้งเตือน/ });
    expect(back).toHaveAttribute("href", "/crm/alerts");
  });
});
