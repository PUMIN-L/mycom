/**
 * /crm/alerts — "วางบิล" (the owner, 2026-11-23): an invoice whose วันวางบิล is
 * 7 days away or past, still owed and not yet on an issued billing note. Its
 * card says how far the day is, opens the invoice, offers to issue the
 * billing note, and can be snoozed like every other alert.
 */
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/crm/alerts",
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  notFound: vi.fn(),
  redirect: vi.fn(),
}));
vi.mock("@/app/context/AuthContext", () => ({
  useAuth: () => ({ isLoggedIn: true, isLoading: false }),
}));

import AlertsPage from "@/app/crm/alerts/page";

const card = (over: Record<string, unknown> = {}) => ({
  id: "d3",
  docNo: "INV2026110033",
  buyerName: "บริษัท เอ จำกัด",
  companyId: "co1",
  billingDate: "2026-11-25",
  owedSatang: 2033000,
  ...over,
});

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
    billingDue: [],
    billingDueTotal: 0,
    dueTaskCount: 0,
    ...over,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;
function stubFetch(alerts: Record<string, unknown>) {
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.startsWith("/api/admin/alerts") && !url.includes("snooze") ? alerts : url.includes("snooze") ? { success: true } : [];
    return { ok: true, status: 200, json: async () => body } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-23T05:00:00.000Z")); // noon in Bangkok
  push.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const theCard = async () => (await screen.findByText("INV2026110033")).closest("[data-testid='billing-due-card']") as HTMLElement;

describe("หน้าแจ้งเตือน — วางบิล", () => {
  it("has its tab, counting the true total", async () => {
    stubFetch(alertsPayload({ billingDue: [card()], billingDueTotal: 143 }));
    render(<AlertsPage />);
    const tab = await screen.findByRole("button", { name: /วางบิล/ });
    await waitFor(() => expect(tab.textContent).toMatch(/143/));
  });

  it("the card: the customer, the invoice, what is owed, and how far the day is", async () => {
    stubFetch(alertsPayload({ billingDue: [card()], billingDueTotal: 1 }));
    render(<AlertsPage />);
    const c = await theCard();
    expect(c.textContent).toContain("บริษัท เอ จำกัด");
    expect(c.textContent).toContain("20,330.00");
    expect(c.textContent).toContain("25 Nov 2026");
    expect(c.textContent).toContain("อีก 2 วันถึงวันวางบิล");
  });

  it("says when the day is today, and when it has passed — in red", async () => {
    stubFetch(alertsPayload({ billingDue: [card({ billingDate: "2026-11-23" }), card({ id: "d4", docNo: "INV2026110040", billingDate: "2026-11-20" })], billingDueTotal: 2 }));
    render(<AlertsPage />);
    expect((await theCard()).textContent).toContain("วางบิลวันนี้");
    const late = (await screen.findByText("INV2026110040")).closest("[data-testid='billing-due-card']") as HTMLElement;
    expect(within(late).getByText("เลยวันวางบิลมา 3 วัน").className).toContain("text-red-600");
  });

  it("opens the invoice; ออกใบวางบิล leads to a billing note for that customer", async () => {
    stubFetch(alertsPayload({ billingDue: [card()], billingDueTotal: 1 }));
    render(<AlertsPage />);
    const c = await theCard();
    const issue = within(c).getByRole("link", { name: "ออกใบวางบิล" });
    expect(issue.getAttribute("href")).toBe(`/accounting/billing-notes/new?companyId=co1&buyerName=${encodeURIComponent("บริษัท เอ จำกัด")}`);
    fireEvent.click(c);
    expect(push).toHaveBeenCalledWith("/accounting/invoices/d3");
  });

  it("is snoozed like the others — as a billing-date alert, without opening the invoice", async () => {
    stubFetch(alertsPayload({ billingDue: [card()], billingDueTotal: 1 }));
    render(<AlertsPage />);
    const c = await theCard();
    fireEvent.click(within(c).getByTitle("เลื่อนแจ้งเตือน"));
    expect(push).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "ยืนยัน" }));
    await waitFor(() => {
      const snooze = fetchMock.mock.calls.find(([u]) => String(u).includes("/api/admin/alerts/snooze"));
      expect(snooze).toBeDefined();
      expect(JSON.parse(String((snooze![1] as RequestInit).body))).toMatchObject({ alertType: "billing_date", referenceId: "d3" });
    });
  });
});
