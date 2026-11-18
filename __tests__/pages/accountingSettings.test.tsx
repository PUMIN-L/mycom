/**
 * /accounting and /accounting/settings, through the real pages:
 *  • until two-factor login is on, the pages say so (with the way to turn it
 *    on) and ask the API for nothing else;
 *  • the settings form says what is wrong under the field, asks for the
 *    password before saving, and shows a wrong password in that dialog;
 *  • bank accounts are added from the page;
 *  • the home page lists what is still to set up.
 */
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/accounting/settings",
  useSearchParams: () => new URLSearchParams(),
}));

import AccountingSettingsPage from "@/app/accounting/settings/page";
import AccountingHomePage from "@/app/accounting/page";

const SETTINGS = {
  seller: { name: "", address: "93 ซอยงามวงศ์วาน นนทบุรี", taxId: "", branchCode: "00000", phone: "062-012-9895", email: "" },
  sellerVersionId: null as string | null,
  vatRate: 7,
  creditDays: 30,
  bankAccounts: [] as unknown[],
};

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
let statusBody: { status: number; body: unknown };
let override: ((path: string, init?: RequestInit) => unknown) | null;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  statusBody = { status: 200, body: { twoFactorEnabled: true, username: "admin" } };
  override = null;
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const custom = override?.(url.pathname, init);
    if (custom !== undefined) return custom;
    if (url.pathname === "/api/accounting/status") return json(statusBody.body, statusBody.status);
    if (url.pathname === "/api/accounting/settings") return json(SETTINGS);
    if (url.pathname === "/api/accounting/audit") return json([]);
    if (url.pathname === "/api/accounting/bank-accounts") return json([]);
    return json({});
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const calls = (path: string, method = "GET") =>
  fetchMock.mock.calls.filter(([u, i]) => new URL(String(u), "http://localhost").pathname === path && ((i as RequestInit | undefined)?.method ?? "GET") === method);

