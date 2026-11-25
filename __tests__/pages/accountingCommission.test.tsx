/**
 * /accounting/commission — the tab "ตารางอัตรา", through the real page:
 *  • the tables in force, as the owner's table writes them (0 – 100,000 …
 *    เกิน 500,000, ฟอร์ด / พี่ต่อ / บริษัท), the first "ตั้งแต่เริ่มต้น";
 *  • editing one: the company's share follows; what is wrong stops the save;
 *  • saving asks for the 6-digit code emailed to the owner, then saves with it;
 *  • a new set starts on the 1st of a month; a later set can be removed.
 */
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/accounting/commission",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

import CommissionPage from "@/app/accounting/commission/page";
import { DEFAULT_COMMISSION_RULES } from "@/app/lib/accounting/commission";

const FIRST = { id: null, effectiveMonth: "0000-00", rules: DEFAULT_COMMISSION_RULES, savedAt: null, savedBy: null };
const LATER = {
  id: "r2",
  effectiveMonth: "2029-04",
  rules: { ...DEFAULT_COMMISSION_RULES, torFlat: { fordBp: 2000, torBp: 3000 } },
  savedAt: "2026-11-25T08:00:00.000Z",
  savedBy: "admin",
};

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body, headers: new Headers() });
let rates: { sets: unknown[]; history: unknown[] };
let override: ((path: string, init?: RequestInit) => unknown) | null;
let fetchMock: ReturnType<typeof vi.fn>;
const calls = (path: string, method = "GET") =>
  fetchMock.mock.calls.filter(([u, i]) => new URL(String(u), "http://localhost").pathname === path && ((i as RequestInit | undefined)?.method ?? "GET") === method);
