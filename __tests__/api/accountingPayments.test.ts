// @vitest-environment node
/**
 * The payment routes — behind the module's gate like the rest; voiding asks
 * for a reason and then the password again (a missing reason spends no
 * password try); what the browser sends is cleaned before the store sees it.
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

vi.mock("@/app/lib/accounting/payments", () => ({
  paymentContext: vi.fn(),
  recordPayment: vi.fn(async () => ({ payment: { id: "p1" }, receipt: { id: "re1", docNo: "RE2026110001" }, paidSatang: 2033000 })),
  voidPayment: vi.fn(async () => ({ id: "p1", voidedAt: "x" })),
  updateCert50: vi.fn(async () => ({ id: "p1", cert50Received: true })),
  receivables: vi.fn(async () => ({ groups: [] })),
  receiptDetail: vi.fn(async () => ({ payment: { id: "p1" }, invoice: { id: "inv1" } })),
}));
import * as payments from "@/app/lib/accounting/payments";
vi.mock("@/app/lib/accounting/documents", () => ({
  getAccDocument: vi.fn(),
  deletionImpact: vi.fn(async () => ({ status: "issued" })),
}));
import * as docs from "@/app/lib/accounting/documents";
vi.mock("@/app/lib/accounting/settings", () => ({
  getSellerProfile: vi.fn(async () => ({ seller: { name: "เรา" }, versionId: "v1" })),
  getSellerVersion: vi.fn(async () => ({ name: "เรา" })),
}));

import { GET as listPayments, POST as pay } from "@/app/api/accounting/documents/[id]/payments/route";
import { PATCH as cert50 } from "@/app/api/accounting/payments/[id]/route";
import { POST as voidIt } from "@/app/api/accounting/payments/[id]/void/route";
import { GET as receivables } from "@/app/api/accounting/receivables/route";
import { GET as getOne } from "@/app/api/accounting/documents/[id]/route";

const admin = { userId: "admin-001", username: "admin", expiresAt: new Date() } as never;
const user = { id: "admin-001", username: "admin", passwordHash: "x", totpEnabled: true };
const actor = { userId: "admin-001", username: "admin" };
const req = (url: string, init: { method?: string; body?: unknown } = {}) =>
  new NextRequest(`http://localhost:3000${url}`, {
    method: init.method ?? "GET",
    headers: { host: "localhost:3000", origin: "http://localhost:3000", "content-type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(admin);
  vi.mocked(getTwoFactorUser).mockResolvedValue(user);
  vi.mocked(requirePassword).mockResolvedValue(null);
});

describe("the gate", () => {
  it("401s anonymous and 403s without two-factor login, on every payment route", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await listPayments(req("/api/accounting/documents/inv1/payments"), ctx("inv1"))).status).toBe(401);
    expect((await receivables()).status).toBe(401);
    vi.mocked(getSession).mockResolvedValue(admin);
    vi.mocked(getTwoFactorUser).mockResolvedValue({ ...user, totpEnabled: false });
    expect((await pay(req("/api/accounting/documents/inv1/payments", { method: "POST", body: {} }), ctx("inv1"))).status).toBe(403);
    expect((await voidIt(req("/api/accounting/payments/p1/void", { method: "POST", body: { reason: "x", password: "pw" } }), ctx("p1"))).status).toBe(403);
    expect((await cert50(req("/api/accounting/payments/p1", { method: "PATCH", body: {} }), ctx("p1"))).status).toBe(403);
    expect(payments.recordPayment).not.toHaveBeenCalled();
    expect(payments.voidPayment).not.toHaveBeenCalled();
    expect(payments.updateCert50).not.toHaveBeenCalled();
  });
});

describe("/api/accounting/documents/[id]/payments", () => {
  it("lists an invoice's payments and what the dialog needs, never cached", async () => {
    vi.mocked(payments.paymentContext).mockResolvedValue({ payments: [], outstandingSatang: 2033000, serviceBaseSatang: 1900000, defaultWhtPercent: 3, receiptIsTaxInvoice: true });
    const res = await listPayments(req("/api/accounting/documents/inv1/payments"), ctx("inv1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toMatchObject({ defaultWhtPercent: 3 });
  });

  it("404s for what is not an invoice", async () => {
    vi.mocked(payments.paymentContext).mockResolvedValue(null);
    expect((await listPayments(req("/api/accounting/documents/re1/payments"), ctx("re1"))).status).toBe(404);
  });

  it("records a payment from cleaned input — cash goes into no account; no withholding, no certificate", async () => {
    const res = await pay(
      req("/api/accounting/documents/inv1/payments", {
        method: "POST",
        body: { paidDate: "2026-11-18", method: "cash", bankAccountId: "b1", amountSatang: "2033000", whtPercent: 3, whtSatang: 0, cert50Received: true, note: " ok " },
      }),
      ctx("inv1")
    );
    expect(res.status).toBe(201);
    expect(payments.recordPayment).toHaveBeenCalledWith(
      "inv1",
      expect.objectContaining({ method: "cash", bankAccountId: "", amountSatang: 2033000, whtPercent: 0, whtSatang: 0, cert50Received: false, note: "ok" }),
      actor
    );
  });
});

describe("POST /api/accounting/payments/[id]/void", () => {
  it("asks for the reason first — no password try spent on a missing one", async () => {
    const res = await voidIt(req("/api/accounting/payments/p1/void", { method: "POST", body: { reason: "  ", password: "pw" } }), ctx("p1"));
    expect(res.status).toBe(400);
    expect(requirePassword).not.toHaveBeenCalled();
    expect(payments.voidPayment).not.toHaveBeenCalled();
  });

  it("then the password", async () => {
    vi.mocked(requirePassword).mockResolvedValue(NextResponse.json({ error: "รหัสผ่านปัจจุบันไม่ถูกต้อง" }, { status: 403 }));
    const res = await voidIt(req("/api/accounting/payments/p1/void", { method: "POST", body: { reason: "ผิด", password: "nope" } }), ctx("p1"));
    expect(res.status).toBe(403);
    expect(requirePassword).toHaveBeenCalledWith(user, "nope");
    expect(payments.voidPayment).not.toHaveBeenCalled();
  });

  it("voids with the reason, trimmed", async () => {
    const res = await voidIt(req("/api/accounting/payments/p1/void", { method: "POST", body: { reason: " บันทึกยอดผิด ", password: "pw" } }), ctx("p1"));
    expect(res.status).toBe(200);
    expect(payments.voidPayment).toHaveBeenCalledWith("p1", "บันทึกยอดผิด", actor);
  });
});

describe("PATCH /api/accounting/payments/[id]", () => {
  it("passes only a real true as received", async () => {
    await cert50(req("/api/accounting/payments/p1", { method: "PATCH", body: { cert50Received: "yes", cert50Note: "แฟ้ม" } }), ctx("p1"));
    expect(payments.updateCert50).toHaveBeenCalledWith("p1", { received: false, note: "แฟ้ม" }, actor);
    await cert50(req("/api/accounting/payments/p1", { method: "PATCH", body: { cert50Received: true, cert50Note: "แฟ้ม" } }), ctx("p1"));
    expect(payments.updateCert50).toHaveBeenLastCalledWith("p1", { received: true, note: "แฟ้ม" }, actor);
  });
});

describe("GET /api/accounting/receivables", () => {
  it("ages from today in Bangkok", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-18T18:30:00.000Z")); // 01:30 on the 19th in Bangkok
    try {
      const res = await receivables();
      expect(res.status).toBe(200);
      expect(payments.receivables).toHaveBeenCalledWith("2026-11-19");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("GET /api/accounting/documents/[id] — a receipt", () => {
  it("brings the payment it records and the invoice it pays", async () => {
    vi.mocked(docs.getAccDocument).mockResolvedValue({ id: "re1", docType: "RE", sellerVersionId: "v1", relatedDocId: "inv1" } as never);
    const body = await (await getOne(req("/api/accounting/documents/re1"), ctx("re1"))).json();
    expect(payments.receiptDetail).toHaveBeenCalledWith("re1", "inv1");
    expect(body.receipt).toEqual({ payment: { id: "p1" }, invoice: { id: "inv1" } });
  });

  it("an invoice brings no receipt part", async () => {
    vi.mocked(docs.getAccDocument).mockResolvedValue({ id: "inv1", docType: "INV", sellerVersionId: "v1", relatedDocId: null } as never);
    const body = await (await getOne(req("/api/accounting/documents/inv1"), ctx("inv1"))).json();
    expect(payments.receiptDetail).not.toHaveBeenCalled();
    expect(body).not.toHaveProperty("receipt");
  });
});
