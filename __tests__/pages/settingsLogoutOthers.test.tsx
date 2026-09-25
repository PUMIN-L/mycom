/**
 * /settings — "ออกจากระบบอุปกรณ์อื่นทั้งหมด". Asks first, then POSTs
 * /api/auth/logout-others and says what happened.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import SettingsPage from "@/app/settings/page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/settings",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/app/context/AuthContext", () => ({
  useAuth: () => ({ isLoggedIn: true, isLoading: false }),
}));

function mockFetch(logoutOthers: { ok: boolean; status?: number; body?: unknown }) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === "/api/auth/logout-others" && init?.method === "POST") {
      return { ok: logoutOthers.ok, status: logoutOthers.status ?? (logoutOthers.ok ? 200 : 500), json: async () => logoutOthers.body ?? {} };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const logoutCalls = (m: ReturnType<typeof mockFetch>) =>
  m.mock.calls.filter(([u]) => String(u) === "/api/auth/logout-others");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("/settings — log out other devices", () => {
  it("asks for confirmation before doing anything", async () => {
    const fetchMock = mockFetch({ ok: true });
    render(<SettingsPage />);

    fireEvent.click(await screen.findByRole("button", { name: "ออกจากระบบอุปกรณ์อื่นทั้งหมด" }));
    expect(await screen.findByText(/ทุกเครื่องยกเว้นเครื่องนี้จะต้องเข้าสู่ระบบใหม่/)).toBeInTheDocument();
    expect(logoutCalls(fetchMock)).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "ยกเลิก" }));
    expect(logoutCalls(fetchMock)).toHaveLength(0);
  });

  it("POSTs once confirmed and reports success", async () => {
    const fetchMock = mockFetch({ ok: true });
    render(<SettingsPage />);

    fireEvent.click(await screen.findByRole("button", { name: "ออกจากระบบอุปกรณ์อื่นทั้งหมด" }));
    fireEvent.click(await screen.findByRole("button", { name: "ออกจากระบบ" }));

    await waitFor(() => expect(logoutCalls(fetchMock)).toHaveLength(1));
    expect(await screen.findByText(/ออกจากระบบอุปกรณ์อื่นทั้งหมดแล้ว/)).toBeInTheDocument();
  });

  it("shows the server's error when it fails", async () => {
    mockFetch({ ok: false, body: { error: "ออกจากระบบอุปกรณ์อื่นไม่สำเร็จ" } });
    render(<SettingsPage />);

    fireEvent.click(await screen.findByRole("button", { name: "ออกจากระบบอุปกรณ์อื่นทั้งหมด" }));
    fireEvent.click(await screen.findByRole("button", { name: "ออกจากระบบ" }));

    // The Toast prefixes an emoji ("❌ …"), hence the pattern.
    expect(await screen.findByText(/ออกจากระบบอุปกรณ์อื่นไม่สำเร็จ/)).toBeInTheDocument();
  });

  it("says so in Thai when this session was itself already logged out (401)", async () => {
    mockFetch({ ok: false, status: 401, body: { error: "Unauthorized" } });
    render(<SettingsPage />);

    fireEvent.click(await screen.findByRole("button", { name: "ออกจากระบบอุปกรณ์อื่นทั้งหมด" }));
    fireEvent.click(await screen.findByRole("button", { name: "ออกจากระบบ" }));

    expect(await screen.findByText(/เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่/)).toBeInTheDocument();
    expect(screen.queryByText(/Unauthorized/)).not.toBeInTheDocument();
  });
});
