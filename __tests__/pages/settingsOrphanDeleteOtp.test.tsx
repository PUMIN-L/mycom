/**
 * /settings — deleting unused Cloudinary images needs the emailed code, and
 * the screen must take the SAME number of digits the API checks (6). A box
 * that stops at 5 while the route insists on 6 is a delete nobody can ever
 * complete; one that sends 5 is always "กรุณากรอกรหัสยืนยัน 6 หลัก".
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

const ORPHAN = {
  publicId: "samples/mycom/unused-1",
  secureUrl: "https://res.cloudinary.com/demo/image/upload/v1/samples/mycom/unused-1.jpg",
  format: "jpg",
  bytes: 2048,
  resourceType: "image",
  createdAt: "2026-01-01T00:00:00Z",
};

function mockFetch(otpResponse: { ok: boolean; status?: number; body?: unknown } = { ok: true }) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });
    if (url === "/api/cloudinary/orphans" && method === "GET") {
      return json(200, { total: 1, inUse: 0, orphanCount: 1, orphans: [ORPHAN] });
    }
    if (url === "/api/cloudinary/orphans/otp") {
      return json(otpResponse.status ?? (otpResponse.ok ? 200 : 500), otpResponse.body ?? { success: true });
    }
    if (url === "/api/cloudinary/orphans" && method === "DELETE") {
      return json(200, { deleted: 1, skipped: 0, errors: [] });
    }
    return json(200, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Scan, select the one orphan, open the delete dialog and ask for a code. */
async function requestCode() {
  fireEvent.click(await screen.findByRole("button", { name: "🔍 สแกนหารูปที่ไม่ได้ใช้" }));
  fireEvent.click(await screen.findByLabelText(/เลือกทั้งหมด/));
  fireEvent.click(await screen.findByRole("button", { name: /ลบรูปที่เลือก/ }));
  fireEvent.click(await screen.findByRole("button", { name: "📧 ส่งรหัสยืนยันทางอีเมล" }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("/settings — deleting unused images with the emailed code", () => {
  it("takes a 6-digit code and sends all 6", async () => {
    const fetchMock = mockFetch();
    render(<SettingsPage />);

    await requestCode();
    const box = (await screen.findByPlaceholderText("รหัสยืนยัน 6 หลัก")) as HTMLInputElement;
    expect(box.maxLength).toBe(6);
    const confirm = screen.getByRole("button", { name: /ยืนยันและลบ 1 รูป/ });

    fireEvent.change(box, { target: { value: "12345" } });
    expect(confirm).toBeDisabled(); // 5 digits is not a code any more

    fireEvent.change(box, { target: { value: "123456" } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u, i]) => String(u) === "/api/cloudinary/orphans" && i?.method === "DELETE")).toBe(true)
    );
    const [, init] = fetchMock.mock.calls.find(([u, i]) => String(u) === "/api/cloudinary/orphans" && i?.method === "DELETE")!;
    expect(JSON.parse(String(init!.body)).otp).toBe("123456");
  });

  it("shows the server's wait message when a new code was asked for too soon", async () => {
    mockFetch({ ok: false, status: 429, body: { error: "ขอรหัส OTP ถี่เกินไป กรุณารออีก 42 วินาที แล้วลองใหม่" } });
    render(<SettingsPage />);

    await requestCode();

    expect(await screen.findByText(/กรุณารออีก 42 วินาที/)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("รหัสยืนยัน 6 หลัก")).not.toBeInTheDocument();
  });
});
