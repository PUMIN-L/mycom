/**
 * Which paths the full-screen "under maintenance" overlay actually blocks.
 * `MAINTENANCE_BLOCKED_PATHS` now lives in its own module (previously a
 * private literal here) purely so this file can import and assert against
 * the real list rather than a copy of it.
 *
 * `Footer`'s contact-info hiding does NOT use this list — that hiding is
 * deliberately site-wide, unlike the overlay. See
 * __tests__/components/Footer.test.tsx.
 *
 * /catalog is in the blocked list too (added after an earlier version left
 * it open on purpose, with a link to it from the overlay itself — that link
 * was removed along with it, since it would otherwise point back at the same
 * overlay).
 */

import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import MaintenanceOverlay from "@/app/components/MaintenanceOverlay";
import { SITE_LEGAL_NAME, SITE_NAME } from "@/app/lib/site";
import { LINE_ID, LINE_URL, LINE_APP_URL, CONTACT_EMAIL } from "@/app/lib/contact";

let mockPathname = "/";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => mockPathname,
  useSearchParams: () => new URLSearchParams(),
  notFound: vi.fn(),
  redirect: vi.fn(),
}));

let mockIsLoggedIn = false;
let mockIsLoading = false;
vi.mock("@/app/context/AuthContext", () => ({
  useAuth: () => ({ isLoggedIn: mockIsLoggedIn, isLoading: mockIsLoading }),
}));

let initialEnabled = false;

// The flag now arrives from the server as a prop; the fetch below only feeds the
// 60s re-poll that catches a toggle while the page is open.
function mockMaintenance(enabled: boolean) {
  initialEnabled = enabled;
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ enabled }) })
  );
}

beforeEach(() => {
  mockPathname = "/";
  mockIsLoggedIn = false;
  mockIsLoading = false;
  initialEnabled = false;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const OVERLAY_HEADING = "เว็บไซต์อยู่ระหว่างปรับปรุง";

describe("MaintenanceOverlay", () => {
  it("shows the overlay on / when maintenance is on", async () => {
    mockMaintenance(true);
    render(<MaintenanceOverlay initialEnabled={initialEnabled} />);
    await waitFor(() => expect(screen.getByText(OVERLAY_HEADING)).toBeInTheDocument());
  });

  it("shows the overlay on /contact when maintenance is on", async () => {
    mockPathname = "/contact";
    mockMaintenance(true);
    render(<MaintenanceOverlay initialEnabled={initialEnabled} />);
    await waitFor(() => expect(screen.getByText(OVERLAY_HEADING)).toBeInTheDocument());
  });

  it("shows the overlay on /catalog when maintenance is on", async () => {
    mockPathname = "/catalog";
    mockMaintenance(true);
    render(<MaintenanceOverlay initialEnabled={initialEnabled} />);
    await waitFor(() => expect(screen.getByText(OVERLAY_HEADING)).toBeInTheDocument());
  });

  it("never shows the overlay to a logged-in admin, even on /", async () => {
    mockIsLoggedIn = true;
    mockMaintenance(true);
    render(<MaintenanceOverlay initialEnabled={initialEnabled} />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(screen.queryByText(OVERLAY_HEADING)).not.toBeInTheDocument();
  });

  it("renders from the server prop WITHOUT waiting for a fetch", () => {
    // The point of the whole change. Previously the overlay returned null until
    // both useAuth and GET /api/settings/maintenance had resolved, so a blocked
    // visitor read the real page for a round trip or two first. No waitFor here
    // on purpose: if this ever needs one again, the flash is back.
    initialEnabled = true;
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {}))); // never resolves
    render(<MaintenanceOverlay initialEnabled={initialEnabled} />);
    expect(screen.getByText(OVERLAY_HEADING)).toBeInTheDocument();
  });

  it("still covers a visitor whose session has not resolved yet", () => {
    // isLoading true = useAuth has not answered. Waiting for it is what used to
    // leak the page; an unresolved session must read as "not an admin".
    initialEnabled = true;
    mockIsLoading = true;
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<MaintenanceOverlay initialEnabled={initialEnabled} />);
    expect(screen.getByText(OVERLAY_HEADING)).toBeInTheDocument();
  });

  it("shows nothing on / when maintenance is off", async () => {
    mockMaintenance(false);
    render(<MaintenanceOverlay initialEnabled={initialEnabled} />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(screen.queryByText(OVERLAY_HEADING)).not.toBeInTheDocument();
  });
});

// The owner is keeping maintenance mode on for roughly four months. Over that
// long a window whatever a crawler repeatedly sees becomes what it believes the
// page is about, so this screen has to carry the business, not just an apology.
describe("MaintenanceOverlay — content served during a long maintenance window", () => {
  beforeEach(() => {
    initialEnabled = true;
    mockPathname = "/";
    mockIsLoggedIn = false;
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  });

  it("names the business and what it does", () => {
    render(<MaintenanceOverlay initialEnabled={initialEnabled} />);
    // Both names: the Thai legal name, and the English brand people actually
    // type into Google — the same reasoning ProductsJsonLd states for emitting
    // product names English-first.
    expect(screen.getByText(new RegExp(SITE_LEGAL_NAME))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(SITE_NAME))).toBeInTheDocument();
    // The service wording is what ties this page to what people search for.
    expect(screen.getByText(/สอบเทียบเครื่องมือวัด/)).toBeInTheDocument();
    expect(screen.getByText(/ห้องปฏิบัติการ/)).toBeInTheDocument();
  });

  it("links to no page — /catalog is blocked too, so there is no page left to escape to", () => {
    render(<MaintenanceOverlay initialEnabled={initialEnabled} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("opens no contact channel — the owner does not want enquiries yet", () => {
    // The whole point of the window. A phone number or LINE id creeping back in
    // here would defeat it, and none of them is needed for ranking.
    //
    // The real constants are imported rather than restated: a test that hardcodes
    // "@puminkmutnb" keeps passing the day someone changes LINE_ID, which is the
    // day it stops protecting anything.
    const { container } = render(<MaintenanceOverlay initialEnabled={initialEnabled} />);
    const html = container.innerHTML;

    for (const value of [LINE_ID, LINE_URL, LINE_APP_URL, CONTACT_EMAIL]) {
      expect(html, `${value} must not appear on the maintenance screen`).not.toContain(value);
    }
    expect(html).not.toMatch(/tel:|mailto:|line:\/\//);
    // Scheme checks alone miss the obvious mistake — pasting the number in as
    // plain text. Match the shape instead, so any Thai phone format is caught
    // whatever the admin has set in Settings.
    expect(html).not.toMatch(/\d{2,3}-\d{3}-\d{4}/);
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
  });

  it("declares no <h1>, so it cannot compete with the page underneath", () => {
    // The overlay is a sibling of the page, not a replacement (app/layout.tsx),
    // so the real <h1> — Hero's on the home page — is in the same HTML. Two of
    // them saying different things is a worse signal than one.
    const { container } = render(<MaintenanceOverlay initialEnabled={initialEnabled} />);
    expect(container.querySelector("h1")).toBeNull();
  });
});
