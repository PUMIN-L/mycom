// @vitest-environment node
/**
 * Marking a PO's commission paid, undoing the mark, and the payout summary —
 * behind the module's gate:
 *  • POST /api/accounting/commission/payouts { salesOrderId, paidDate }
 *  • POST /api/accounting/commission/payouts/[id]/void { reason }
 *  • GET  /api/accounting/commission/payouts?from&to[&withCosts=1] (the PDF's data)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/app/lib/db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("@/app/lib/session", () => ({ getSession: vi.fn() }));
import { getSession } from "@/app/lib/session";
vi.mock("@/app/lib/twoFactor", () => ({ getTwoFactorUser: vi.fn() }));
import { getTwoFactorUser } from "@/app/lib/twoFactor";
vi.mock("@/app/lib/accounting/commissionPayouts", () => ({
  recordPayout: vi.fn(async () => ({ id: "pay1" })),
  voidPayout: vi.fn(async () => {}),
}));
import { recordPayout, voidPayout } from "@/app/lib/accounting/commissionPayouts";
vi.mock("@/app/lib/accounting/commissionReport", () => ({
  payoutReport: vi.fn(async (from: string, to: string) => ({ from, to, rows: [] })),
}));
import { payoutReport } from "@/app/lib/accounting/commissionReport";

import { GET as report, POST as record } from "@/app/api/accounting/commission/payouts/route";
import { POST as undo } from "@/app/api/accounting/commission/payouts/[id]/void/route";

const admin = { userId: "admin-001", username: "admin", expiresAt: new Date() } as never;
const user = { id: "admin-001", username: "admin", passwordHash: "x", totpEnabled: true };
const ACTOR = { userId: "admin-001", username: "admin" };
const post = (path: string, body: unknown) =>
  new NextRequest(`http://localhost:3000${path}`, {
    method: "POST",
    headers: { host: "localhost:3000", origin: "http://localhost:3000", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const ctx = { params: Promise.resolve({ id: "pay1" }) };
const get = (path: string) => new NextRequest(`http://localhost:3000${path}`);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(admin);
  vi.mocked(getTwoFactorUser).mockResolvedValue(user as never);
});

describe("POST /api/accounting/commission/payouts", () => {
  it("marks it paid as the admin who did it, never cached", async () => {
    const res = await record(post("/api/accounting/commission/payouts", { salesOrderId: "C", paidDate: " 2026-11-25 " }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(recordPayout).toHaveBeenCalledWith("C", "2026-11-25", ACTOR);
    expect(await res.json()).toEqual({ id: "pay1" });
  });

  it("needs a PO — in Thai", async () => {
    for (const body of [{ paidDate: "2026-11-25" }, { salesOrderId: 5, paidDate: "2026-11-25" }, { salesOrderId: "C", paidDate: 20261125 }]) {
      const res = await record(post("/api/accounting/commission/payouts", body));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("ข้อมูลการจ่ายค่าคอมไม่ถูกต้อง");
    }
    expect(recordPayout).not.toHaveBeenCalled();
  });
});

describe("POST /api/accounting/commission/payouts/[id]/void", () => {
  it("undoes the mark with the reason", async () => {
    const res = await undo(post("/api/accounting/commission/payouts/pay1/void", { reason: "จ่ายผิดคน" }), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(voidPayout).toHaveBeenCalledWith("pay1", "จ่ายผิดคน", ACTOR);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("GET /api/accounting/commission/payouts", () => {
  it("what was paid in the range — for the PDF — as the admin who asked, never cached", async () => {
    const res = await report(get("/api/accounting/commission/payouts?from=2026-11-01&to=2026-11-30"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(payoutReport).toHaveBeenCalledWith("2026-11-01", "2026-11-30", { withCosts: false, exportedBy: "admin" });
    expect(await res.json()).toEqual({ from: "2026-11-01", to: "2026-11-30", rows: [] });
  });

  it("with each PO's costs when asked", async () => {
    await report(get("/api/accounting/commission/payouts?from=2026-11-01&to=2026-11-30&withCosts=1"));
    expect(payoutReport).toHaveBeenCalledWith("2026-11-01", "2026-11-30", { withCosts: true, exportedBy: "admin" });
  });
});

describe("the gate", () => {
  it("401s anonymous and 403s without two-factor login", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await record(post("/api/accounting/commission/payouts", { salesOrderId: "C", paidDate: "2026-11-25" }))).status).toBe(401);
    expect((await undo(post("/api/accounting/commission/payouts/pay1/void", { reason: "x" }), ctx)).status).toBe(401);
    expect((await report(get("/api/accounting/commission/payouts?from=2026-11-01&to=2026-11-30"))).status).toBe(401);
    vi.mocked(getSession).mockResolvedValue(admin);
    vi.mocked(getTwoFactorUser).mockResolvedValue({ ...user, totpEnabled: false } as never);
    expect((await record(post("/api/accounting/commission/payouts", { salesOrderId: "C", paidDate: "2026-11-25" }))).status).toBe(403);
    expect((await undo(post("/api/accounting/commission/payouts/pay1/void", { reason: "x" }), ctx)).status).toBe(403);
    expect((await report(get("/api/accounting/commission/payouts?from=2026-11-01&to=2026-11-30"))).status).toBe(403);
    expect(recordPayout).not.toHaveBeenCalled();
    expect(voidPayout).not.toHaveBeenCalled();
    expect(payoutReport).not.toHaveBeenCalled();
  });
});
