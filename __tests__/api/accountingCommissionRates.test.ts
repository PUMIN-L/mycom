// @vitest-environment node
/**
 * The commission rate table's routes — behind the module's gate:
 *  • GET /api/accounting/commission/rates — the sets in force and the history;
 *  • POST /api/accounting/commission/rates/otp { change } — email a code for it;
 *  • PUT /api/accounting/commission/rates { otp } — the code; saves what was asked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/app/lib/db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("@/app/lib/session", () => ({ getSession: vi.fn() }));
import { getSession } from "@/app/lib/session";
vi.mock("@/app/lib/twoFactor", () => ({ getTwoFactorUser: vi.fn() }));
import { getTwoFactorUser } from "@/app/lib/twoFactor";
vi.mock("@/app/lib/accounting/commissionRates", () => ({
  loadRates: vi.fn(async () => ({ sets: [{ id: null, effectiveMonth: "0000-00" }], history: [] })),
  requestRatesCode: vi.fn(async () => ({ allowed: true })),
  confirmRatesChange: vi.fn(async () => ({ sets: [], history: [], summaryEmailSent: true })),
  RATES_OTP_TTL_MINUTES: 15,
}));
import { confirmRatesChange, loadRates, requestRatesCode } from "@/app/lib/accounting/commissionRates";

import { GET, PUT } from "@/app/api/accounting/commission/rates/route";
import { POST } from "@/app/api/accounting/commission/rates/otp/route";
import { DEFAULT_COMMISSION_RULES } from "@/app/lib/accounting/commission";

const admin = { userId: "admin-001", username: "admin", expiresAt: new Date() } as never;
const user = { id: "admin-001", username: "admin", passwordHash: "x", totpEnabled: true };
const ACTOR = { userId: "admin-001", username: "admin" };
const req = (path: string, method: string, body?: unknown) =>
  new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: { host: "localhost:3000", origin: "http://localhost:3000", "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const CHANGE = { kind: "save", effectiveMonth: "0000-00", rules: DEFAULT_COMMISSION_RULES };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(admin);
  vi.mocked(getTwoFactorUser).mockResolvedValue(user as never);
});

describe("GET /api/accounting/commission/rates", () => {
  it("the sets and the history, never cached", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ sets: [{ id: null, effectiveMonth: "0000-00" }], history: [] });
    expect(loadRates).toHaveBeenCalled();
  });
});

describe("POST /api/accounting/commission/rates/otp", () => {
  it("emails a code for the change, as the admin asking — and says where it went, masked", async () => {
    const res = await POST(req("/api/accounting/commission/rates/otp", "POST", { change: CHANGE }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(requestRatesCode).toHaveBeenCalledWith(CHANGE, ACTOR);
    expect(await res.json()).toEqual({ sent: true, email: "am****@gmail.com", minutes: 15 });
  });

  it("asked too often: 429, and how long to wait", async () => {
    vi.mocked(requestRatesCode).mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 42 });
    const res = await POST(req("/api/accounting/commission/rates/otp", "POST", { change: CHANGE }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
    expect((await res.json()).error).toBe("ขอรหัส OTP ถี่เกินไป กรุณารออีก 42 วินาที แล้วลองใหม่");
  });

  it("a change that is not a table: 400 in Thai, no code", async () => {
    const res = await POST(req("/api/accounting/commission/rates/otp", "POST", { change: { kind: "edit" } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("ข้อมูลตารางอัตราไม่ถูกต้อง");
    expect(requestRatesCode).not.toHaveBeenCalled();
  });
});

describe("PUT /api/accounting/commission/rates", () => {
  it("passes the code on — only the code; the change is the one stored with it", async () => {
    const res = await PUT(req("/api/accounting/commission/rates", "PUT", { otp: "123456", change: { kind: "remove", effectiveMonth: "0000-00" } }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(confirmRatesChange).toHaveBeenCalledWith("123456", ACTOR);
    expect(await res.json()).toEqual({ sets: [], history: [], summaryEmailSent: true });
  });
});

describe("the gate", () => {
  it("401s anonymous and 403s without two-factor login — on every route", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    expect((await POST(req("/api/accounting/commission/rates/otp", "POST", { change: CHANGE }))).status).toBe(401);
    expect((await PUT(req("/api/accounting/commission/rates", "PUT", { otp: "123456" }))).status).toBe(401);
    vi.mocked(getSession).mockResolvedValue(admin);
    vi.mocked(getTwoFactorUser).mockResolvedValue({ ...user, totpEnabled: false } as never);
    expect((await GET()).status).toBe(403);
    expect((await POST(req("/api/accounting/commission/rates/otp", "POST", { change: CHANGE }))).status).toBe(403);
    expect((await PUT(req("/api/accounting/commission/rates", "PUT", { otp: "123456" }))).status).toBe(403);
    expect(requestRatesCode).not.toHaveBeenCalled();
    expect(confirmRatesChange).not.toHaveBeenCalled();
  });
});
