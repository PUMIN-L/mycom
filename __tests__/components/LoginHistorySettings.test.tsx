/**
 * /settings → ประวัติการเข้าสู่ระบบ (app/components/LoginHistorySettings.tsx).
 * What a line says — result, new device, the email, when, from what and
 * where — the warning on a right password no code followed, the first ten
 * and "ดูทั้งหมด", a refusal in Thai with a way to try again, and its place
 * on the page: just above "ออกจากระบบอุปกรณ์อื่นทั้งหมด".
 */
import { render, screen, fireEvent, cleanup, within, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import LoginHistorySettings, { LOGIN_HISTORY_SHOWN_AT_FIRST } from "@/app/components/LoginHistorySettings";
import SettingsPage from "@/app/settings/page";
import type { LoginHistoryEntry } from "@/app/lib/loginHistory";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/settings",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/app/context/AuthContext", () => ({
  useAuth: () => ({ isLoggedIn: true, isLoading: false }),
}));

const URL_ = "/api/auth/login-history";

function entry(over: Partial<LoginHistoryEntry> = {}): LoginHistoryEntry {
  return {
    id: "e1",
    username: "admin",
    at: "2026-11-04T07:00:00.000Z",
    result: "signed_in",
    method: "password",
    newDevice: false,
    alert: null,
    ip: "203.0.113.9",
    location: "Bangkok, TH",
    device: "Chrome บน Windows",
    ...over,
  };
}

type Answer = { status: number; body?: unknown } | "network-error";

