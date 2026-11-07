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

// One delete takes at most 50 files (ORPHAN_DELETE_MAX). "เลือกทั้งหมด" on 80
// used to send all 80; the route deleted the first 50, and the screen dropped
// all 80 from the list — 30 "deleted" files stayed on Cloudinary unseen.
describe("/settings — at most 50 unused files per delete; only what is gone leaves the list", () => {
  const orphanNo = (i: number) => ({
    ...ORPHAN,
    publicId: `samples/mycom/unused-${i}`,
    secureUrl: `https://res.cloudinary.com/demo/image/upload/v1/samples/mycom/unused-${i}.jpg`,
  });

  function mockScan(orphans: (typeof ORPHAN)[], deleteBody: unknown = {}) {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });
      if (url === "/api/cloudinary/orphans" && method === "GET") {
        return json(200, { total: orphans.length + 5, inUse: 5, orphanCount: orphans.length, orphans });
      }
      if (url === "/api/cloudinary/orphans/otp") return json(200, { success: true });
      if (url === "/api/cloudinary/orphans" && method === "DELETE") return json(200, deleteBody);
      return json(200, {});
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }
  const bodyOf = (fetchMock: ReturnType<typeof mockScan>, url: string, method: string) => {
    const call = fetchMock.mock.calls.find(([u, i]) => String(u) === url && (i?.method ?? "GET") === method);
    return call ? JSON.parse(String(call[1]!.body)) : undefined;
  };

  it("selects the first 50 of 60, refuses a 51st, and asks for a code for those 50", async () => {
    const fetchMock = mockScan(Array.from({ length: 60 }, (_, i) => orphanNo(i)));
    render(<SettingsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "🔍 สแกนหารูปที่ไม่ได้ใช้" }));

    const selectFirst = await screen.findByLabelText(/เลือก 50 รูปแรก/);
    expect(selectFirst.closest("label")!.textContent).toContain("จากทั้งหมด 60 รูป");
    expect(selectFirst.closest("label")!.textContent).toContain("ลบได้ครั้งละไม่เกิน 50 รูป");
    fireEvent.click(selectFirst);
    expect(await screen.findByRole("button", { name: "🗑️ ลบรูปที่เลือก (50)" })).toBeInTheDocument();
    expect(selectFirst).toBeChecked();

    // A 51st is not added — the admin is told why, and the rest are disabled.
    expect(screen.getByRole("status")).toHaveTextContent("เลือกครบ 50 รูปแล้ว (ลบได้ครั้งละไม่เกิน 50 รูป)");
    fireEvent.click(screen.getByText("unused-55"));
    expect(screen.getByRole("button", { name: "🗑️ ลบรูปที่เลือก (50)" })).toBeInTheDocument();
    const boxes = screen.getAllByRole("checkbox").slice(1); // [0] is the select-all box
    expect(boxes.filter((b) => (b as HTMLInputElement).checked)).toHaveLength(50);
    expect(boxes.filter((b) => (b as HTMLInputElement).disabled)).toHaveLength(10);

    // One un-ticked frees a place: the message goes, the others can be picked.
    fireEvent.click(screen.getByText("unused-0"));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(boxes.filter((b) => (b as HTMLInputElement).disabled)).toHaveLength(0);
    fireEvent.click(screen.getByText("unused-0"));
    expect(screen.getByRole("button", { name: "🗑️ ลบรูปที่เลือก (50)" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /ลบรูปที่เลือก/ }));
    fireEvent.click(await screen.findByRole("button", { name: "📧 ส่งรหัสยืนยันทางอีเมล" }));
    await waitFor(() => expect(bodyOf(fetchMock, "/api/cloudinary/orphans/otp", "POST")).toEqual({ imageCount: 50 }));

    fireEvent.change(await screen.findByPlaceholderText("รหัสยืนยัน 6 หลัก"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: /ยืนยันและลบ 50 รูป/ }));
    await waitFor(() => expect(bodyOf(fetchMock, "/api/cloudinary/orphans", "DELETE")).toBeDefined());
    const sent = bodyOf(fetchMock, "/api/cloudinary/orphans", "DELETE").items.map((i: { publicId: string }) => i.publicId);
    expect(new Set(sent)).toEqual(new Set(Array.from({ length: 50 }, (_, i) => `samples/mycom/unused-${i}`)));
    expect(sent).toHaveLength(50);
  });

  it("drops only the deleted and in-use files from the list; a failed one stays", async () => {
    mockScan([orphanNo(0), orphanNo(1), orphanNo(2)], {
      deleted: 1,
      skipped: 1,
      failed: 1,
      deletedIds: ["samples/mycom/unused-0"],
      skippedIds: ["samples/mycom/unused-1"],
      errors: ["samples/mycom/unused-2: error"],
    });
    render(<SettingsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "🔍 สแกนหารูปที่ไม่ได้ใช้" }));
    fireEvent.click(await screen.findByLabelText(/เลือกทั้งหมด \(3 รูป/));
    fireEvent.click(await screen.findByRole("button", { name: /ลบรูปที่เลือก \(3\)/ }));
    fireEvent.click(await screen.findByRole("button", { name: "📧 ส่งรหัสยืนยันทางอีเมล" }));
    fireEvent.change(await screen.findByPlaceholderText("รหัสยืนยัน 6 หลัก"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: /ยืนยันและลบ 3 รูป/ }));

    expect(await screen.findByText(/ลบไม่สำเร็จ 1 รูป/)).toBeInTheDocument();
    expect(screen.queryByText("unused-0")).not.toBeInTheDocument();
    expect(screen.queryByText("unused-1")).not.toBeInTheDocument();
    expect(screen.getByText("unused-2")).toBeInTheDocument();
    const stat = (label: string) => screen.getByText(label).previousElementSibling!.textContent;
    expect(stat("ทั้งหมดใน Cloudinary")).toBe("7");
    expect(stat("ใช้งานอยู่")).toBe("6");
    expect(stat("ไม่ได้ใช้งาน")).toBe("1");
  });
});
