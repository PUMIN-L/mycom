/**
 * /crm/alerts shows each alert's product name. That value is either the name
 * typed on the machine (plain text) or the catalog title (rich text), and the
 * page used to render it with dangerouslySetInnerHTML. Plain text now stores
 * `<` `>` `&` as characters (sanitizePlainText, v44), so it must be rendered as
 * TEXT: a name is never markup.
 */
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";

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

const equipment = (id: string, productName: string) => ({
  id,
  customerId: "c-1",
  productName,
  serialNumber: `SN-${id}`,
  calibrationDate: "2025-01-15",
  status: "Active",
});

function stubAlerts(nearingCalibration: unknown[]) {
  const alerts = {
    expiringWarranties: [],
    nearingCalibration,
    nearingCalibrationTotal: nearingCalibration.length,
    upcomingSchedules: [],
    incompleteEquipments: [],
    incompleteEquipmentsTotal: 0,
    missingDocuments: [],
    customerCallFollowUps: [],
    customerCallFollowUpsTotal: 0,
    overdueReceivables: [],
    overdueReceivablesTotal: 0,
    dueTaskCount: 0,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const body = String(input).startsWith("/api/admin/alerts") ? alerts : [];
      return { ok: true, status: 200, json: async () => body } as unknown as Response;
    })
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("/crm/alerts — product names are text", () => {
  it("reads a catalog title as text, with its entities decoded", async () => {
    stubAlerts([equipment("e1", "<p>Hardness &amp; Durometer</p>")]);
    render(<AlertsPage />);
    expect(await screen.findByText("Hardness & Durometer")).toBeDefined();
  });

  it("shows a typed name exactly as typed", async () => {
    stubAlerts([equipment("e2", "Balance 5 < 10 kg & more")]);
    render(<AlertsPage />);
    expect(await screen.findByText("Balance 5 < 10 kg & more")).toBeDefined();
  });

  it("never turns a name into markup", async () => {
    // A plain field can now hold these characters: sanitizePlainText decodes
    // "&lt;img …&gt;" typed into it to the text "<img …>".
    stubAlerts([equipment("e3", '<img src=x onerror="window.__alertXss=1">')]);
    const { container } = render(<AlertsPage />);
    await waitFor(() => expect(container.textContent).toContain("SN-e3"));
    expect(container.querySelector('img[src="x"]')).toBeNull();
    expect((window as unknown as { __alertXss?: number }).__alertXss).toBeUndefined();
  });
});
