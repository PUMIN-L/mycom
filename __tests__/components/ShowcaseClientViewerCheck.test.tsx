/**
 * /showcase/[id] is cached (ISR) for visitors; an admin's browser, in Draft
 * Mode, gets its own render with every product for the edit picker. A copy
 * made for the other kind of viewer can still reach the page — prefetched
 * before logging in, kept in the tab after logging out, or the cached copy a
 * session without Draft Mode got before /api/auth/me turned it back on.
 * ShowcaseClient renders the page again, once, for whoever is looking.
 */
import { render, cleanup, act } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh, back: vi.fn() }),
  usePathname: () => "/showcase/c1",
  useSearchParams: () => new URLSearchParams(),
}));
let auth = { isLoggedIn: false, isLoading: false };
vi.mock("@/app/context/AuthContext", () => ({
  useAuth: () => auth,
}));
vi.mock("@/app/i18n/LanguageContext", () => ({
  useLanguage: () => ({ lang: "th", setLang: vi.fn() }),
  useT: () => (o: { th: string } | undefined) => o?.th ?? "",
}));
vi.mock("@/app/components/Navbar", () => ({ default: () => null }));
vi.mock("@/app/components/Footer", () => ({ default: () => null }));

import ShowcaseClient from "@/app/showcase/[id]/ShowcaseClient";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  refresh.mockClear();
  auth = { isLoggedIn: false, isLoading: false };
});

function page(adminView: boolean) {
  return (
    <ShowcaseClient
      initialContent={{ id: "c1", title: "หัวข้อ", blocks: [], createdAt: "2026-09-01", productId: null }}
      initialAllContents={[]}
      initialProducts={[]}
      initialCategories={[]}
      companyInfo={{ email: "x@y.z", phone: "0", address: "ที่อยู่" }}
      maintenanceOn={false}
      adminView={adminView}
    />
  );
}

function view(adminView: boolean) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }) as unknown as Response));
  return render(page(adminView));
}

describe("ShowcaseClient — a copy made for the other kind of viewer", () => {
  it("the right copy for each: nothing to do", () => {
    view(false);
    cleanup();
    auth = { isLoggedIn: true, isLoading: false };
    view(true);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("an admin shown the visitor's copy: renders the page again", () => {
    auth = { isLoggedIn: true, isLoading: false };
    view(false);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("a logged-out tab still holding the admin's copy: renders the page again", () => {
    view(true);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("waits for the login check to settle, then decides once", () => {
    auth = { isLoggedIn: false, isLoading: true };
    const { rerender } = view(false);
    expect(refresh).not.toHaveBeenCalled(); // not yet known: an admin's first page load looks like this

    auth = { isLoggedIn: true, isLoading: false };
    act(() => rerender(page(false)));
    expect(refresh).toHaveBeenCalledTimes(1);

    // The refresh came back the same copy (Draft Mode cookie refused): no loop.
    act(() => rerender(page(false)));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("logging out on the page is not a reason — the logout navigates away itself", () => {
    auth = { isLoggedIn: true, isLoading: false };
    const { rerender } = view(true);
    auth = { isLoggedIn: false, isLoading: false };
    act(() => rerender(page(true)));
    expect(refresh).not.toHaveBeenCalled();
  });
});