const bodyOf = (path: string, method: string, n = 0) => JSON.parse(String((calls(path, method)[n][1] as RequestInit).body));
const choose = (id: string, label: string) => {
  fireEvent.click(document.getElementById(id)!);
  fireEvent.click(within(document.querySelector("[data-dropdown-panel]") as HTMLElement).getByText(label));
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-25T03:00:00Z"));
  rates = { sets: [FIRST], history: [] };
  override = null;
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const custom = override?.(url.pathname, init);
    if (custom !== undefined) return custom;
    const method = init?.method ?? "GET";
    switch (`${method} ${url.pathname}`) {
      case "GET /api/accounting/status": return json({ twoFactorEnabled: true, username: "admin" });
      case "GET /api/accounting/commission/rates": return json(rates);
      case "POST /api/accounting/commission/rates/otp": return json({ sent: true, email: "am****@gmail.com", minutes: 15 });
      case "PUT /api/accounting/commission/rates": return json({ ...rates, summaryEmailSent: true });
      default: return json({});
    }
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function loaded() {
  render(<CommissionPage />);
  await screen.findByTestId("rate-set-0000-00");
}
const cells = (row: HTMLElement) => within(row).getAllByRole("cell").map((c) => c.textContent);

describe("the tables in force", () => {
  it("the owner's table, from the beginning — steps, ฟอร์ด / พี่ต่อ / บริษัท, and พี่ต่อ's customers", async () => {
    await loaded();
    const set = screen.getByTestId("rate-set-0000-00");
    expect(within(set).getByText("ตั้งแต่เริ่มต้น")).toBeInTheDocument();
    const rows = within(set).getAllByRole("row").slice(1);
    expect(rows.map(cells)).toEqual([
      ["0 – 100,000", "27%", "23%", "50%"],
      ["100,001 – 300,000", "32%", "18%", "50%"],
      ["300,001 – 500,000", "34%", "16%", "50%"],
      ["เกิน 500,000", "37%", "13%", "50%"],
      ["ดีลลูกค้าพี่ต่อ", "15%", "35%", "50%"],
    ]);
    // The first set is edited, never removed.
    expect(within(set).getByRole("button", { name: "แก้ชุดนี้" })).toBeInTheDocument();
    expect(within(set).queryByRole("button", { name: "ลบชุดนี้" })).not.toBeInTheDocument();
    expect(screen.getByText(/ต้องใส่รหัส 6 หลักที่ส่งไปทางอีเมล/)).toBeInTheDocument();
  });

  it("a later set reads by its month, and can be removed", async () => {
    rates = { sets: [FIRST, LATER], history: [] };
    await loaded();
    const set = screen.getByTestId("rate-set-2029-04");
    expect(within(set).getByText("ตั้งแต่เดือนเมษายน 2572")).toBeInTheDocument();
    expect(within(set).getByRole("button", { name: "ลบชุดนี้" })).toBeInTheDocument();
  });
});

describe("editing a set", () => {
  it("the company's share follows; what is wrong is said and stops the save", async () => {
    await loaded();
    fireEvent.click(within(screen.getByTestId("rate-set-0000-00")).getByRole("button", { name: "แก้ชุดนี้" }));
    const editor = screen.getByRole("region", { name: "แก้ตารางอัตรา ตั้งแต่เริ่มต้น" });
    const save = within(editor).getByRole("button", { name: "บันทึก — ส่งรหัสยืนยันทางอีเมล" });
    // Unchanged: nothing to save.
    expect(save).toBeDisabled();
    fireEvent.change(within(editor).getByLabelText("ขั้นที่ 2 % ฟอร์ด"), { target: { value: "33" } });
    expect(within(editor).getByTestId("company-1")).toHaveTextContent("49%");
    expect(save).toBeEnabled();
    fireEvent.change(within(editor).getByLabelText("ขั้นที่ 1 % ฟอร์ด"), { target: { value: "80" } });
    expect(within(editor).getByRole("alert")).toHaveTextContent("ขั้นที่ 1: ฟอร์ดกับพี่ต่อรวมกันเกิน 100%");
    expect(save).toBeDisabled();
    fireEvent.change(within(editor).getByLabelText("ขั้นที่ 1 % ฟอร์ด"), { target: { value: "2x" } });
    expect(within(editor).getByRole("alert")).toHaveTextContent("ขั้นที่ 1: กรอก % ของฟอร์ดเป็นตัวเลข 0–100 (ทศนิยมไม่เกิน 2 ตำแหน่ง)");
  });

  it("saving asks for the emailed code, then saves with it — and says the summary went", async () => {
    await loaded();
    fireEvent.click(within(screen.getByTestId("rate-set-0000-00")).getByRole("button", { name: "แก้ชุดนี้" }));
    const editor = screen.getByRole("region", { name: "แก้ตารางอัตรา ตั้งแต่เริ่มต้น" });
    fireEvent.change(within(editor).getByLabelText("ขั้นที่ 2 % ฟอร์ด"), { target: { value: "33" } });
    fireEvent.change(within(editor).getByLabelText("ขั้นที่ 2 % พี่ต่อ"), { target: { value: "17" } });
    fireEvent.click(within(editor).getByRole("button", { name: "บันทึก — ส่งรหัสยืนยันทางอีเมล" }));

    const dialog = await screen.findByRole("dialog", { name: "ยืนยันด้วยรหัสจากอีเมล" });
    const sent = bodyOf("/api/accounting/commission/rates/otp", "POST");
    expect(sent.change.kind).toBe("save");
    expect(sent.change.effectiveMonth).toBe("0000-00");
    expect(sent.change.rules.ladder[1]).toEqual({ upToSatang: 30_000_000, fordBp: 3300, torBp: 1700 });
    expect(sent.change.rules.ladder[3]).toEqual({ upToSatang: null, fordBp: 3700, torBp: 1300 });
    expect(within(dialog).getByText(/am\*\*\*\*@gmail\.com/)).toBeInTheDocument();

    const confirm = within(dialog).getByRole("button", { name: "ยืนยัน" });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("รหัส 6 หลักจากอีเมล"), { target: { value: "123456" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(calls("/api/accounting/commission/rates", "PUT")).toHaveLength(1));
    // Only the code: the change is the one stored with it.
    expect(bodyOf("/api/accounting/commission/rates", "PUT")).toEqual({ otp: "123456" });
    expect(await screen.findByTestId("rates-notice")).toHaveTextContent("บันทึกตารางอัตราแล้ว · ส่งอีเมลสรุปแล้ว");
    expect(screen.queryByRole("dialog", { name: "ยืนยันด้วยรหัสจากอีเมล" })).not.toBeInTheDocument();
  });

  it("a wrong code is said in the window, which stays open", async () => {
    override = (path, init) =>
      path === "/api/accounting/commission/rates" && init?.method === "PUT" ? json({ error: "รหัสยืนยันไม่ถูกต้อง" }, 400) : undefined;
    await loaded();
    fireEvent.click(within(screen.getByTestId("rate-set-0000-00")).getByRole("button", { name: "แก้ชุดนี้" }));
    const editor = screen.getByRole("region", { name: "แก้ตารางอัตรา ตั้งแต่เริ่มต้น" });
    fireEvent.change(within(editor).getByLabelText("ดีลลูกค้าพี่ต่อ % พี่ต่อ"), { target: { value: "36" } });
    fireEvent.click(within(editor).getByRole("button", { name: "บันทึก — ส่งรหัสยืนยันทางอีเมล" }));
    const dialog = await screen.findByRole("dialog", { name: "ยืนยันด้วยรหัสจากอีเมล" });
    fireEvent.change(within(dialog).getByLabelText("รหัส 6 หลักจากอีเมล"), { target: { value: "999999" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "ยืนยัน" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("รหัสยืนยันไม่ถูกต้อง");
  });

  it("asked for codes too often: the wait is said, no window opens", async () => {
    override = (path, init) =>
      path === "/api/accounting/commission/rates/otp" && init?.method === "POST"
        ? json({ error: "ขอรหัส OTP ถี่เกินไป กรุณารออีก 42 วินาที แล้วลองใหม่" }, 429)
        : undefined;
    await loaded();
    fireEvent.click(within(screen.getByTestId("rate-set-0000-00")).getByRole("button", { name: "แก้ชุดนี้" }));
    const editor = screen.getByRole("region", { name: "แก้ตารางอัตรา ตั้งแต่เริ่มต้น" });
    fireEvent.change(within(editor).getByLabelText("ขั้นที่ 2 % ฟอร์ด"), { target: { value: "33" } });
    fireEvent.click(within(editor).getByRole("button", { name: "บันทึก — ส่งรหัสยืนยันทางอีเมล" }));
    expect(await within(editor).findByText("ขอรหัส OTP ถี่เกินไป กรุณารออีก 42 วินาที แล้วลองใหม่")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "ยืนยันด้วยรหัสจากอีเมล" })).not.toBeInTheDocument();
  });
});

describe("a new set, and removing one", () => {
  it("a new set starts on the 1st of the month picked", async () => {
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มชุดใหม่" }));
    const editor = screen.getByRole("region", { name: "เพิ่มตารางอัตราชุดใหม่" });
    choose("rates-month", "มกราคม 2570");
    fireEvent.change(within(editor).getByLabelText("ขั้นที่ 1 % ฟอร์ด"), { target: { value: "30" } });
    fireEvent.change(within(editor).getByLabelText("ขั้นที่ 1 % พี่ต่อ"), { target: { value: "20" } });
    fireEvent.click(within(editor).getByRole("button", { name: "บันทึก — ส่งรหัสยืนยันทางอีเมล" }));
    await screen.findByRole("dialog", { name: "ยืนยันด้วยรหัสจากอีเมล" });
    const sent = bodyOf("/api/accounting/commission/rates/otp", "POST");
    expect(sent.change.effectiveMonth).toBe("2027-01");
    expect(sent.change.rules.ladder[0]).toEqual({ upToSatang: 10_000_000, fordBp: 3000, torBp: 2000 });
  });

  it("a new set needs its month first", async () => {
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มชุดใหม่" }));
    const editor = screen.getByRole("region", { name: "เพิ่มตารางอัตราชุดใหม่" });
    fireEvent.change(within(editor).getByLabelText("ขั้นที่ 1 % ฟอร์ด"), { target: { value: "30" } });
    expect(within(editor).getByRole("alert")).toHaveTextContent("เลือกเดือนที่เริ่มใช้");
    expect(within(editor).getByRole("button", { name: "บันทึก — ส่งรหัสยืนยันทางอีเมล" })).toBeDisabled();
  });

  it("removing a later set asks for the code too", async () => {
    rates = { sets: [FIRST, LATER], history: [] };
    await loaded();
    fireEvent.click(within(screen.getByTestId("rate-set-2029-04")).getByRole("button", { name: "ลบชุดนี้" }));
    const dialog = await screen.findByRole("dialog", { name: "ยืนยันด้วยรหัสจากอีเมล" });
    expect(bodyOf("/api/accounting/commission/rates/otp", "POST")).toEqual({ change: { kind: "remove", effectiveMonth: "2029-04" } });
    fireEvent.change(within(dialog).getByLabelText("รหัส 6 หลักจากอีเมล"), { target: { value: "123456" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "ยืนยัน" }));
    await waitFor(() => expect(calls("/api/accounting/commission/rates", "PUT")).toHaveLength(1));
  });
});
