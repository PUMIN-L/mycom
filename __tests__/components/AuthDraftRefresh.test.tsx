/**
 * A logged-in admin's browser is in Draft Mode (lib/session.ts), which is how
 * it gets fresh renders of the cached /showcase content pages. A live session
 * can still lack it — issued before Draft Mode followed the session, or a
 * bypass cookie from an earlier build. That browser is first served the
 * cached, visitor's copy of the page — a hidden product's page is a 404
 * there — until /api/auth/me turns Draft Mode back on (draftStarted).
 * AuthProvider then renders the page again, once.
 */
import { render, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { AuthProvider } from "@/app/context/AuthContext";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn(), refresh }),
  usePathname: () => "/showcase/c1",
  useSearchParams: () => new URLSearchParams(),
}));

function meAnswers(body: Record<string, unknown>) {
  const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => body }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  document.cookie = "has_session=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
});

const admin = { username: "admin", userId: "1" };

describe("AuthProvider — Draft Mode given back to a live session", () => {
  it("re-renders the page once when /api/auth/me has just turned Draft Mode on", async () => {
    document.cookie = "has_session=1; path=/";
    const fetchMock = meAnswers({ user: admin, draftStarted: true });
    render(<AuthProvider><span /></AuthProvider>);
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("leaves the page alone when the browser was already in Draft Mode", async () => {
    document.cookie = "has_session=1; path=/";
    const fetchMock = meAnswers({ user: admin });
    render(<AuthProvider><span /></AuthProvider>);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(refresh).not.toHaveBeenCalled();
  });

  it("never re-renders for a browser with no session", async () => {
    document.cookie = "has_session=1; path=/";
    const fetchMock = meAnswers({ user: null, draftStarted: true }); // not a real answer; ignored anyway
    render(<AuthProvider><span /></AuthProvider>);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(refresh).not.toHaveBeenCalled();
  });
});
