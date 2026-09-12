/**
 * 📞 นัดหมายโทรติดตาม on the customer page.
 *
 * The rule this file exists for: the date on the CARD and the date the EDIT
 * MODAL opens on must be the same day, on any machine. Dates are stored as
 * "YYYY-MM-DD" and `new Date("2026-09-05")` is parsed as UTC midnight, so west
 * of Greenwich the picker highlights the 4th — and clicking the highlighted day
 * writes 2026-09-04 back, moving the appointment a day earlier just for having
 * been opened. The whole app runs on Vercel (UTC) for a business in Bangkok, so
 * this class of bug has shipped here before.
 */

// Set BEFORE anything constructs a Date: a negative UTC offset is the only
// place the bug is visible, and CI runs in UTC.
process.env.TZ = "America/New_York";

import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/** The real picker is a full calendar; here it only has to report the Date it
 *  was handed and let a test pick a day. */
const datePickerProps: { selected?: Date | null }[] = [];
vi.mock("@/app/components/DatePicker", () => ({
  default: (props: { selected?: Date | null; onChange: (d: Date | null) => void }) => {
    datePickerProps.push({ selected: props.selected });
    return (
      <button
        type="button"
        data-testid="date-picker"
        onClick={() => props.onChange(props.selected ?? null)}
      >
        {props.selected ? props.selected.toISOString() : "ว่าง"}
      </button>
    );
  },
}));

import CustomerCallScheduleSection from "@/app/components/modals/CustomerCallScheduleSection";
import { toLocalDateString } from "@/app/lib/dateFormat";

const SCHEDULED_DATE = "2026-09-05";

const PENDING_CALL = {
  id: "s1",
  customerId: "cust-1",
  equipmentId: null,
  scheduleType: "phone_call",
  scheduledDate: SCHEDULED_DATE,
  status: "pending",
  notes: "โทรถามเรื่องใบเสนอราคา",
};

function mockFetch(schedules: unknown[]) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!init?.method && url.startsWith("/api/admin/schedules?customerId=")) {
      return { ok: true, json: async () => schedules } as unknown as Response;
    }
    return { ok: true, json: async () => ({}) } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** The last `selected` the picker was handed. */
function lastSelected(): Date | null | undefined {
  return datePickerProps[datePickerProps.length - 1]?.selected;
}

beforeEach(() => {
  datePickerProps.length = 0;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("CustomerCallScheduleSection — the edit picker opens on the stored day", () => {
  it("confirms the test environment is west of Greenwich, where the bug is visible", () => {
    // Guards the guard: in UTC the broken and correct parses coincide, and
    // every assertion below would pass against the old code.
    expect(new Date("2026-09-05").getDate()).toBe(4);
  });

  it("hands the picker the stored day as a LOCAL date, not UTC midnight", async () => {
    mockFetch([PENDING_CALL]);
    render(<CustomerCallScheduleSection customerId="cust-1" />);

    fireEvent.click(await screen.findByTitle("แก้ไขนัดหมาย"));
    await screen.findByTestId("date-picker");

    const selected = lastSelected()!;
    expect(selected).toBeInstanceOf(Date);
    // 5 September as the ADMIN's calendar reads it — the assertion that bites:
    // `new Date("2026-09-05")` lands on the 4th here.
    expect(selected.getFullYear()).toBe(2026);
    expect(selected.getMonth()).toBe(8);
    expect(selected.getDate()).toBe(5);
    expect(toLocalDateString(selected)).toBe(SCHEDULED_DATE);
  });

  it("does not move the appointment when the admin re-picks the highlighted day", async () => {
    // The real damage: the picker drew the 4th, the admin clicked it because it
    // looked right, and 2026-09-04 was saved over a 5 September appointment.
    const fetchMock = mockFetch([PENDING_CALL]);
    render(<CustomerCallScheduleSection customerId="cust-1" />);

    fireEvent.click(await screen.findByTitle("แก้ไขนัดหมาย"));
    fireEvent.click(await screen.findByTestId("date-picker")); // re-pick the shown day
    fireEvent.click(screen.getByRole("button", { name: /บันทึกข้อมูล/ }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) => String(url) === "/api/admin/schedules/s1")
      ).toBe(true)
    );
    const saveCall = fetchMock.mock.calls.find(
      ([url]) => String(url) === "/api/admin/schedules/s1"
    )!;
    const body = JSON.parse(String((saveCall[1] as RequestInit).body));
    expect(body.scheduledDate).toBe(SCHEDULED_DATE);
  });

  it("hands the picker null for a brand-new appointment rather than an invalid Date", async () => {
    mockFetch([]);
    render(<CustomerCallScheduleSection customerId="cust-1" />);

    fireEvent.click(await screen.findByRole("button", { name: /เพิ่มนัดหมาย/ }));
    await screen.findByTestId("date-picker");

    expect(lastSelected()).toBeNull();
  });
});
