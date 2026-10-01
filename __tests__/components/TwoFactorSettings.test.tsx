/**
 * /settings → ยืนยันตัวตน 2 ขั้น. What the section shows and sends; the rules
 * themselves are server-side (__tests__/api/two-factor-settings.test.ts).
 *
 * Worth pinning: the backup codes are shown once and the section cannot be
 * closed until the admin says he kept them; every change sends the password
 * AND the code; a refusal is shown in the server's own Thai words.
 */
import { render, screen, waitFor, fireEvent, cleanup, within } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import TwoFactorSettings from "@/app/components/TwoFactorSettings";

type Answer = { status: number; body: unknown };
const CODES = ["AB2C-DE3F", "GH4J-KM5N", "PQ6R-ST7U", "VW8X-YZ9A", "BC2D-EF3G", "HJ4K-MN5P", "QR6S-TU7V", "WX8Y-Z9AB", "CD2E-FG3H", "JK4M-NP5Q"];

function mockNetwork(routes: Record<string, Answer | Answer[]>) {
  const calls: Record<string, number> = {};
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<unknown>>(async (input) => {
    const url = String(input);
    const entry = routes[url];
    if (!entry) return { ok: false, status: 404, json: async () => ({}) };
    const list = Array.isArray(entry) ? entry : [entry];
    const n = (calls[url] = (calls[url] ?? 0) + 1);
    const answer = list[Math.min(n - 1, list.length - 1)];
    return { ok: answer.status < 400, status: answer.status, json: async () => answer.body };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const bodiesTo = (m: ReturnType<typeof mockNetwork>, url: string) =>
  m.mock.calls.filter(([u]) => String(u) === url).map(([, init]) => JSON.parse(String((init as RequestInit).body)));

const OFF: Answer = { status: 200, body: { enabled: false, backupCodesRemaining: 0 } };
const ON = (left = 10): Answer => ({ status: 200, body: { enabled: true, backupCodesRemaining: left } });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("turning it on", () => {
  it("shows the QR and the key, sends password + code, then shows the backup codes once", async () => {
    const showToast = vi.fn();
    const fetchMock = mockNetwork({
      "/api/auth/2fa": [OFF, ON()],
      "/api/auth/2fa/setup": { status: 200, body: { secret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP", qrDataUrl: "data:image/png;base64,iVBOR" } },
      "/api/auth/2fa/enable": { status: 200, body: { success: true, backupCodes: CODES } },
    });
    render(<TwoFactorSettings showToast={showToast} />);

    fireEvent.click(await screen.findByRole("button", { name: "เริ่มตั้งค่า" }));
    const qr = await screen.findByAltText("QR สำหรับสแกนด้วยแอปยืนยันตัวตน");
    expect(qr).toHaveAttribute("src", "data:image/png;base64,iVBOR");
    expect(screen.getByLabelText("คีย์สำหรับใส่ด้วยตนเอง")).toHaveTextContent("JBSW Y3DP EHPK 3PXP");

    fireEvent.change(screen.getByLabelText("รหัส 6 หลักจากแอป"), { target: { value: "123456" } });
    fireEvent.change(screen.getByLabelText("รหัสผ่านปัจจุบัน"), { target: { value: "correct-horse" } });
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันและเปิดใช้งาน" }));

    const shown = await screen.findByRole("region", { name: "รหัสสำรอง" });
    expect(within(shown).getAllByRole("listitem").map((li) => li.textContent)).toEqual(CODES);
    expect(bodiesTo(fetchMock, "/api/auth/2fa/enable")).toEqual([{ password: "correct-horse", code: "123456" }]);
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining("อุปกรณ์อื่นทุกเครื่องถูกออกจากระบบ"), "success");
  });

  it("cannot be closed until the admin says the codes are kept", async () => {
    mockNetwork({
      "/api/auth/2fa": [OFF, ON()],
      "/api/auth/2fa/setup": { status: 200, body: { secret: "JBSWY3DPEHPK3PXP", qrDataUrl: "data:image/png;base64,x" } },
      "/api/auth/2fa/enable": { status: 200, body: { success: true, backupCodes: CODES } },
    });
    render(<TwoFactorSettings showToast={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "เริ่มตั้งค่า" }));
    fireEvent.change(await screen.findByLabelText("รหัส 6 หลักจากแอป"), { target: { value: "123456" } });
    fireEvent.change(screen.getByLabelText("รหัสผ่านปัจจุบัน"), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันและเปิดใช้งาน" }));

    const done = await screen.findByRole("button", { name: "เสร็จสิ้น" });
    expect(done).toBeDisabled();
    fireEvent.click(screen.getByLabelText("ฉันเก็บรหัสสำรองไว้ในที่ปลอดภัยแล้ว"));
    expect(done).toBeEnabled();
    fireEvent.click(done);

    // Gone from the screen for good, and the status re-read.
    expect(await screen.findByText("✅ เปิดใช้งานอยู่")).toBeInTheDocument();
    expect(screen.queryByText(CODES[0])).not.toBeInTheDocument();
  });

  it("a refusal is shown in the server's words, and the form stays", async () => {
    const showToast = vi.fn();
    mockNetwork({
      "/api/auth/2fa": OFF,
      "/api/auth/2fa/setup": { status: 200, body: { secret: "JBSWY3DPEHPK3PXP", qrDataUrl: "data:image/png;base64,x" } },
      "/api/auth/2fa/enable": { status: 403, body: { error: "รหัสผ่านไม่ถูกต้อง" } },
    });
    render(<TwoFactorSettings showToast={showToast} />);
    fireEvent.click(await screen.findByRole("button", { name: "เริ่มตั้งค่า" }));
    fireEvent.change(await screen.findByLabelText("รหัส 6 หลักจากแอป"), { target: { value: "123456" } });
    fireEvent.change(screen.getByLabelText("รหัสผ่านปัจจุบัน"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันและเปิดใช้งาน" }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("รหัสผ่านไม่ถูกต้อง", "error"));
    expect(screen.getByRole("button", { name: "ยืนยันและเปิดใช้งาน" })).toBeInTheDocument();
  });

  it("an expired session is said in Thai, not as 'Unauthorized'", async () => {
    const showToast = vi.fn();
    mockNetwork({
      "/api/auth/2fa": OFF,
      "/api/auth/2fa/setup": { status: 401, body: { error: "Unauthorized" } },
    });
    render(<TwoFactorSettings showToast={showToast} />);
    fireEvent.click(await screen.findByRole("button", { name: "เริ่มตั้งค่า" }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.stringContaining("เซสชันหมดอายุ"), "error"));
  });
});

describe("saving the backup codes", () => {
  // Shown once: a download that silently does nothing is a lockout waiting to
  // happen. The link must be in the document when clicked (some Firefox
  // versions ignore a detached one) and the blob URL must outlive the click
  // (Safari fails the download if it is revoked straight away).
  it("downloads them as a .txt — link in the page when clicked, URL revoked only later", async () => {
    // jsdom has no createObjectURL; install stand-ins and put the originals
    // back after, rather than leave a mutated global for the next test.
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    const created: Blob[] = [];
    const createObjectURL = vi.fn((blob: Blob) => {
      created.push(blob);
      return "blob:codes";
    });
    const revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    let connectedAtClick: boolean | null = null;
    let downloadName = "";
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      connectedAtClick = this.isConnected;
      downloadName = this.download;
    });
    try {
      mockNetwork({
        "/api/auth/2fa": ON(),
        "/api/auth/2fa/backup-codes": { status: 200, body: { success: true, backupCodes: CODES } },
      });
      render(<TwoFactorSettings showToast={vi.fn()} />);
      fireEvent.click(await screen.findByRole("button", { name: "สร้างรหัสสำรองชุดใหม่" }));
      const form = screen.getByRole("form", { name: "สร้างรหัสสำรองชุดใหม่" });
      fireEvent.change(within(form).getByLabelText("รหัสผ่านปัจจุบัน"), { target: { value: "pw" } });
      fireEvent.change(within(form).getByLabelText("รหัส 6 หลักจากแอป หรือรหัสสำรอง"), { target: { value: "123456" } });
      fireEvent.click(within(form).getByRole("button", { name: "สร้างรหัสสำรองชุดใหม่" }));

      const downloadButton = await screen.findByRole("button", { name: "⬇️ ดาวน์โหลดไฟล์ .txt" });
      // Hold back only the delayed revoke; every other timer runs as normal
      // (testing-library's own waiting relies on them).
      const realSetTimeout = globalThis.setTimeout;
      const heldBack: Array<() => void> = [];
      const timers = vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms?: number) => {
        if (ms === 60_000) {
          heldBack.push(fn);
          return 0;
        }
        return realSetTimeout(fn, ms);
      }) as typeof setTimeout);
      fireEvent.click(downloadButton);
      timers.mockRestore();

      expect(click).toHaveBeenCalledTimes(1);
      expect(connectedAtClick).toBe(true);
      expect(downloadName).toBe("profin-backup-codes.txt");
      expect(await created[0].text()).toContain(CODES.join("\n"));
      expect(revokeObjectURL).not.toHaveBeenCalled();
      heldBack.forEach((fn) => fn());
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:codes");
    } finally {
      click.mockRestore();
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  });
});

describe("while it is on", () => {
  it("says how many backup codes are left, and warns when few are", async () => {
    mockNetwork({ "/api/auth/2fa": ON(2) });
    render(<TwoFactorSettings showToast={vi.fn()} />);
    expect(await screen.findByText(/รหัสสำรองเหลือ 2 ชุด — ควรสร้างชุดใหม่/)).toBeInTheDocument();
  });

  it("turning it off sends the password and a code", async () => {
    const showToast = vi.fn();
    const fetchMock = mockNetwork({
      "/api/auth/2fa": [ON(), OFF],
      "/api/auth/2fa/disable": { status: 200, body: { success: true } },
    });
    render(<TwoFactorSettings showToast={showToast} />);
    fireEvent.click(await screen.findByRole("button", { name: "ปิดการยืนยันตัวตน 2 ขั้น" }));
    const form = screen.getByRole("form", { name: "ปิดการยืนยันตัวตน 2 ขั้น" });
    fireEvent.change(within(form).getByLabelText("รหัสผ่านปัจจุบัน"), { target: { value: "correct-horse" } });
    fireEvent.change(within(form).getByLabelText("รหัส 6 หลักจากแอป หรือรหัสสำรอง"), { target: { value: "ABCD-EFGH" } });
    fireEvent.click(within(form).getByRole("button", { name: "ปิดการยืนยันตัวตน 2 ขั้น" }));

    await waitFor(() => expect(showToast).toHaveBeenCalledWith("ปิดการยืนยันตัวตน 2 ขั้นแล้ว", "success"));
    expect(bodiesTo(fetchMock, "/api/auth/2fa/disable")).toEqual([{ password: "correct-horse", code: "ABCD-EFGH" }]);
    expect(await screen.findByRole("button", { name: "เริ่มตั้งค่า" })).toBeInTheDocument();
  });

  it("a new set of backup codes is shown once, like the first", async () => {
    mockNetwork({
      "/api/auth/2fa": ON(1),
      "/api/auth/2fa/backup-codes": { status: 200, body: { success: true, backupCodes: CODES } },
    });
    render(<TwoFactorSettings showToast={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "สร้างรหัสสำรองชุดใหม่" }));
    const form = screen.getByRole("form", { name: "สร้างรหัสสำรองชุดใหม่" });
    fireEvent.change(within(form).getByLabelText("รหัสผ่านปัจจุบัน"), { target: { value: "pw" } });
    fireEvent.change(within(form).getByLabelText("รหัส 6 หลักจากแอป หรือรหัสสำรอง"), { target: { value: "123456" } });
    fireEvent.click(within(form).getByRole("button", { name: "สร้างรหัสสำรองชุดใหม่" }));
    const shown = await screen.findByRole("region", { name: "รหัสสำรอง" });
    expect(within(shown).getAllByRole("listitem")).toHaveLength(10);
  });

  it("ยกเลิก leaves everything as it was", async () => {
    const fetchMock = mockNetwork({ "/api/auth/2fa": ON() });
    render(<TwoFactorSettings showToast={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "ปิดการยืนยันตัวตน 2 ขั้น" }));
    fireEvent.click(screen.getByRole("button", { name: "ยกเลิก" }));
    expect(await screen.findByText("✅ เปิดใช้งานอยู่")).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u]) => String(u) === "/api/auth/2fa/disable")).toBe(false);
  });
});

describe("loading", () => {
  it("offers a retry when the status cannot be read", async () => {
    mockNetwork({ "/api/auth/2fa": [{ status: 500, body: {} }, OFF] });
    render(<TwoFactorSettings showToast={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "ลองใหม่" }));
    expect(await screen.findByRole("button", { name: "เริ่มตั้งค่า" })).toBeInTheDocument();
  });
});