function mockHistory(...answers: Answer[]) {
  let n = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) !== URL_) return { ok: true, status: 200, json: async () => ({}) };
    const answer = answers[Math.min(n++, answers.length - 1)];
    if (answer === "network-error") throw new TypeError("Failed to fetch");
    return { ok: answer.status < 400, status: answer.status, json: async () => answer.body ?? {} };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const ok = (entries: LoginHistoryEntry[]) => ({
  status: 200,
  body: { entries, alertEmail: "am****@gmail.com", retentionDays: 365 },
});
const historyCalls = (m: ReturnType<typeof mockHistory>) => m.mock.calls.filter(([u]) => String(u) === URL_);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("LoginHistorySettings", () => {
  it("shows each login: what completed it, when, the account, the device, the address and the place", async () => {
    mockHistory(ok([entry()]));
    render(<LoginHistorySettings />);
    const line = (await screen.findByText("เข้าสู่ระบบสำเร็จ (รหัสผ่าน)")).closest("li")!;
    expect(within(line).getByText("04 Nov 2026 14:00 · บัญชี admin")).toBeInTheDocument();
    expect(within(line).getByText("Chrome บน Windows · IP 203.0.113.9 · Bangkok, TH")).toBeInTheDocument();
    expect(within(line).queryByText("อุปกรณ์ใหม่")).not.toBeInTheDocument();
    // Where the emails go, and how long lines are kept.
    expect(screen.getByText(/เก็บไว้ 1 ปี/)).toBeInTheDocument();
    expect(screen.getByText(/ไปที่ am\*\*\*\*@gmail\.com/)).toBeInTheDocument();
  });

  it("marks a new device and says what became of its email", async () => {
    mockHistory(ok([entry({ newDevice: true, alert: "sent", method: "totp", ip: null, location: null })]));
    render(<LoginHistorySettings />);
    const line = (await screen.findByText("เข้าสู่ระบบสำเร็จ (รหัสผ่าน + รหัสจากแอป)")).closest("li")!;
    expect(within(line).getByText("อุปกรณ์ใหม่")).toBeInTheDocument();
    expect(within(line).getByText("ส่งอีเมลแจ้งเตือนแล้ว")).toBeInTheDocument();
    expect(within(line).getByText("Chrome บน Windows · IP ไม่ทราบ")).toBeInTheDocument();
  });

  it("warns about a right password that no code followed", async () => {
    mockHistory(ok([entry({ result: "awaiting_2fa", newDevice: true, alert: "sent" })]));
    render(<LoginHistorySettings />);
    const label = await screen.findByText(/ใส่รหัสผ่านถูก แต่ไม่ได้ใส่รหัสยืนยัน 2 ขั้นต่อ/);
    const line = label.closest("li")!;
    expect(line.className).toContain("bg-amber-50");
    expect(within(line).getByText("ถ้าไม่ใช่คุณ แปลว่ารหัสผ่านรั่ว — เปลี่ยนรหัสผ่านด้านล่างทันที")).toBeInTheDocument();
  });

  it("says when there is nothing yet", async () => {
    mockHistory(ok([]));
    render(<LoginHistorySettings />);
    expect(await screen.findByText(/ยังไม่มีประวัติ/)).toBeInTheDocument();
  });

  it(`shows the newest ${LOGIN_HISTORY_SHOWN_AT_FIRST}, then all on request`, async () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      entry({ id: `e${i}`, at: new Date(Date.parse("2026-11-04T07:00:00.000Z") - i * 60_000).toISOString() })
    );
    mockHistory(ok(many));
    render(<LoginHistorySettings />);
    await screen.findAllByText("เข้าสู่ระบบสำเร็จ (รหัสผ่าน)");
    expect(screen.getAllByRole("listitem")).toHaveLength(LOGIN_HISTORY_SHOWN_AT_FIRST);
    fireEvent.click(screen.getByRole("button", { name: "ดูทั้งหมด (12 รายการ)" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(12);
    fireEvent.click(screen.getByRole("button", { name: "แสดงน้อยลง" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(LOGIN_HISTORY_SHOWN_AT_FIRST);
  });

  it("a lapsed session is said in Thai, and ลองใหม่ loads again", async () => {
    const fetchMock = mockHistory({ status: 401, body: { error: "Unauthorized" } }, ok([entry()]));
    render(<LoginHistorySettings />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่แล้วลองอีกครั้ง");
    expect(screen.queryByText(/Unauthorized/)).not.toBeInTheDocument();
    fireEvent.click(within(alert).getByRole("button", { name: "ลองใหม่" }));
    expect(await screen.findByText("เข้าสู่ระบบสำเร็จ (รหัสผ่าน)")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(historyCalls(fetchMock)).toHaveLength(2);
  });

  it("a network failure or a server error says it could not load", async () => {
    mockHistory("network-error");
    render(<LoginHistorySettings />);
    expect(await screen.findByRole("alert")).toHaveTextContent("โหลดประวัติการเข้าสู่ระบบไม่สำเร็จ");
    cleanup();
    mockHistory({ status: 500, body: { error: "x" } });
    render(<LoginHistorySettings />);
    expect(await screen.findByRole("alert")).toHaveTextContent("โหลดประวัติการเข้าสู่ระบบไม่สำเร็จ");
  });

  it("a failed รีเฟรช keeps the list it had, and says so above it", async () => {
    mockHistory(ok([entry()]), { status: 500, body: { error: "x" } });
    render(<LoginHistorySettings />);
    await screen.findByText("เข้าสู่ระบบสำเร็จ (รหัสผ่าน)");
    fireEvent.click(screen.getByRole("button", { name: "รีเฟรช" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("โหลดประวัติการเข้าสู่ระบบไม่สำเร็จ");
    expect(screen.getByText("เข้าสู่ระบบสำเร็จ (รหัสผ่าน)")).toBeInTheDocument();
  });

  /** Answers the first request only when `release` is called; the rest at once. */
  function slowFirstThen(first: () => { status: number; body?: unknown }, rest: { status: number; body?: unknown }) {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let n = 0;
    const answer = (a: { status: number; body?: unknown }) => ({ ok: a.status < 400, status: a.status, json: async () => a.body ?? {} });
    const fetchMock = vi.fn(async () => {
      if (n++ === 0) {
        await gate;
        return answer(first());
      }
      return answer(rest);
    });
    vi.stubGlobal("fetch", fetchMock);
    return { release, fetchMock };
  }

  it("a first answer that lands AFTER a newer รีเฟรช does not replace it", async () => {
    const { release, fetchMock } = slowFirstThen(
      () => ok([entry({ id: "old", username: "old-list" })]),
      ok([entry({ id: "new", username: "new-list" })])
    );
    render(<LoginHistorySettings />);
    fireEvent.click(screen.getByRole("button", { name: "รีเฟรช" }));
    expect(await screen.findByText(/บัญชี new-list/)).toBeInTheDocument();
    release();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByText(/บัญชี new-list/)).toBeInTheDocument();
    expect(screen.queryByText(/บัญชี old-list/)).not.toBeInTheDocument();
  });

  it("a first load that FAILS after a newer รีเฟรช succeeded shows no error", async () => {
    const { release } = slowFirstThen(() => ({ status: 500, body: { error: "x" } }), ok([entry()]));
    render(<LoginHistorySettings />);
    fireEvent.click(screen.getByRole("button", { name: "รีเฟรช" }));
    await screen.findByText("เข้าสู่ระบบสำเร็จ (รหัสผ่าน)");
    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("เข้าสู่ระบบสำเร็จ (รหัสผ่าน)")).toBeInTheDocument();
  });

  it("รีเฟรช reads the history again", async () => {
    const fetchMock = mockHistory(ok([entry()]), ok([entry(), entry({ id: "e2", username: "staff" })]));
    render(<LoginHistorySettings />);
    await screen.findByText("เข้าสู่ระบบสำเร็จ (รหัสผ่าน)");
    fireEvent.click(screen.getByRole("button", { name: "รีเฟรช" }));
    expect(await screen.findByText(/บัญชี staff/)).toBeInTheDocument();
    expect(historyCalls(fetchMock)).toHaveLength(2);
  });
});

describe("/settings", () => {
  it("shows the history just above ออกจากระบบอุปกรณ์อื่นทั้งหมด", async () => {
    mockHistory(ok([entry()]));
    render(<SettingsPage />);
    const history = await screen.findByRole("heading", { name: /ประวัติการเข้าสู่ระบบ/ });
    const sessions = screen.getByRole("heading", { name: /ความปลอดภัยของบัญชี/ });
    expect(history.compareDocumentPosition(sessions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(await screen.findByText("เข้าสู่ระบบสำเร็จ (รหัสผ่าน)")).toBeInTheDocument();
  });
});
