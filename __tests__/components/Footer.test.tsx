/**
 * Contact-info hiding during maintenance mode is deliberately SITE-WIDE —
 * every page Footer is mounted on (/, /contact, /catalog, /about,
 * /showcase/[id]), not just the two paths `MaintenanceOverlay` full-screen
 * blocks. `/catalog` etc. stay browsable on purpose, but every route to
 * actually reach the company (phone, LINE) disappears from them too.
 *
 * (An earlier version of this fix scoped the hiding to match the overlay's
 * blocked paths, on the assumption that a page left open should stay fully
 * open. The owner corrected that: the intent is the opposite.)
 */

import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Footer from "@/app/components/Footer";

let mockPathname = "/";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => mockPathname,
  useSearchParams: () => new URLSearchParams(),
  notFound: vi.fn(),
  redirect: vi.fn(),
}));

let mockIsLoggedIn = false;
vi.mock("@/app/context/AuthContext", () => ({
  useAuth: () => ({ isLoggedIn: mockIsLoggedIn, user: null, logout: vi.fn() }),
}));

const BASE_PROPS = { email: "sales@profinlab.co.th", phone: "02-000-0000", address: "บางกอก" };
let PROPS = { ...BASE_PROPS, maintenanceOn: false };

// The flag is a server-rendered prop now, not a client fetch.
function mockMaintenance(enabled: boolean) {
  PROPS = { ...BASE_PROPS, maintenanceOn: enabled };
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ enabled }) })
  );
}

beforeEach(() => {
  mockPathname = "/";
  mockIsLoggedIn = false;
  PROPS = { ...BASE_PROPS, maintenanceOn: false };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The placeholder text Footer swaps in for a hidden contact block. */
const HIDDEN_TEXT = "ข้อมูลการติดต่อไม่พร้อมใช้งานในขณะนี้";

describe("Footer — maintenance-mode contact hiding is site-wide", () => {
  it.each(["/", "/contact", "/catalog", "/about", "/showcase/some-product-id"])(
    "hides phone/email/LINE on %s when maintenance mode is on",
    async (path) => {
      mockPathname = path;
      mockMaintenance(true);
      render(<Footer {...PROPS} />);

      await waitFor(() => expect(screen.getByText(HIDDEN_TEXT)).toBeInTheDocument());
      expect(screen.queryByText(PROPS.phone)).not.toBeInTheDocument();
      expect(screen.queryByText(PROPS.email)).not.toBeInTheDocument();
      // The LINE button is a bare icon with no visible text — assert via its
      // accessible name instead of scanning for a string in the DOM.
      expect(screen.queryByLabelText("LINE")).not.toBeInTheDocument();
    }
  );

  it("hides the contact block on first paint, with no network call at all", () => {
    // Footer used to fetch the flag on mount, starting from "not in maintenance"
    // — so the phone number and LINE id were painted on every page and then
    // removed. Nothing here is awaited on purpose: the hidden state must be true
    // of the very first render, and a re-added fetch would fail this.
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    PROPS = { ...BASE_PROPS, maintenanceOn: true };

    render(<Footer {...PROPS} />);

    expect(screen.getByText(HIDDEN_TEXT)).toBeInTheDocument();
    expect(screen.queryByText(BASE_PROPS.phone)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("LINE")).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("shows contact info on / when maintenance mode is off", async () => {
    mockPathname = "/";
    mockMaintenance(false);
    render(<Footer {...PROPS} />);
    expect(screen.queryByText(HIDDEN_TEXT)).not.toBeInTheDocument();
    expect(screen.getByText(PROPS.phone)).toBeInTheDocument();
  });

  it("shows contact info on /catalog when maintenance mode is off", async () => {
    mockPathname = "/catalog";
    mockMaintenance(false);
    render(<Footer {...PROPS} />);
    expect(screen.queryByText(HIDDEN_TEXT)).not.toBeInTheDocument();
    expect(screen.getByText(PROPS.phone)).toBeInTheDocument();
  });

  it("shows contact info to a logged-in admin on every page, even while maintenance is on", async () => {
    mockIsLoggedIn = true;
    mockMaintenance(true);

    for (const path of ["/", "/catalog", "/about"]) {
      mockPathname = path;
      const { unmount } = render(<Footer {...PROPS} />);
      expect(screen.queryByText(HIDDEN_TEXT)).not.toBeInTheDocument();
      expect(screen.getByText(PROPS.phone)).toBeInTheDocument();
      unmount();
    }
  });
});
