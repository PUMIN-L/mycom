// @vitest-environment node
/**
 * The commission month and a PO's cost breakdown — behind the module's gate:
 *  • GET /api/accounting/commission?month=YYYY-MM
 *  • GET /api/accounting/commission/orders/[id]/costs
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/app/lib/db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("@/app/lib/session", () => ({ getSession: vi.fn() }));
import { getSession } from "@/app/lib/session";
vi.mock("@/app/lib/twoFactor", () => ({ getTwoFactorUser: vi.fn() }));
import { getTwoFactorUser } from "@/app/lib/twoFactor";
vi.mock("@/app/lib/accounting/commissionData", () => ({
  commissionMonth: vi.fn(async (month: string) => (month === "2026-11" ? { month, rows: [] } : null)),
  commissionCosts: vi.fn(async (id: string) => (id === "so1" ? { poId: id, deliveries: [] } : null)),
}));
import { commissionCosts, commissionMonth } from "@/app/lib/accounting/commissionData";

import { GET as monthGET } from "@/app/api/accounting/commission/route";
import { GET as costsGET } from "@/app/api/accounting/commission/orders/[id]/costs/route";

const admin = { userId: "admin-001", username: "admin", expiresAt: new Date() } as never;
const user = { id: "admin-001", username: "admin", passwordHash: "x", totpEnabled: true };
const get = (path: string) => new NextRequest(`http://localhost:3000${path}`);
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(admin);
  vi.mocked(getTwoFactorUser).mockResolvedValue(user as never);
});

describe("GET /api/accounting/commission", () => {
  it("the month by PO date, never cached", async () => {
    const res = await monthGET(get("/api/accounting/commission?month=2026-11"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(commissionMonth).toHaveBeenCalledWith("2026-11");
    expect(await res.json()).toEqual({ month: "2026-11", rows: [] });
  });

  it("400 in Thai for a month that is not one, or none", async () => {
    for (const path of ["/api/accounting/commission?month=2026-13", "/api/accounting/commission"]) {
      const res = await monthGET(get(path));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("เดือนไม่ถูกต้อง");
    }
  });
});

describe("GET /api/accounting/commission/orders/[id]/costs", () => {
  it("what the PO's profit is made of, never cached", async () => {
    const res = await costsGET(get("/api/accounting/commission/orders/so1/costs"), ctx("so1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(commissionCosts).toHaveBeenCalledWith("so1");
    expect(await res.json()).toEqual({ poId: "so1", deliveries: [] });
  });

  it("404 for anything but a customer PO", async () => {
    const res = await costsGET(get("/api/accounting/commission/orders/nope/costs"), ctx("nope"));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("ไม่พบ PO ลูกค้านี้");
  });
});

describe("the gate", () => {
  it("401s anonymous and 403s without two-factor login", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await monthGET(get("/api/accounting/commission?month=2026-11"))).status).toBe(401);
    expect((await costsGET(get("/api/accounting/commission/orders/so1/costs"), ctx("so1"))).status).toBe(401);
    vi.mocked(getSession).mockResolvedValue(admin);
    vi.mocked(getTwoFactorUser).mockResolvedValue({ ...user, totpEnabled: false } as never);
    expect((await monthGET(get("/api/accounting/commission?month=2026-11"))).status).toBe(403);
    expect((await costsGET(get("/api/accounting/commission/orders/so1/costs"), ctx("so1"))).status).toBe(403);
    expect(commissionMonth).not.toHaveBeenCalled();
    expect(commissionCosts).not.toHaveBeenCalled();
  });
});
