/**
 * The warranty and calibration cards say how many days are left on Bangkok's
 * calendar, as the server's alert queries count. A due date parsed as UTC
 * midnight (07:00 in Bangkok) read "1 day left" on the due day itself before
 * 7 a.m. — lib/dateFormat.ts daysUntil.
 */
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/crm/alerts",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  notFound: vi.fn(),
  redirect: vi.fn(),
}));
vi.mock("@/app/context/AuthContext", () => ({
  useAuth: () => ({ isLoggedIn: true, isLoading: false }),
}));

import AlertsPage from "@/app/crm/alerts/page";

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

function stubFetch(alerts: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.startsWith("/api/admin/alerts") ? alerts : [];
      return { ok: true, status: 200, json: async () => body } as unknown as Response;
    })
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("/crm/alerts — days left, on Bangkok's calendar", () => {
  beforeEach(() => {
    // 03:00 on 7 Oct in Bangkok — still 6 Oct in UTC.
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-06T20:00:00.000Z") });
  });

  it("a warranty ending today is not \"1 day left\" before 7 a.m.", async () => {
    stubFetch(
      alertsPayload({
        expiringWarranties: [
          { id: "eq-1", customerId: "c-1", productName: "เครื่องชั่ง", serialNumber: "SN-1", warrantyEndDate: "2026-10-07", status: "Active" },
          { id: "eq-2", customerId: "c-1", productName: "เครื่องชั่ง 2", serialNumber: "SN-2", warrantyEndDate: "2026-10-09", status: "Active" },
        ],
      })
    );
    render(<AlertsPage />);
    await screen.findByText("SN-1", { exact: false });
    expect(screen.queryByText(/เหลือ 1 วัน/)).not.toBeInTheDocument();
    expect(screen.getByText(/เหลือ 2 วัน/)).toBeInTheDocument();
  });
});
