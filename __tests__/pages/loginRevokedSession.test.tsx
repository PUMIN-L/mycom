/**
 * /login with a session the app still believes in. AuthProvider reads
 * /api/auth/me once, when the app loads; "ออกจากระบบอุปกรณ์อื่นทั้งหมด" can
 * revoke that session afterwards. A revoked tab that a 401 sends to /login
 * must get the form — not a bounce back to /adminpanel on the stale flag.
 */
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { AuthProvider, useAuth } from "@/app/context/AuthContext";
import LoginPage from "@/app/login/page";

const replace = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace, prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/login",
  useSearchParams: () => new URLSearchParams(),
}));

const admin = { username: "admin", userId: "1" };

/** /api/auth/me answers with each of `users` in turn (the last one repeats). */
function mockMe(...users: (typeof admin | null)[]) {
  let call = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) === "/api/auth/login") {
      return { ok: true, status: 200, json: async () => ({ success: true, username: "admin" }) };
    }
    if (String(input) === "/api/auth/me") {
      const user = users[Math.min(call++, users.length - 1)];
      return { ok: true, status: 200, json: async () => ({ user }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

// What the rest of the app (header, admin bell, page guards) reads.
function AuthProbe() {
  return <span data-testid="probe">{useAuth().isLoggedIn ? "in" : "out"}</span>;
}

const meCalls = (m: ReturnType<typeof mockMe>) =>
  m.mock.calls.filter(([u]) => String(u) === "/api/auth/me").length;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("/login — a session revoked after the app loaded", () => {
  it("shows the form instead of bouncing back to /adminpanel", async () => {
    // Valid when the app loaded, revoked by the time the tab reaches /login.
    const fetchMock = mockMe(admin, null);
    render(<AuthProvider><LoginPage /><AuthProbe /></AuthProvider>);

    await waitFor(() => expect(meCalls(fetchMock)).toBe(2));
    await act(async () => {});

    expect(replace).not.toHaveBeenCalledWith("/adminpanel");
    expect(screen.getByRole("button", { name: /เข้าสู่ระบบ/ })).toBeInTheDocument();
    // …and the rest of the app stops treating the tab as logged in.
    expect(screen.getByTestId("probe")).toHaveTextContent("out");
  });

  it("lets the revoked tab log in again", async () => {
    // Valid at load, revoked at /login, valid again once the form is used.
    const fetchMock = mockMe(admin, null, admin);
    const { container } = render(<AuthProvider><LoginPage /></AuthProvider>);
    await waitFor(() => expect(meCalls(fetchMock)).toBe(2));

    fireEvent.change(container.querySelector('input[type="text"]')!, { target: { value: "admin" } });
    fireEvent.change(container.querySelector('input[type="password"]')!, { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: /เข้าสู่ระบบ/ }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/adminpanel"));
  });

  it("still sends a live session on to /adminpanel", async () => {
    mockMe(admin);
    render(<AuthProvider><LoginPage /></AuthProvider>);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/adminpanel"));
  });

  it("does not redirect a visitor who was never logged in", async () => {
    const fetchMock = mockMe(null);
    render(<AuthProvider><LoginPage /></AuthProvider>);

    await waitFor(() => expect(meCalls(fetchMock)).toBe(1));
    await act(async () => {});

    expect(replace).not.toHaveBeenCalled();
  });
});
