/**
 * "แก้ไข" on a นัดโทรลูกค้า card used to open the schedule-edit form (วันที่
 * นัด / ผู้รับผิดชอบ / หมายเหตุ) — the correct fix for the older bug where this
 * assumed every schedule has an `equipmentId` and fetched
 * `/api/admin/equipments/undefined`. The owner asked for something different:
 * pressing "แก้ไข" here should open that CUSTOMER's own profile instead, since
 * what he wants before making the call is the customer's info, not the
 * appointment's date field.
 *
 * Spec: openspec/changes/route-customer-call-edit-to-profile.
 */
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/crm/alerts",
  useRouter: () => ({ push: pushMock, replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
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

function stubFetch(alerts: Record<string, unknown>, equipmentById: Record<string, unknown> = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
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
      return { ok: true, status: 200, json: async () => [] } as unknown as Response;
    })
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  pushMock.mockClear();
});

describe("แก้ไข บนการ์ดนัดโทรลูกค้า — เปิดหน้าลูกค้า ไม่ใช่ฟอร์มแก้นัด", () => {
  it("นำทางไป /customers?customerId=<id> และไม่เปิดฟอร์มแก้นัดหมาย", async () => {
    stubFetch(
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
      })
    );
    render(<AlertsPage />);

    const editButton = await screen.findByRole("button", { name: /แก้ไข/ });
    fireEvent.click(editButton);

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/customers?customerId=cus-42"));
    expect(screen.queryByText("📞 แก้ไขนัดโทรลูกค้า")).not.toBeInTheDocument();
  });

  it("เข้ารหัส customerId ที่มีอักขระพิเศษให้ปลอดภัยใน URL", async () => {
    stubFetch(
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
      })
    );
    render(<AlertsPage />);

    const editButton = await screen.findByRole("button", { name: /แก้ไข/ });
    fireEvent.click(editButton);

    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith(
        `/customers?customerId=${encodeURIComponent("cus/with space")}`
      )
    );
  });

  // Regression: the equipment-scoped "กำหนดการ" card must keep its exact old
  // behaviour — this change only touches customer_call.
  it("การ์ดกำหนดการที่ผูกเครื่อง ยังไปหน้าอุปกรณ์เหมือนเดิม ไม่นำทางไปหน้าลูกค้า", async () => {
    stubFetch(
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
      { "eq-1": { id: "eq-1", productName: "เครื่องชั่ง", serialNumber: "SN-1" } }
    );
    render(<AlertsPage />);

    const editButton = await screen.findByRole("button", { name: /แก้ไข/ });
    fireEvent.click(editButton);

    await waitFor(() =>
      expect(
        vi.mocked(global.fetch).mock.calls.some(([u]) => String(u).includes("/api/admin/equipments/eq-1"))
      ).toBe(true)
    );
    // Never navigated to a customer profile for an equipment-scoped schedule.
    expect(pushMock).not.toHaveBeenCalledWith(expect.stringContaining("/customers?customerId="));
  });
});
