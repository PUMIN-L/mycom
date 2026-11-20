// @vitest-environment node
/**
 * GET /api/accounting/sales-orders/by-date — the dashboard's "ยอดตาม PO
 * ลูกค้า". Behind the module's gate like its other routes (switched off, it
 * answers 404 and the dashboard hides the chart); a range that is not two
 * dates, backwards, or longer than a chart needs is refused before any query.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/app/lib/db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("@/app/lib/session", () => ({ getSession: vi.fn() }));
import { getSession } from "@/app/lib/session";
vi.mock("@/app/lib/twoFactor", () => ({ getTwoFactorUser: vi.fn() }));
import { getTwoFactorUser } from "@/app/lib/twoFactor";
vi.mock("@/app/lib/accounting/salesOrders", () => ({
  ordersByIssueDate: vi.fn(async () => [{ date: "2026-11-03", count: 2, exVatSatang: 15050000 }]),
}));
import { ordersByIssueDate } from "@/app/lib/accounting/salesOrders";

import { GET } from "@/app/api/accounting/sales-orders/by-date/route";

const admin = { userId: "admin-001", username: "admin", expiresAt: new Date() } as never;
const user = { id: "admin-001", username: "admin", passwordHash: "x", totpEnabled: true };
const req = (url: string) => new NextRequest(`http://localhost:3000${url}`, { headers: { host: "localhost:3000" } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(admin);
  vi.mocked(getTwoFactorUser).mockResolvedValue(user as never);
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/accounting/sales-orders/by-date", () => {
  it("answers the days of the range asked for, never cached", async () => {
    const res = await GET(req("/api/accounting/sales-orders/by-date?from=2026-01-01&to=2027-01-01"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(ordersByIssueDate).toHaveBeenCalledWith("2026-01-01", "2027-01-01");
    expect(await res.json()).toEqual({ from: "2026-01-01", to: "2027-01-01", days: [{ date: "2026-11-03", count: 2, exVatSatang: 15050000 }] });
  });

  it("answers five years — the chart's yearly view", async () => {
    const res = await GET(req("/api/accounting/sales-orders/by-date?from=2022-01-01&to=2027-01-01"));
    expect(res.status).toBe(200);
    expect(ordersByIssueDate).toHaveBeenCalledWith("2022-01-01", "2027-01-01");
  });

  it("401s anonymous and 403s without two-factor login", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await GET(req("/api/accounting/sales-orders/by-date?from=2026-01-01&to=2027-01-01"))).status).toBe(401);
    vi.mocked(getSession).mockResolvedValue(admin);
    vi.mocked(getTwoFactorUser).mockResolvedValue({ ...user, totpEnabled: false } as never);
    expect((await GET(req("/api/accounting/sales-orders/by-date?from=2026-01-01&to=2027-01-01"))).status).toBe(403);
    expect(ordersByIssueDate).not.toHaveBeenCalled();
  });

  it("answers 404 while the module is switched off on the live site — the dashboard then hides the chart", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_ACCOUNTING_ENABLED", "");
    expect((await GET(req("/api/accounting/sales-orders/by-date?from=2026-01-01&to=2027-01-01"))).status).toBe(404);
    expect(ordersByIssueDate).not.toHaveBeenCalled();
  });

  it("refuses a range that is not two dates, runs backwards, or is longer than a chart needs — in Thai", async () => {
    for (const q of [
      "",
      "?from=2026-01-01",
      "?from=2026-13-01&to=2027-01-01",
      "?from=2027-01-01&to=2026-01-01",
      "?from=2026-01-01&to=2026-01-01",
      "?from=2020-01-01&to=2027-01-01",
    ]) {
      const res = await GET(req(`/api/accounting/sales-orders/by-date${q}`));
      expect(res.status, q).toBe(400);
      expect((await res.json()).error, q).toMatch(/[฀-๿]/);
    }
    expect(ordersByIssueDate).not.toHaveBeenCalled();
  });
});
