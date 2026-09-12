/**
 * ใกล้ถึงกำหนดสอบเทียบ — the tab must state the REAL backlog, not the length of
 * the capped list it was sent.
 *
 * The calibration list is capped at ALERT_ROW_CAP rows, because nothing ever
 * closes a calibration alert except recording a NEW calibrationDate, so the
 * backlog only grows. Capping the list without also reading
 * `nearingCalibrationTotal` puts a confident wrong number on the tab: the bell
 * (which already reads the total) would say 3,050 while this tab said 100, and
 * the 2,950 machines nobody can see would be the ones overdue the longest.
 *
 * Every other capped category on this page — ข้อมูลไม่ครบ, นัดโทรลูกค้า,
 * ลูกหนี้ค้างชำระ — already states its total and prints an "และอีก N รายการ"
 * line under the grid. These tests hold calibration to the same standard.
 */
import { render, screen, waitFor } from "@testing-library/react";
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
import { ALERT_LIST_DISPLAY_LIMIT } from "@/app/lib/alertThresholds";

/** `ALERT_ROW_CAP` machines on the wire, the most the route will ever send. */
function equipments(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `eq-${i}`,
    customerId: "c-1",
    productName: `เครื่องชั่ง ${i}`,
    serialNumber: `SN-${i}`,
    calibrationDate: "2025-01-15",
    status: "Active",
  }));
}

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

/** The tab strip button for ใกล้ถึงกำหนดสอบเทียบ, with its count. */
async function calibrationTabText() {
  const tab = await screen.findByRole("button", { name: /ใกล้ถึงกำหนดสอบเทียบ/ });
  return tab.textContent ?? "";
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("หน้าแจ้งเตือน — แท็บใกล้ถึงกำหนดสอบเทียบ", () => {
  it("บอกยอดจริงทั้งหมด ไม่ใช่จำนวนแถวที่ถูกตัดมา", async () => {
    // 100 rows on the wire, 3,050 machines actually overdue.
    stubFetch(
      alertsPayload({
        nearingCalibration: equipments(ALERT_LIST_DISPLAY_LIMIT),
        nearingCalibrationTotal: 3050,
      })
    );
    render(<AlertsPage />);

    await waitFor(async () => expect(await calibrationTabText()).toMatch(/3050|3,050/));
    // The capped length must NOT be what the admin reads.
    expect(await calibrationTabText()).not.toMatch(
      new RegExp(`\\b${ALERT_LIST_DISPLAY_LIMIT}\\b`)
    );
  });

  it("บอกจำนวนที่ไม่ได้แสดงไว้ใต้ตาราง เหมือนหมวดอื่นที่ถูกตัด", async () => {
    stubFetch(
      alertsPayload({
        nearingCalibration: equipments(ALERT_LIST_DISPLAY_LIMIT),
        nearingCalibrationTotal: 3050,
      })
    );
    render(<AlertsPage />);

    // 3050 - 100 = 2950 machines the admin is told about rather than silently
    // dropped.
    await screen.findByText(/และอีก 2950 รายการที่ใกล้ถึงกำหนดสอบเทียบ/);
  });

  it("ไม่ขึ้นบรรทัด 'และอีก' เมื่อไม่มีอะไรถูกตัด", async () => {
    stubFetch(
      alertsPayload({
        nearingCalibration: equipments(3),
        nearingCalibrationTotal: 3,
      })
    );
    render(<AlertsPage />);

    await waitFor(async () => expect(await calibrationTabText()).toMatch(/\b3\b/));
    expect(screen.queryByText(/และอีก .* ใกล้ถึงกำหนดสอบเทียบ/)).toBeNull();
  });
});

/**
 * The plain regression guard for the tab strip itself. Several fixes in this
 * round touched what these counts are computed from, so the cheapest thing
 * that can go wrong is a tab disappearing or a count going blank.
 */
describe("หน้าแจ้งเตือน — แถบแท็บทั้งแปด", () => {
  const TABS = [
    "ทั้งหมด",
    "กำหนดการ",
    "นัดโทรลูกค้า",
    "ประกันใกล้หมด",
    "ใกล้ถึงกำหนดสอบเทียบ",
    "ข้อมูลไม่ครบ",
    "เอกสารค้าง",
    "ลูกหนี้ค้างชำระ",
  ];

  it("ขึ้นครบทุกแท็บ พร้อมตัวเลขที่รวมยอดจริงของหมวดที่ถูกตัด", async () => {
    stubFetch(
      alertsPayload({
        expiringWarranties: equipments(2),
        nearingCalibration: equipments(ALERT_LIST_DISPLAY_LIMIT),
        nearingCalibrationTotal: 3050,
        incompleteEquipments: equipments(ALERT_LIST_DISPLAY_LIMIT),
        incompleteEquipmentsTotal: 140,
      })
    );
    render(<AlertsPage />);

    // ONE await for the strip to arrive, then read it synchronously: eight
    // separate `findByRole` calls each carry their own retry loop, which is
    // slow enough under a full-suite run to trip the 5s timeout.
    const all = await screen.findByRole("button", { name: /^ทั้งหมด/ });
    const labels = screen
      .getAllByRole("button")
      .map((b) => b.textContent ?? "");
    for (const label of TABS) {
      expect(
        labels.some((text) => text.includes(label)),
        label
      ).toBe(true);
    }

    // ทั้งหมด counts the TRUE totals of the capped categories, so it is the sum
    // of what is on screen plus every "และอีก N รายการ" line — never the sum of
    // the capped list lengths (which would read 242 here).
    expect(all.textContent).toMatch(/3192|3,192/); // 2 + 3050 + 140
  });
});
