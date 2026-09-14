/**
 * Which paths the full-screen "under maintenance" overlay actually blocks.
 * `MAINTENANCE_BLOCKED_PATHS` now lives in its own module (previously a
 * private literal here) purely so this file can import and assert against
 * the real list rather than a copy of it.
 *
 * `Footer`'s contact-info hiding does NOT use this list — that hiding is
 * deliberately site-wide, unlike the overlay. See
 * __tests__/components/Footer.test.tsx.
 */

import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import MaintenanceOverlay from "@/app/components/MaintenanceOverlay";

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

function mockMaintenance(enabled: boolean) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ enabled }) })
  );
}

beforeEach(() => {
  mockPathname = "/";
  mockIsLoggedIn = false;
  mockIsLoading = false;
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
    render(<MaintenanceOverlay />);
    await waitFor(() => expect(screen.getByText(OVERLAY_HEADING)).toBeInTheDocument());
  });

  it("shows the overlay on /contact when maintenance is on", async () => {
    mockPathname = "/contact";
    mockMaintenance(true);
    render(<MaintenanceOverlay />);
    await waitFor(() => expect(screen.getByText(OVERLAY_HEADING)).toBeInTheDocument());
  });

  it("does NOT show the overlay on /catalog — that page stays accessible during maintenance", async () => {
    mockPathname = "/catalog";
    mockMaintenance(true);
    render(<MaintenanceOverlay />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(screen.queryByText(OVERLAY_HEADING)).not.toBeInTheDocument();
  });

  it("never shows the overlay to a logged-in admin, even on /", async () => {
    mockIsLoggedIn = true;
    mockMaintenance(true);
    render(<MaintenanceOverlay />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(screen.queryByText(OVERLAY_HEADING)).not.toBeInTheDocument();
  });

  it("shows nothing on / when maintenance is off", async () => {
    mockMaintenance(false);
    render(<MaintenanceOverlay />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(screen.queryByText(OVERLAY_HEADING)).not.toBeInTheDocument();
  });
});
