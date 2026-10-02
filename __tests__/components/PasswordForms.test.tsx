/**
 * The two password forms — /settings → เปลี่ยนรหัสผ่าน, and /forgot-password.
 * What they show and send; the rules themselves are server-side
 * (__tests__/api/password-reset.test.ts).
 */
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/app/context/AuthContext", () => ({
  useAuth: () => ({ user: { username: "admin" }, isLoggedIn: true, isLoading: false }),
}));
import PasswordSettings from "@/app/components/PasswordSettings";
import ForgotPasswordPage from "@/app/forgot-password/page";

type Answer = { status: number; body: unknown };
function mockNetwork(routes: Record<string, Answer | Answer[]>) {
  const calls: Record<string, number> = {};
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<unknown>>(async (input) => {
    const url = String(input);
    const list = [routes[url]].flat().filter(Boolean) as Answer[];
    if (list.length === 0) return { ok: false, status: 404, json: async () => ({}) };
    const n = (calls[url] = (calls[url] ?? 0) + 1);
    const answer = list[Math.min(n - 1, list.length - 1)];
    return { ok: answer.status < 400, status: answer.status, json: async () => answer.body };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
const bodiesTo = (m: ReturnType<typeof mockNetwork>, url: string) =>
  m.mock.calls
    .filter(([u]) => String(u) === url)
    .map(([, init]) => ((init as RequestInit | undefined)?.body ? JSON.parse(String((init as RequestInit).body)) : null));
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("/settings → เปลี่ยนรหัสผ่าน", () => {
  const fill = () => {
    type("รหัสผ่านปัจจุบัน", "old-password-123");
    type("รหัสผ่านใหม่", "brand-new-password-456");
    type("ยืนยันรหัสผ่านใหม่", "brand-new-password-456");
  };

  it("checks the new password before asking for a code — a mismatch sends nothing", async () => {
    const showToast = vi.fn();
    const fetchMock = mockNetwork({});
    render(<PasswordSettings showToast={showToast} />);
    type("รหัสผ่านปัจจุบัน", "old-password-123");
    type("รหัสผ่านใหม่", "brand-new-password-456");
    type("ยืนยันรหัสผ่านใหม่", "brand-new-password-457");
    fireEvent.click(screen.getByRole("button", { name: "ส่งรหัส OTP ไปที่อีเมล" }));
    expect(showToast).toHaveBeenCalledWith("รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน", "error");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks for the code, then sends passwords + code (+ 2FA code when the server says so)", async () => {
    const showToast = vi.fn();
    const fetchMock = mockNetwork({
      "/api/auth/password/otp": { status: 200, body: { success: true, sentTo: "am****@gmail.com", twoFactorRequired: true } },
      "/api/auth/password": { status: 200, body: { success: true } },
    });
    render(<PasswordSettings showToast={showToast} />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "ส่งรหัส OTP ไปที่อีเมล" }));

    expect(await screen.findByText(/ส่งรหัส OTP ไปที่ am\*\*\*\*@gmail\.com แล้ว/)).toBeInTheDocument();
    type("รหัส OTP จากอีเมล (6 หลัก)", "482913");
    type("รหัสยืนยันตัวตน 2 ขั้น", "123456");
    fireEvent.click(screen.getByRole("button", { name: "เปลี่ยนรหัสผ่าน" }));

    await waitFor(() => expect(bodiesTo(fetchMock, "/api/auth/password")).toHaveLength(1));
    // The current password goes with the code request too — checked there first.
    expect(bodiesTo(fetchMock, "/api/auth/password/otp")).toEqual([{ currentPassword: "old-password-123" }]);
    expect(bodiesTo(fetchMock, "/api/auth/password")[0]).toEqual({
      currentPassword: "old-password-123",
      newPassword: "brand-new-password-456",
      otp: "482913",
      code: "123456",
    });
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.stringContaining("เปลี่ยนรหัสผ่านแล้ว"), "success"));
    // Back to the empty first step.
    expect(screen.getByLabelText("รหัสผ่านปัจจุบัน")).toHaveValue("");
  });

  it("asks no 2FA code of an account without 2FA", async () => {
    mockNetwork({ "/api/auth/password/otp": { status: 200, body: { success: true, sentTo: "am****@gmail.com", twoFactorRequired: false } } });
    render(<PasswordSettings showToast={vi.fn()} />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "ส่งรหัส OTP ไปที่อีเมล" }));
    await screen.findByLabelText("รหัส OTP จากอีเมล (6 หลัก)");
    expect(screen.queryByLabelText("รหัสยืนยันตัวตน 2 ขั้น")).toBeNull();
  });

  // A mistyped current password must not cost a new email: the code is still
  // good, so the fields stay editable and the same code goes again.
  it("after a wrong current password, it can be corrected and sent again with the SAME code", async () => {
    const showToast = vi.fn();
    const fetchMock = mockNetwork({
      "/api/auth/password/otp": { status: 200, body: { success: true, sentTo: "am****@gmail.com", twoFactorRequired: false } },
      "/api/auth/password": [
        { status: 403, body: { error: "รหัสผ่านปัจจุบันไม่ถูกต้อง" } },
        { status: 200, body: { success: true } },
      ],
    });
    render(<PasswordSettings showToast={showToast} />);
    type("รหัสผ่านปัจจุบัน", "old-password-12X");
    type("รหัสผ่านใหม่", "brand-new-password-456");
    type("ยืนยันรหัสผ่านใหม่", "brand-new-password-456");
    fireEvent.click(screen.getByRole("button", { name: "ส่งรหัส OTP ไปที่อีเมล" }));
    await screen.findByLabelText("รหัส OTP จากอีเมล (6 หลัก)");
    type("รหัส OTP จากอีเมล (6 หลัก)", "482913");
    fireEvent.click(screen.getByRole("button", { name: "เปลี่ยนรหัสผ่าน" }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("รหัสผ่านปัจจุบันไม่ถูกต้อง", "error"));

    expect(screen.getByLabelText("รหัสผ่านปัจจุบัน")).toBeEnabled();
    type("รหัสผ่านปัจจุบัน", "old-password-123");
    fireEvent.click(screen.getByRole("button", { name: "เปลี่ยนรหัสผ่าน" }));
    await waitFor(() => expect(bodiesTo(fetchMock, "/api/auth/password")).toHaveLength(2));
    expect(bodiesTo(fetchMock, "/api/auth/password")[1]).toMatchObject({ currentPassword: "old-password-123", otp: "482913" });
    expect(bodiesTo(fetchMock, "/api/auth/password/otp")).toHaveLength(1); // no second email
  });

  it("shows a refusal in the server's own words", async () => {
    const showToast = vi.fn();
    mockNetwork({
      "/api/auth/password/otp": { status: 200, body: { success: true, sentTo: "am****@gmail.com", twoFactorRequired: false } },
      "/api/auth/password": { status: 400, body: { error: "รหัส OTP ไม่ถูกต้อง" } },
    });
    render(<PasswordSettings showToast={showToast} />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "ส่งรหัส OTP ไปที่อีเมล" }));
    await screen.findByLabelText("รหัส OTP จากอีเมล (6 หลัก)");
    type("รหัส OTP จากอีเมล (6 หลัก)", "000000");
    fireEvent.click(screen.getByRole("button", { name: "เปลี่ยนรหัสผ่าน" }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("รหัส OTP ไม่ถูกต้อง", "error"));
  });
});

