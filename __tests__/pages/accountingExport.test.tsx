/**
 * The accountant's Excel (step 9), through the real page: last month by
 * default (the one filed), any of the last 24 months; the password again
 * before the server answers; the browser writes the file with what came back.
 */
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/accounting/export",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));
vi.mock("@/app/lib/xlsxExport", () => ({ downloadExcel: vi.fn(async () => {}) }));
import { downloadExcel } from "@/app/lib/xlsxExport";

import AccountingExportPage from "@/app/accounting/export/page";

const SHEETS = [{ name: "ภาษีขาย", rows: [{ "เลขที่ใบกำกับภาษี": "INV2026110001" }] }];
const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
let override: ((path: string, init?: RequestInit) => unknown) | null;
let fetchMock: ReturnType<typeof vi.fn>;
const calls = (path: string, method = "GET") =>
  fetchMock.mock.calls.filter(([u, i]) => new URL(String(u), "http://localhost").pathname === path && ((i as RequestInit | undefined)?.method ?? "GET") === method);
const choose = (id: string, label: string) => {
  fireEvent.click(document.getElementById(id)!);
  fireEvent.click(within(document.querySelector("[data-dropdown-panel]") as HTMLElement).getByText(label));
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-19T03:00:00Z"));
  vi.mocked(downloadExcel).mockClear();
  override = null;
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const custom = override?.(url.pathname, init);
    if (custom !== undefined) return custom;
    if (url.pathname === "/api/accounting/status") return json({ twoFactorEnabled: true, username: "admin" });
    if (url.pathname === "/api/accounting/export") return json({ filename: "accounting-2026-11.xlsx", sheets: SHEETS });
    return json([]);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the accountant's Excel", () => {
  it("opens on last month — the one filed — and says what the file holds", async () => {
    render(<AccountingExportPage />);
    expect(await screen.findByRole("button", { name: "ดาวน์โหลด Excel เดือนตุลาคม 2569" })).toBeInTheDocument();
    expect(within(screen.getByTestId("export-sheets")).getAllByRole("listitem")).toHaveLength(6);
    expect(screen.getByRole("link", { name: "Excel นักบัญชี" })).toHaveAttribute("href", "/accounting/export");
  });

  it("asks the password again, then writes the file the server built for the month picked", async () => {
    render(<AccountingExportPage />);
    await screen.findByRole("button", { name: "ดาวน์โหลด Excel เดือนตุลาคม 2569" });
    choose("export-month", "พฤศจิกายน 2569");
    fireEvent.click(screen.getByRole("button", { name: "ดาวน์โหลด Excel เดือนพฤศจิกายน 2569" }));
    const dialog = screen.getByRole("dialog", { name: "ดาวน์โหลด Excel เดือนพฤศจิกายน 2569?" });
    fireEvent.change(within(dialog).getByLabelText(/รหัสผ่าน/), { target: { value: "pw" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "ดาวน์โหลด" }));
    expect(await screen.findByRole("status")).toHaveTextContent("ดาวน์โหลดแล้ว — ไฟล์ accounting-2026-11.xlsx");
    expect(JSON.parse(String((calls("/api/accounting/export", "POST")[0][1] as RequestInit).body))).toEqual({ month: "2026-11", password: "pw" });
    expect(downloadExcel).toHaveBeenCalledWith("accounting-2026-11.xlsx", SHEETS);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("a wrong password says so in the dialog — no file", async () => {
    override = (path, init) => (path === "/api/accounting/export" && init?.method === "POST" ? json({ error: "รหัสผ่านปัจจุบันไม่ถูกต้อง" }, 403) : undefined);
    render(<AccountingExportPage />);
    fireEvent.click(await screen.findByRole("button", { name: "ดาวน์โหลด Excel เดือนตุลาคม 2569" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/รหัสผ่าน/), { target: { value: "wrong" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "ดาวน์โหลด" }));
    expect(await within(dialog).findByText("รหัสผ่านปัจจุบันไม่ถูกต้อง")).toBeInTheDocument();
    expect(downloadExcel).not.toHaveBeenCalled();
  });

  it("says the file could not be made when writing it fails — the dialog stays to try again", async () => {
    vi.mocked(downloadExcel).mockRejectedValueOnce(new Error("quota"));
    render(<AccountingExportPage />);
    fireEvent.click(await screen.findByRole("button", { name: "ดาวน์โหลด Excel เดือนตุลาคม 2569" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/รหัสผ่าน/), { target: { value: "pw" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "ดาวน์โหลด" }));
    expect(await within(dialog).findByText("สร้างไฟล์ Excel ไม่สำเร็จ ลองใหม่อีกครั้ง")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  });
});