describe("the gate", () => {
  it("says to turn two-factor login on first, with the way there — and loads nothing else", async () => {
    statusBody = { status: 200, body: { twoFactorEnabled: false, username: "admin" } };
    render(<AccountingSettingsPage />);
    expect(await screen.findByText("เปิดการยืนยันตัวตนสองขั้นตอน (2FA) ก่อนใช้ระบบบัญชี")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ไปเปิด 2FA ที่หน้าตั้งค่า" })).toHaveAttribute("href", "/settings#two-factor");
    expect(calls("/api/accounting/settings")).toHaveLength(0);
  });

  it("says the module is not open yet when the API answers 404", async () => {
    statusBody = { status: 404, body: { error: "ไม่พบหน้านี้" } };
    render(<AccountingSettingsPage />);
    expect(await screen.findByText("ระบบบัญชียังไม่เปิดใช้งาน")).toBeInTheDocument();
  });

  it("offers to sign in again when the session has gone", async () => {
    statusBody = { status: 401, body: { error: "Unauthorized" } };
    render(<AccountingSettingsPage />);
    expect(await screen.findByRole("link", { name: "เข้าสู่ระบบ" })).toHaveAttribute("href", "/login?next=/accounting");
  });
});

describe("/accounting/settings", () => {
  async function loaded() {
    render(<AccountingSettingsPage />);
    await screen.findByLabelText(/ชื่อบริษัทตามที่จดทะเบียน/);
  }

  it("before the first save, says the company must be set up, starting from the website's address", async () => {
    await loaded();
    expect(screen.getByText(/ยังไม่ได้ตั้งข้อมูลบริษัทสำหรับพิมพ์บนเอกสาร/)).toBeInTheDocument();
    expect((screen.getByLabelText(/ที่อยู่ตามที่จดทะเบียน/) as HTMLTextAreaElement).value).toBe("93 ซอยงามวงศ์วาน นนทบุรี");
  });

  it("says what is wrong under the field, and asks for no password until it is right", async () => {
    await loaded();
    fireEvent.change(screen.getByLabelText(/ชื่อบริษัทตามที่จดทะเบียน/), { target: { value: "บริษัท โปรฟิน แล็บ จำกัด" } });
    fireEvent.change(screen.getByLabelText(/เลขประจำตัวผู้เสียภาษี/), { target: { value: "0107537000115" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึกการตั้งค่า" }));
    expect(screen.getByText(/เลขประจำตัวผู้เสียภาษีไม่ถูกต้อง/)).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByLabelText(/เลขประจำตัวผู้เสียภาษี/));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("asks for the password, shows a wrong one in the dialog, and saves with the right one", async () => {
    let attempts = 0;
    override = (path, init) => {
      if (path === "/api/accounting/settings" && init?.method === "PUT") {
        attempts += 1;
        if (attempts === 1) return json({ error: "รหัสผ่านปัจจุบันไม่ถูกต้อง" }, 403);
        return json({ ...SETTINGS, sellerVersionId: "v1", seller: { ...SETTINGS.seller, name: "บริษัท โปรฟิน แล็บ จำกัด", taxId: "0107537000114" } });
      }
      return undefined;
    };
    await loaded();
    fireEvent.change(screen.getByLabelText(/ชื่อบริษัทตามที่จดทะเบียน/), { target: { value: "บริษัท โปรฟิน แล็บ จำกัด" } });
    fireEvent.change(screen.getByLabelText(/เลขประจำตัวผู้เสียภาษี/), { target: { value: "0-1075-37000-11-4" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึกการตั้งค่า" }));

    const dialog = screen.getByRole("dialog", { name: "ยืนยันการบันทึกข้อมูลบริษัท" });
    expect(within(dialog).getByText("เลขผู้เสียภาษี 0-1075-37000-11-4")).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/รหัสผ่านของคุณ/), { target: { value: "wrong" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "บันทึก" }));
    expect(await within(dialog).findByText("รหัสผ่านปัจจุบันไม่ถูกต้อง")).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText(/รหัสผ่านของคุณ/), { target: { value: "right" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "บันทึก" }));
    expect(await screen.findByText("บันทึกการตั้งค่าแล้ว")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();

    const body = JSON.parse(String((calls("/api/accounting/settings", "PUT")[1][1] as RequestInit).body));
    expect(body).toMatchObject({ password: "right", vatRate: 7, creditDays: 30 });
    expect(body.seller).toMatchObject({ name: "บริษัท โปรฟิน แล็บ จำกัด", taxId: "0107537000114", branchCode: "00000" });
  });

  it("adds a bank account and lists it", async () => {
    let created = false;
    override = (path, init) => {
      if (path === "/api/accounting/bank-accounts" && init?.method === "POST") {
        created = true;
        return json({ id: "b1" }, 201);
      }
      if (path === "/api/accounting/bank-accounts") {
        return json(created ? [{ id: "b1", bankName: "กสิกรไทย", accountNo: "123-4-56789-0", accountName: "", isActive: true, sortOrder: 1 }] : []);
      }
      return undefined;
    };
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "+ เพิ่มบัญชี" }));
    fireEvent.change(screen.getByLabelText("ธนาคาร"), { target: { value: "กสิกรไทย" } });
    fireEvent.change(screen.getByLabelText("เลขที่บัญชี"), { target: { value: "123-4-56789-0" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึกบัญชี" }));
    expect(await screen.findByText("123-4-56789-0")).toBeInTheDocument();
    expect(JSON.parse(String((calls("/api/accounting/bank-accounts", "POST")[0][1] as RequestInit).body))).toMatchObject({
      bankName: "กสิกรไทย",
      accountNo: "123-4-56789-0",
    });
  });
});

describe("/accounting", () => {
  it("lists what is still to set up before the first document", async () => {
    render(<AccountingHomePage />);
    const steps = await screen.findByTestId("acc-setup-steps");
    expect(screen.getByText("ตั้งค่าให้ครบก่อนเริ่มออกเอกสาร")).toBeInTheDocument();
    expect(within(steps).getAllByText("ยังไม่ได้ทำ")).toHaveLength(2);
    expect(within(steps).getAllByRole("link", { name: "ไปตั้งค่า" })[0]).toHaveAttribute("href", "/accounting/settings");
  });
});