// The eye button: a wrong current password — or an old one a browser
// autofilled — is far easier to spot when it can be read.
describe("the eye button on every password field", () => {
  it("shows and hides each field of the settings form on its own", () => {
    render(<PasswordSettings showToast={vi.fn()} />);
    for (const label of ["รหัสผ่านปัจจุบัน", "รหัสผ่านใหม่", "ยืนยันรหัสผ่านใหม่"]) {
      expect(screen.getByLabelText(label)).toHaveAttribute("type", "password");
    }
    const [currentEye] = screen.getAllByRole("button", { name: "แสดงรหัสผ่าน" });
    fireEvent.click(currentEye);
    expect(screen.getByLabelText("รหัสผ่านปัจจุบัน")).toHaveAttribute("type", "text");
    expect(screen.getByLabelText("รหัสผ่านใหม่")).toHaveAttribute("type", "password");
    fireEvent.click(screen.getByRole("button", { name: "ซ่อนรหัสผ่าน" }));
    expect(screen.getByLabelText("รหัสผ่านปัจจุบัน")).toHaveAttribute("type", "password");
    expect(screen.getAllByRole("button", { name: "แสดงรหัสผ่าน" })).toHaveLength(3);
  });

  it("the eye button never submits the form — not even a complete, valid one", async () => {
    const fetchMock = mockNetwork({
      "/api/auth/password/otp": { status: 200, body: { success: true, sentTo: "am****@gmail.com", twoFactorRequired: false } },
    });
    render(<PasswordSettings showToast={vi.fn()} />);
    type("รหัสผ่านปัจจุบัน", "old-password-123");
    type("รหัสผ่านใหม่", "brand-new-password-456");
    type("ยืนยันรหัสผ่านใหม่", "brand-new-password-456");
    for (const eye of screen.getAllByRole("button", { name: "แสดงรหัสผ่าน" })) fireEvent.click(eye);
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("the forgot-password page has one on both new-password fields", async () => {
    mockNetwork({ "/api/auth/forgot-password/otp": { status: 200, body: { success: true, message: "ok" } } });
    render(<ForgotPasswordPage />);
    type("Username", "admin");
    fireEvent.click(screen.getByRole("button", { name: "ส่งรหัส OTP" }));
    await screen.findByLabelText("รหัสผ่านใหม่");
    expect(screen.getAllByRole("button", { name: "แสดงรหัสผ่าน" })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("button", { name: "แสดงรหัสผ่าน" })[0]);
    expect(screen.getByLabelText("รหัสผ่านใหม่")).toHaveAttribute("type", "text");
  });
});

describe("/forgot-password", () => {
  it("asks for the code by username, then sends username + code + new password", async () => {
    const fetchMock = mockNetwork({
      "/api/auth/forgot-password/otp": { status: 200, body: { success: true, message: "ส่งแล้ว (ข้อความจาก server)" } },
      "/api/auth/forgot-password": { status: 200, body: { success: true } },
    });
    render(<ForgotPasswordPage />);
    type("Username", "admin");
    fireEvent.click(screen.getByRole("button", { name: "ส่งรหัส OTP" }));
    expect(await screen.findByText(/ส่งแล้ว \(ข้อความจาก server\)/)).toBeInTheDocument();
    expect(bodiesTo(fetchMock, "/api/auth/forgot-password/otp")).toEqual([{ username: "admin" }]);

    type("รหัส OTP จากอีเมล (6 หลัก)", "482913");
    type("รหัสผ่านใหม่", "brand-new-password-456");
    type("ยืนยันรหัสผ่านใหม่", "brand-new-password-456");
    fireEvent.click(screen.getByRole("button", { name: "ตั้งรหัสผ่านใหม่" }));

    expect(await screen.findByRole("link", { name: "ไปหน้าเข้าสู่ระบบ" })).toHaveAttribute("href", "/login");
    expect(bodiesTo(fetchMock, "/api/auth/forgot-password")[0]).toEqual({
      username: "admin",
      otp: "482913",
      newPassword: "brand-new-password-456",
      code: "",
    });
  });

  it("checks the new password before sending — a short one sends nothing", async () => {
    const fetchMock = mockNetwork({ "/api/auth/forgot-password/otp": { status: 200, body: { success: true, message: "ok" } } });
    render(<ForgotPasswordPage />);
    type("Username", "admin");
    fireEvent.click(screen.getByRole("button", { name: "ส่งรหัส OTP" }));
    await screen.findByLabelText("รหัส OTP จากอีเมล (6 หลัก)");
    type("รหัส OTP จากอีเมล (6 หลัก)", "482913");
    type("รหัสผ่านใหม่", "abcd");
    type("ยืนยันรหัสผ่านใหม่", "abcd");
    fireEvent.click(screen.getByRole("button", { name: "ตั้งรหัสผ่านใหม่" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("อย่างน้อย 5");
    expect(bodiesTo(fetchMock, "/api/auth/forgot-password")).toHaveLength(0);
  });

  it("when the server says the account has 2FA, the code field becomes required", async () => {
    mockNetwork({
      "/api/auth/forgot-password/otp": { status: 200, body: { success: true, message: "ok" } },
      "/api/auth/forgot-password": { status: 400, body: { error: "บัญชีนี้เปิดการยืนยันตัวตน 2 ขั้นไว้", twoFactorRequired: true } },
    });
    render(<ForgotPasswordPage />);
    type("Username", "admin");
    fireEvent.click(screen.getByRole("button", { name: "ส่งรหัส OTP" }));
    await screen.findByLabelText("รหัส OTP จากอีเมล (6 หลัก)");
    expect(screen.getByLabelText("รหัสยืนยันตัวตน 2 ขั้น (ถ้าเปิดใช้งานไว้)")).not.toBeRequired();
    type("รหัส OTP จากอีเมล (6 หลัก)", "482913");
    type("รหัสผ่านใหม่", "brand-new-password-456");
    type("ยืนยันรหัสผ่านใหม่", "brand-new-password-456");
    fireEvent.click(screen.getByRole("button", { name: "ตั้งรหัสผ่านใหม่" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("บัญชีนี้เปิดการยืนยันตัวตน 2 ขั้นไว้");
    expect(screen.getByLabelText("รหัสยืนยันตัวตน 2 ขั้น")).toBeRequired();
  });
});
