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

import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Footer from "@/app/components/Footer";
import { LINE_APP_URL } from "@/app/lib/contact";

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

// The LINE icon in the Connect column used to be a bare line:// link, which does
// nothing at all on a desktop — the visitor clicked and got silence. It now
// behaves like the buttons on the home and contact pages.
describe("Footer — LINE button", () => {
  beforeEach(() => {
    PROPS = { ...BASE_PROPS, maintenanceOn: false };
    mockIsLoggedIn = false;
  });

  it("opens the QR modal on a desktop", async () => {
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" });
    render(<Footer {...PROPS} />);

    fireEvent.click(screen.getByLabelText("LINE"));

    // The modal's own copy — asserting on it proves the shared component opened,
    // not just that some state flipped.
    expect(await screen.findByText(/สแกน QR Code/)).toBeInTheDocument();
  });

  it("goes straight to the LINE app on a phone, without opening the modal", () => {
    // A phone can handle the line:// scheme, so the QR would be useless there.
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)" });
    const assign = vi.fn();
    vi.stubGlobal("location", { get href() { return ""; }, set href(v: string) { assign(v); } });

    render(<Footer {...PROPS} />);
    fireEvent.click(screen.getByLabelText("LINE"));

    expect(assign).toHaveBeenCalledWith(LINE_APP_URL);
    expect(screen.queryByText(/สแกน QR Code/)).not.toBeInTheDocument();
  });

  it("offers neither button nor modal while maintenance mode is on", () => {
    // The modal is mounted unconditionally in Footer, so this checks the thing
    // that actually matters: with the button hidden there is no way to reach it,
    // and nothing renders on its own.
    PROPS = { ...BASE_PROPS, maintenanceOn: true };
    render(<Footer {...PROPS} />);

    expect(screen.queryByLabelText("LINE")).not.toBeInTheDocument();
    expect(screen.queryByText(/สแกน QR Code/)).not.toBeInTheDocument();
  });
});

describe("Footer — quick links", () => {
  it("links 'สินค้า' to the full catalog page, not the home grid", () => {
    // /products is what puts every product one click from any page; the
    // home grid (/#products) shows 9 at a time and filters in the browser.
    PROPS = { ...BASE_PROPS, maintenanceOn: false };
    render(<Footer {...PROPS} />);
    expect(screen.getByRole("link", { name: "สินค้า" }).getAttribute("href")).toBe("/products");
  });
});
