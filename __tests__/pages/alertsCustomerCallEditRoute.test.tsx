/**
 * "แก้ไข" on a นัดโทรลูกค้า card used to open the schedule-edit form (วันที่
 * นัด / ผู้รับผิดชอบ / หมายเหตุ) — the correct fix for the older bug where this
 * assumed every schedule has an `equipmentId` and fetched
 * `/api/admin/equipments/undefined`. Then it opened the CUSTOMER's own
 * profile instead — right idea, wrong mechanism: `router.push` navigated away
 * to `/customers` entirely. The owner tested it live and asked to stay on
 * `/crm/alerts`: `CustomerDetailsModal` now opens IN PLACE, fetched with
 * `GET /api/customers/[id]`, the same shape `EquipmentDetailsModal` already
 * uses for the equipment-scoped cards on this same page.
 *
 * Spec: openspec/changes/open-customer-profile-in-place (supersedes
 * route-customer-call-edit-to-profile's navigation).
 */
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";

const pushMock = vi.fn();
// A STABLE object, unlike a fresh literal per call: the real next/navigation
// router keeps the same identity across renders, and `handleUnauthorized`
// (useCallback dep [router]) → `fetchTopics` → its own mount effect relies on
// that stability. A router mock that hands back a new object every call
// makes that effect re-fire every render — a real "Maximum update depth
// exceeded" loop, not a test artifact, that a stable mock avoids the same way
// the real implementation does.
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
// CustomerDetailsModal renders this; it owns its own network calls and is
// covered on its own (CustomerDetailsModal.test.tsx / customersDeepLink /
// customersQuickTaskButton) — here it would just be noise.
vi.mock("@/app/components/modals/CustomerCallScheduleSection", () => ({
  default: () => <div data-testid="call-schedule" />,
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

function stubFetch(
  alerts: Record<string, unknown>,
  {
    equipmentById = {},
    customerById = {},
  }: { equipmentById?: Record<string, unknown>; customerById?: Record<string, unknown> } = {}
) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("/api/admin/alerts")) {
      return { ok: true, status: 200, json: async () => alerts } as unknown as Response;
    }
    const eqMatch = url.match(/\/api\/admin\/equipments\/([^/?]+)/);
    if (eqMatch) {
      const eq = equipmentById[eqMatch[1]];
      return eq
        ? ({ ok: true, status: 200, json: async () => eq } as unknown as Response)
        : ({ ok: false, status: 404, json: async () => ({}) } as unknown as Response);
    }
    const custMatch = url.match(/\/api\/customers\/([^/?]+)/);
    if (custMatch) {
      const id = decodeURIComponent(custMatch[1]);
      const customer = customerById[id];
      return customer
        ? ({ ok: true, status: 200, json: async () => customer } as unknown as Response)
        : ({ ok: false, status: 404, json: async () => ({ error: "ไม่พบลูกค้า" }) } as unknown as Response);
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

describe("แก้ไข บนการ์ดนัดโทรลูกค้า — เปิดข้อมูลลูกค้าในหน้าเดิม ไม่นำทางออก", () => {
  it("เปิด CustomerDetailsModal ในหน้า /crm/alerts เดิม — ไม่นำทางไป /customers เลย", async () => {
    const fetchMock = stubFetch(
      alertsPayload({
        customerCallFollowUps: [
          {
            id: "sch-1",
            customerId: "cus-42",
            customerName: "คุณสมชาย",
            companyName: "บ.ทดสอบ",
            scheduledDate: "2026-09-20",
            notes: "โทรติดตามใบเสนอราคา",
            overdue: false,
          },
        ],
        customerCallFollowUpsTotal: 1,
      }),
      {
        customerById: {
          "cus-42": {
            id: "cus-42",
            companyId: "co1",
            companyName: "บ.ทดสอบ",
            name: "คุณสมชาย",
            department: "ฝ่ายจัดซื้อ",
            phone: "020000000",
            email: "somchai@example.com",
            note: "",
          },
        },
      }
    );
    render(<AlertsPage />);

    const editButton = await screen.findByRole("button", { name: /แก้ไข/ });
    fireEvent.click(editButton);

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => String(u) === "/api/customers/cus-42")).toBe(true)
    );
    expect(await screen.findByRole("heading", { name: "คุณสมชาย", level: 2 })).toBeInTheDocument();
    expect(screen.getByText("ฝ่ายจัดซื้อ")).toBeInTheDocument();

    // Never navigated anywhere (usePathname/useRouter are mocked, so a real
    // navigation would show up as a call to `push`, never a change of the
    // jsdom URL this test never sets), and never opened the old
    // schedule-edit form.
    expect(pushMock).not.toHaveBeenCalled();
    expect(screen.queryByText("📞 แก้ไขนัดโทรลูกค้า")).not.toBeInTheDocument();
  });

  it("เข้ารหัส customerId ที่มีอักขระพิเศษให้ปลอดภัยตอนยิง fetch", async () => {
    const fetchMock = stubFetch(
      alertsPayload({
        customerCallFollowUps: [
          {
            id: "sch-2",
            customerId: "cus/with space",
            customerName: "คุณสมหญิง",
            scheduledDate: "2026-09-21",
            overdue: false,
          },
        ],
        customerCallFollowUpsTotal: 1,
      }),
      {
        customerById: {
          "cus/with space": {
            id: "cus/with space",
            companyId: "co1",
            name: "คุณสมหญิง",
            department: "",
            phone: "",
            email: "",
            note: "",
          },
        },
      }
    );
    render(<AlertsPage />);

    fireEvent.click(await screen.findByRole("button", { name: /แก้ไข/ }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([u]) => String(u) === `/api/customers/${encodeURIComponent("cus/with space")}`
        )
      ).toBe(true)
    );
    expect(await screen.findByRole("heading", { name: "คุณสมหญิง", level: 2 })).toBeInTheDocument();
  });

  it("ลูกค้าที่อ้างถึงถูกลบไปแล้ว (404) — แจ้งเตือนแล้วไม่เปิด modal ไม่นำทางไปไหน", async () => {
    stubFetch(
      alertsPayload({
        customerCallFollowUps: [
          {
            id: "sch-3",
            customerId: "cus-gone",
            customerName: "คุณที่ถูกลบ",
            scheduledDate: "2026-09-22",
            overdue: false,
          },
        ],
        customerCallFollowUpsTotal: 1,
      }),
      { customerById: {} }
    );
    render(<AlertsPage />);

    fireEvent.click(await screen.findByRole("button", { name: /แก้ไข/ }));

    await waitFor(() =>
      expect(screen.getByText(/โหลดข้อมูลลูกค้าไม่สำเร็จ/)).toBeInTheDocument()
    );
    expect(screen.queryByRole("heading", { name: "คุณที่ถูกลบ", level: 2 })).not.toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  // Regression: the equipment-scoped "กำหนดการ" card must keep its exact old
  // behaviour — this change only touches customer_call.
  it("การ์ดกำหนดการที่ผูกเครื่อง ยังเปิดหน้าอุปกรณ์ในที่เดิมเหมือนเดิม ไม่ไปหน้าลูกค้า", async () => {
    const fetchMock = stubFetch(
      alertsPayload({
        upcomingSchedules: [
          {
            id: "sch-9",
            equipmentId: "eq-1",
            customerId: "cus-99",
            customerName: "คุณกำหนดการ",
            productName: "เครื่องชั่ง",
            scheduledDate: "2026-09-18",
            scheduleType: "calibration",
            overdue: false,
          },
        ],
      }),
      { equipmentById: { "eq-1": { id: "eq-1", productName: "เครื่องชั่ง", serialNumber: "SN-1" } } }
    );
    render(<AlertsPage />);

    fireEvent.click(await screen.findByRole("button", { name: /แก้ไข/ }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/api/admin/equipments/eq-1"))).toBe(true)
    );
    // Never fetched a customer, and never navigated for an equipment-scoped schedule.
    expect(fetchMock.mock.calls.some(([u]) => String(u).startsWith("/api/customers/"))).toBe(false);
    expect(pushMock).not.toHaveBeenCalled();
  });
});
