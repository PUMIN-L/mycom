// @vitest-environment node
/**
 * POST /api/accounting/export — the accountant's monthly workbook: behind the
 * module's gate; the month checked first (a slip spends no password try),
 * then the password; a line in the audit log; never cached.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@/app/lib/db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("@/app/lib/session", () => ({ getSession: vi.fn() }));
import { getSession } from "@/app/lib/session";
vi.mock("@/app/lib/twoFactor", () => ({ getTwoFactorUser: vi.fn() }));
import { getTwoFactorUser } from "@/app/lib/twoFactor";
vi.mock("@/app/lib/twoFactorReauth", () => ({ requirePassword: vi.fn() }));
import { requirePassword } from "@/app/lib/twoFactorReauth";
vi.mock("@/app/lib/accounting/audit", () => ({ writeAudit: vi.fn(async () => {}) }));
import { writeAudit } from "@/app/lib/accounting/audit";
vi.mock("@/app/lib/accounting/exportData", () => ({
  monthlyWorkbookData: vi.fn(async (month: string) => ({
    month,
    seller: { name: "บริษัท โปรฟิน แล็บ จำกัด", address: "", taxId: "0107537000114", branchCode: "00000", phone: "", email: "" },
    salesTax: [], externalReceipts: [], register: [], payments: [], receivables: [], deposits: [],
  })),
}));
import { monthlyWorkbookData } from "@/app/lib/accounting/exportData";

import { POST as exportMonth } from "@/app/api/accounting/export/route";

const admin = { userId: "admin-001", username: "admin", expiresAt: new Date() } as never;
const user = { id: "admin-001", username: "admin", passwordHash: "x", totpEnabled: true };
const post = (body: unknown) =>
  new NextRequest("http://localhost:3000/api/accounting/export", {
    method: "POST",
    headers: { host: "localhost:3000", origin: "http://localhost:3000", "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(admin);
  vi.mocked(getTwoFactorUser).mockResolvedValue(user);
  vi.mocked(requirePassword).mockResolvedValue(null);
});

describe("POST /api/accounting/export", () => {
  it("401s anonymous, 403s without two-factor login — reading nothing", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await exportMonth(post({ month: "2026-11", password: "pw" }))).status).toBe(401);
    vi.mocked(getSession).mockResolvedValue(admin);
    vi.mocked(getTwoFactorUser).mockResolvedValue({ ...user, totpEnabled: false });
    expect((await exportMonth(post({ month: "2026-11", password: "pw" }))).status).toBe(403);
    expect(monthlyWorkbookData).not.toHaveBeenCalled();
  });

  it("checks the month first — a slip there spends no password try", async () => {
    const res = await exportMonth(post({ month: "2026-13", password: "pw" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "กรุณาเลือกเดือน" });
    expect(requirePassword).not.toHaveBeenCalled();
    expect(monthlyWorkbookData).not.toHaveBeenCalled();
  });

  it("then the password — a wrong one reads nothing and logs nothing", async () => {
    vi.mocked(requirePassword).mockResolvedValueOnce(NextResponse.json({ error: "รหัสผ่านปัจจุบันไม่ถูกต้อง" }, { status: 403 }));
    expect((await exportMonth(post({ month: "2026-11", password: "wrong" }))).status).toBe(403);
    expect(monthlyWorkbookData).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("answers the month's six sheets, never cached, and logs the download", async () => {
    const res = await exportMonth(post({ month: "2026-11", password: "pw" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(requirePassword).toHaveBeenCalledWith(user, "pw");
    expect(monthlyWorkbookData).toHaveBeenCalledWith("2026-11");
    const body = await res.json();
    expect(body.filename).toBe("accounting-2026-11.xlsx");
    expect(body.sheets.map((s: { name: string }) => s.name)).toEqual(["ภาษีขาย", "ทะเบียนเอกสาร", "รับชำระ", "หัก ณ ที่จ่าย", "ลูกหนี้คงค้าง", "มัดจำคงเหลือ"]);
    expect(writeAudit).toHaveBeenCalledWith(null, { userId: "admin-001", username: "admin", action: "data.export", detail: "ส่งออก Excel สำหรับนักบัญชี เดือน พฤศจิกายน 2569" });
  });
});
