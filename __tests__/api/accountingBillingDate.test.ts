// @vitest-environment node
/**
 * PATCH /api/accounting/documents/[id]/billing-date — { billingDate: "YYYY-MM-DD" | null }.
 * Behind the module's gate like its other routes; what the browser sends is
 * cleaned before the store sees it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/app/lib/db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("@/app/lib/session", () => ({ getSession: vi.fn() }));
import { getSession } from "@/app/lib/session";
vi.mock("@/app/lib/twoFactor", () => ({ getTwoFactorUser: vi.fn() }));
import { getTwoFactorUser } from "@/app/lib/twoFactor";
vi.mock("@/app/lib/accounting/documents", () => ({
  setInvoiceBillingDate: vi.fn(async (id: string, billingDate: string | null) => ({ id, billingDate })),
}));
import { setInvoiceBillingDate } from "@/app/lib/accounting/documents";

import { PATCH } from "@/app/api/accounting/documents/[id]/billing-date/route";

const admin = { userId: "admin-001", username: "admin", expiresAt: new Date() } as never;
const user = { id: "admin-001", username: "admin", passwordHash: "x", totpEnabled: true };
const ctx = { params: Promise.resolve({ id: "d3" }) };
const patch = (body: unknown) =>
  new NextRequest("http://localhost:3000/api/accounting/documents/d3/billing-date", {
    method: "PATCH",
    headers: { host: "localhost:3000", origin: "http://localhost:3000", "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(admin);
  vi.mocked(getTwoFactorUser).mockResolvedValue(user as never);
});

describe("PATCH /api/accounting/documents/[id]/billing-date", () => {
  it("sets the day, as the admin who did it, never cached", async () => {
    const res = await PATCH(patch({ billingDate: " 2026-11-30 " }), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(setInvoiceBillingDate).toHaveBeenCalledWith("d3", "2026-11-30", { userId: "admin-001", username: "admin" });
    expect(await res.json()).toEqual({ id: "d3", billingDate: "2026-11-30" });
  });

  it("clears it with null or an empty value", async () => {
    await PATCH(patch({ billingDate: null }), ctx);
    await PATCH(patch({ billingDate: "" }), ctx);
    expect(vi.mocked(setInvoiceBillingDate).mock.calls.map((c) => c[1])).toEqual([null, null]);
  });

  it("refuses anything but a date's text or null — in Thai", async () => {
    for (const body of [{ billingDate: 20261130 }, {}, { billingDate: ["2026-11-30"] }]) {
      const res = await PATCH(patch(body), ctx);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("วันวางบิลไม่ถูกต้อง");
    }
    expect(setInvoiceBillingDate).not.toHaveBeenCalled();
  });

  it("401s anonymous and 403s without two-factor login", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await PATCH(patch({ billingDate: "2026-11-30" }), ctx)).status).toBe(401);
    vi.mocked(getSession).mockResolvedValue(admin);
    vi.mocked(getTwoFactorUser).mockResolvedValue({ ...user, totpEnabled: false } as never);
    expect((await PATCH(patch({ billingDate: "2026-11-30" }), ctx)).status).toBe(403);
    expect(setInvoiceBillingDate).not.toHaveBeenCalled();
  });
});
