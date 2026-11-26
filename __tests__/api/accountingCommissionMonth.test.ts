// @vitest-environment node
/**
 * The commission month and a PO's cost breakdown — behind the module's gate:
 *  • GET /api/accounting/commission?month=YYYY-MM
 *  • GET /api/accounting/commission/orders/[id]/costs
 *  • PUT /api/accounting/commission/orders/[id]/costs — one delivery's costs edited
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/app/lib/db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("@/app/lib/session", () => ({ getSession: vi.fn() }));
import { getSession } from "@/app/lib/session";
vi.mock("@/app/lib/twoFactor", () => ({ getTwoFactorUser: vi.fn() }));
import { getTwoFactorUser } from "@/app/lib/twoFactor";
vi.mock("@/app/lib/accounting/commissionData", () => ({
  commissionMonth: vi.fn(async (month: string) =>
    month === "2026-11" ? { month, rows: [] } : month === "2026-12" ? { month, rows: [{ id: "so1", customerPoNo: "PO-1", fordSatang: 100 }] } : null
  ),
  commissionCosts: vi.fn(async (id: string) => (id === "so1" ? { poId: id, deliveries: [] } : null)),
  commissionCostsFor: vi.fn(async (pos: { id: string }[]) => Object.fromEntries(pos.map((p) => [p.id, { poId: p.id, deliveries: [] }]))),
}));
import { commissionCosts, commissionCostsFor, commissionMonth } from "@/app/lib/accounting/commissionData";
vi.mock("@/app/lib/accounting/commissionCostEdit", () => ({
  editDeliveryCosts: vi.fn(async (id: string) => ({ poId: id, deliveries: [] })),
}));
import { editDeliveryCosts } from "@/app/lib/accounting/commissionCostEdit";

import { GET as monthGET } from "@/app/api/accounting/commission/route";
import { GET as costsGET, PUT as costsPUT } from "@/app/api/accounting/commission/orders/[id]/costs/route";

const admin = { userId: "admin-001", username: "admin", expiresAt: new Date() } as never;
const user = { id: "admin-001", username: "admin", passwordHash: "x", totpEnabled: true };
const ACTOR = { userId: "admin-001", username: "admin" };
const get = (path: string) => new NextRequest(`http://localhost:3000${path}`);
const put = (path: string, body: unknown) =>
  new NextRequest(`http://localhost:3000${path}`, {
    method: "PUT",
    headers: { host: "localhost:3000", origin: "http://localhost:3000", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
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
    expect(commissionCostsFor).not.toHaveBeenCalled();
  });

  it("with every PO's costs when asked — for the Excel", async () => {
    const res = await monthGET(get("/api/accounting/commission?month=2026-12&withCosts=1"));
    expect(res.status).toBe(200);
    expect(commissionCostsFor).toHaveBeenCalledWith([{ id: "so1", customerPoNo: "PO-1" }]);
    expect(await res.json()).toEqual({
      month: "2026-12",
      rows: [{ id: "so1", customerPoNo: "PO-1", fordSatang: 100 }],
      costs: { so1: { poId: "so1", deliveries: [] } },
    });
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

describe("PUT /api/accounting/commission/orders/[id]/costs", () => {
  it("one delivery's costs saved as the admin who did it — answers the PO's costs as they are now, never cached", async () => {
    const body = { saleId: "s1", expectedCostSatang: 0, lines: [{ id: "l1", costSatang: 100 }] };
    const res = await costsPUT(put("/api/accounting/commission/orders/so1/costs", body), ctx("so1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(editDeliveryCosts).toHaveBeenCalledWith("so1", body, ACTOR);
    expect(await res.json()).toEqual({ poId: "so1", deliveries: [] });
  });
});

describe("the gate", () => {
  it("401s anonymous and 403s without two-factor login", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await monthGET(get("/api/accounting/commission?month=2026-11"))).status).toBe(401);
    expect((await costsGET(get("/api/accounting/commission/orders/so1/costs"), ctx("so1"))).status).toBe(401);
    expect((await costsPUT(put("/api/accounting/commission/orders/so1/costs", { saleId: "s1" }), ctx("so1"))).status).toBe(401);
    vi.mocked(getSession).mockResolvedValue(admin);
    vi.mocked(getTwoFactorUser).mockResolvedValue({ ...user, totpEnabled: false } as never);
    expect((await monthGET(get("/api/accounting/commission?month=2026-11"))).status).toBe(403);
    expect((await costsGET(get("/api/accounting/commission/orders/so1/costs"), ctx("so1"))).status).toBe(403);
    expect((await costsPUT(put("/api/accounting/commission/orders/so1/costs", { saleId: "s1" }), ctx("so1"))).status).toBe(403);
    expect(commissionMonth).not.toHaveBeenCalled();
    expect(commissionCosts).not.toHaveBeenCalled();
    expect(editDeliveryCosts).not.toHaveBeenCalled();
  });
});
