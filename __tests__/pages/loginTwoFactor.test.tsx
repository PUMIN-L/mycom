/**
 * /login on a two-factor account: password, then the code from the app (or a
 * backup code). Rendered inside the real AuthProvider with the network
 * mocked, so the page and AuthContext are tested together — the server side
 * is __tests__/api/login-2fa.test.ts.
 */
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { AuthProvider } from "@/app/context/AuthContext";
import LoginPage from "@/app/login/page";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/login",
  useSearchParams: () => new URLSearchParams(),
}));

type Answer = { status: number; body: unknown };

/** /api/auth/login answers `login`; /api/auth/login/2fa answers each of
 *  `codes` in turn (the last one repeats). */
function mockNetwork(login: Answer, ...codes: Answer[]) {
  let codeCall = 0;
  const json = (a: Answer) => ({ ok: a.status < 400, status: a.status, json: async () => a.body });
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<unknown>>(async (input) => {
    const url = String(input);
    if (url === "/api/auth/me") return json({ status: 200, body: { user: null } });
    if (url === "/api/auth/login") return json(login);
    if (url === "/api/auth/login/2fa") return json(codes[Math.min(codeCall++, codes.length - 1)]);
    return json({ status: 200, body: {} });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const NEEDS_CODE: Answer = { status: 200, body: { twoFactorRequired: true } };

const bodyOf = (m: ReturnType<typeof mockNetwork>, url: string) =>
  m.mock.calls.filter(([u]) => String(u) === url).map(([, init]) => JSON.parse(String((init as RequestInit).body)));

async function renderAndSubmitPassword() {
  render(<AuthProvider><LoginPage /></AuthProvider>);
  fireEvent.change(await screen.findByPlaceholderText("admin"), { target: { value: "admin" } });
  fireEvent.change(screen.getByPlaceholderText("••••••••"), { target: { value: "correct-horse" } });
  fireEvent.click(screen.getByRole("button", { name: "เข้าสู่ระบบ" }));
}

afterEach(() => {
  window.history.replaceState({}, '', '/');
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// proxy.ts sends a logged-out browser to /login?next=<the page>; once in, it
// goes back there — a sticker's QR scanned on a phone opens the piece.
describe("/login — back to the page it was sent away from", () => {
  it("password only: to ?next=", async () => {
    window.history.replaceState({}, "", "/login?next=%2Fstock%2Fitem%2Fabc");
    mockNetwork({ status: 200, body: { success: true, username: "admin" } });
    await renderAndSubmitPassword();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/stock/item/abc"));
  });

  it("after the 2FA code: to ?next=", async () => {
    window.history.replaceState({}, "", "/login?next=%2Fassets%2Fitem%2Fxyz");
    mockNetwork(NEEDS_CODE, { status: 200, body: { success: true, username: "admin" } });
    await renderAndSubmitPassword();
    fireEvent.change(await screen.findByLabelText("รหัส 6 หลัก"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "ยืนยัน" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/assets/item/xyz"));
  });

  it("another site in ?next= is ignored", async () => {
    window.history.replaceState({}, "", "/login?next=%2F%2Fevil.example");
    mockNetwork({ status: 200, body: { success: true, username: "admin" } });
    await renderAndSubmitPassword();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/adminpanel"));
  });
});

describe("/login — two-factor", () => {
  it("an account without 2FA goes straight in, as before", async () => {
    mockNetwork({ status: 200, body: { success: true, username: "admin" } });
    await renderAndSubmitPassword();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/adminpanel"));
    expect(screen.queryByLabelText("รหัส 6 หลัก")).not.toBeInTheDocument();
  });

  it("after the password, asks for the code — and nothing else is logged in yet", async () => {
    mockNetwork(NEEDS_CODE);
    await renderAndSubmitPassword();
    expect(await screen.findByLabelText("รหัส 6 หลัก")).toBeInTheDocument();
    // The password form, and the password with it, is gone.
    expect(screen.queryByPlaceholderText("••••••••")).not.toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("the right code logs in", async () => {
    const fetchMock = mockNetwork(NEEDS_CODE, { status: 200, body: { success: true, username: "admin" } });
    await renderAndSubmitPassword();
    fireEvent.change(await screen.findByLabelText("รหัส 6 หลัก"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "ยืนยัน" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/adminpanel"));
    expect(bodyOf(fetchMock, "/api/auth/login/2fa")).toEqual([{ code: "123456" }]);
  });

  it("a wrong code says so and stays on the code step", async () => {
    mockNetwork(NEEDS_CODE, { status: 401, body: { error: "รหัสไม่ถูกต้อง" } });
    await renderAndSubmitPassword();
    fireEvent.change(await screen.findByLabelText("รหัส 6 หลัก"), { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: "ยืนยัน" }));
    expect(await screen.findByText("รหัสไม่ถูกต้อง")).toBeInTheDocument();
    expect(screen.getByLabelText("รหัส 6 หลัก")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("an expired half-login goes back to the password form, with the reason", async () => {
    mockNetwork(NEEDS_CODE, {
      status: 401,
      body: { error: "หมดเวลายืนยันรหัส กรุณาใส่ username และ password ใหม่อีกครั้ง", restart: true },
    });
    await renderAndSubmitPassword();
    fireEvent.change(await screen.findByLabelText("รหัส 6 หลัก"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "ยืนยัน" }));
    expect(await screen.findByText(/หมดเวลายืนยันรหัส/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("••••••••")).toBeInTheDocument();
  });

  it("'ใช้รหัสสำรองแทน' takes a backup code, then goes to the 2FA settings", async () => {
    const fetchMock = mockNetwork(NEEDS_CODE, {
      status: 200,
      body: { success: true, username: "admin", backupCodesRemaining: 9 },
    });
    await renderAndSubmitPassword();
    fireEvent.click(await screen.findByRole("button", { name: "ไม่มีมือถือ? ใช้รหัสสำรองแทน" }));
    const field = screen.getByLabelText("รหัสสำรอง");
    expect(field).toHaveAttribute("placeholder", "ABCD-EFGH");
    fireEvent.change(field, { target: { value: "ABCD-EFGH" } });
    fireEvent.click(screen.getByRole("button", { name: "ยืนยัน" }));
    // A spent backup code usually means a lost phone: straight to where the
    // remaining count and "new codes" are.
    await waitFor(() => expect(push).toHaveBeenCalledWith("/settings#two-factor"));
    expect(bodyOf(fetchMock, "/api/auth/login/2fa")).toEqual([{ code: "ABCD-EFGH" }]);
  });

  it("← กลับไปใส่รหัสผ่าน returns to the password form", async () => {
    mockNetwork(NEEDS_CODE);
    await renderAndSubmitPassword();
    fireEvent.click(await screen.findByRole("button", { name: "← กลับไปใส่รหัสผ่าน" }));
    expect(screen.getByPlaceholderText("••••••••")).toBeInTheDocument();
  });

  it("the code field is a one-time-code field the browser will not save", async () => {
    mockNetwork(NEEDS_CODE);
    await renderAndSubmitPassword();
    const field = await screen.findByLabelText("รหัส 6 หลัก");
    expect(field).toHaveAttribute("autocomplete", "one-time-code");
    expect(field).toHaveAttribute("inputmode", "numeric");
  });

  // The server takes either kind of code in either mode. A backup code pasted
  // into the 6-digit field without switching first used to be cut to 7
  // characters by maxLength — a wrong answer, counted toward the lockout.
  it("does not cut a backup code pasted into the 6-digit field", async () => {
    const fetchMock = mockNetwork(NEEDS_CODE, { status: 200, body: { success: true, username: "admin", backupCodesRemaining: 9 } });
    await renderAndSubmitPassword();
    const field = await screen.findByLabelText("รหัส 6 หลัก");
    expect(Number(field.getAttribute("maxlength"))).toBeGreaterThanOrEqual("ABCD-EFGH".length);
    fireEvent.change(field, { target: { value: "ABCD-EFGH" } });
    fireEvent.click(screen.getByRole("button", { name: "ยืนยัน" }));
    await waitFor(() => expect(bodyOf(fetchMock, "/api/auth/login/2fa")).toEqual([{ code: "ABCD-EFGH" }]));
  });
});
