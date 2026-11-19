// @vitest-environment node
/**
 * The billing-note routes — behind the module's gate like the rest; what the
 * browser sends is cleaned before the store sees it; cancelling asks for a
 * reason, not the password (not a tax document).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/app/lib/db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("@/app/lib/session", () => ({ getSession: vi.fn() }));
import { getSession } from "@/app/lib/session";
vi.mock("@/app/lib/twoFactor", () => ({ getTwoFactorUser: vi.fn() }));
import { getTwoFactorUser } from "@/app/lib/twoFactor";
vi.mock("@/app/lib/twoFactorReauth", () => ({ requirePassword: vi.fn() }));
import { requirePassword } from "@/app/lib/twoFactorReauth";

vi.mock("@/app/lib/accounting/billingNotes", () => ({
  listBillingNotes: vi.fn(async () => []),
  createBillingNote: vi.fn(async () => ({ id: "bn1", docType: "BN", docNo: "BN2026110001" })),
  openInvoicesFor: vi.fn(async () => []),
  billingNoteDetail: vi.fn(),
  recordBillingPayment: vi.fn(async () => ({ receipts: [{ id: "re1", docNo: "RE2026110007", title: "ใบเสร็จรับเงิน" }], groupId: "g1" })),
  voidBillingNote: vi.fn(async () => ({ id: "bn1", status: "void" })),
}));
import * as billing from "@/app/lib/accounting/billingNotes";
vi.mock("@/app/lib/accounting/documents", () => ({ deletionImpact: vi.fn(async () => ({ status: "issued" })) }));
vi.mock("@/app/lib/accounting/settings", () => ({
  getSellerProfile: vi.fn(async () => ({ seller: { name: "เรา (ปัจจุบัน)" }, versionId: "v2" })),
  getSellerVersion: vi.fn(async () => ({ name: "เรา (ตอนวางบิล)" })),
}));

import { GET as list, POST as create } from "@/app/api/accounting/billing-notes/route";
import { GET as openInvoices } from "@/app/api/accounting/billing-notes/open-invoices/route";
import { GET as getOne } from "@/app/api/accounting/billing-notes/[id]/route";
import { POST as pay } from "@/app/api/accounting/billing-notes/[id]/payments/route";
import { POST as cancel } from "@/app/api/accounting/billing-notes/[id]/void/route";

const admin = { userId: "admin-001", username: "admin", expiresAt: new Date() } as never;
const user = { id: "admin-001", username: "admin", passwordHash: "x", totpEnabled: true };
const actor = { userId: "admin-001", username: "admin" };
const req = (url: string, init: { method?: string; body?: unknown; raw?: string } = {}) =>
  new NextRequest(`http://localhost:3000${url}`, {
    method: init.method ?? "GET",
    headers: { host: "localhost:3000", origin: "http://localhost:3000", "content-type": "application/json" },
    body: init.raw ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(admin);
  vi.mocked(getTwoFactorUser).mockResolvedValue(user);
  vi.mocked(requirePassword).mockResolvedValue(null);
});

describe("the gate", () => {
  it("401s anonymous and 403s without two-factor login, on every billing-note route", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await list(req("/api/accounting/billing-notes"))).status).toBe(401);
    expect((await openInvoices(req("/api/accounting/billing-notes/open-invoices?companyId=co1"))).status).toBe(401);
    expect((await getOne(req("/api/accounting/billing-notes/bn1"), ctx("bn1"))).status).toBe(401);
    vi.mocked(getSession).mockResolvedValue(admin);
    vi.mocked(getTwoFactorUser).mockResolvedValue({ ...user, totpEnabled: false });
    expect((await create(req("/api/accounting/billing-notes", { method: "POST", body: {} }))).status).toBe(403);
    expect((await pay(req("/api/accounting/billing-notes/bn1/payments", { method: "POST", body: {} }), ctx("bn1"))).status).toBe(403);
    expect((await cancel(req("/api/accounting/billing-notes/bn1/void", { method: "POST", body: { reason: "x" } }), ctx("bn1"))).status).toBe(403);
    expect(billing.createBillingNote).not.toHaveBeenCalled();
    expect(billing.recordBillingPayment).not.toHaveBeenCalled();
    expect(billing.voidBillingNote).not.toHaveBeenCalled();
  });
});

describe("/api/accounting/billing-notes", () => {
  it("lists in the range and search asked for, never cached — refuses a range that is not dates", async () => {
    const res = await list(req("/api/accounting/billing-notes?from=2026-11-01&to=2026-12-01&q=BN"));
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(billing.listBillingNotes).toHaveBeenCalledWith({ from: "2026-11-01", to: "2026-12-01", q: "BN" });
    expect((await list(req("/api/accounting/billing-notes?to=2026-13-01"))).status).toBe(400);
  });

  it("makes one from a cleaned body — each invoice once — 201", async () => {
    const res = await create(
      req("/api/accounting/billing-notes", { method: "POST", body: { companyId: "co1", invoiceIds: ["A", "B", "A"], issueDate: "2026-11-19", dueDate: "2026-11-30", note: " นัดรับเช็ค " } })
    );
    expect(res.status).toBe(201);
    expect(billing.createBillingNote).toHaveBeenCalledWith(
      { companyId: "co1", buyerName: "", invoiceIds: ["A", "B"], issueDate: "2026-11-19", dueDate: "2026-11-30", note: "นัดรับเช็ค" },
      actor
    );
  });

  it("lists a customer's open invoices, by record or by name", async () => {
    await openInvoices(req("/api/accounting/billing-notes/open-invoices?buyerName=%E0%B8%A3%E0%B9%89%E0%B8%B2%E0%B8%99"));
    expect(billing.openInvoicesFor).toHaveBeenCalledWith({ companyId: "", buyerName: "ร้าน" });
  });
});

describe("/api/accounting/billing-notes/[id]", () => {
  it("brings the note with our company as it was when billed, and what deleting it would do; 404 for none", async () => {
    vi.mocked(billing.billingNoteDetail).mockResolvedValueOnce({ note: { id: "bn1", sellerVersionId: "v1" } } as never);
    const res = await getOne(req("/api/accounting/billing-notes/bn1"), ctx("bn1"));
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toMatchObject({ seller: { name: "เรา (ตอนวางบิล)" }, impact: { status: "issued" } });
    vi.mocked(billing.billingNoteDetail).mockResolvedValueOnce(null);
    expect((await getOne(req("/api/accounting/billing-notes/zzz"), ctx("zzz"))).status).toBe(404);
  });

  it("records money received against it from a cleaned body — 201", async () => {
    const res = await pay(req("/api/accounting/billing-notes/bn1/payments", { method: "POST", body: { paidDate: "2026-11-19", method: "cheque", amountSatang: "160500", whtSatang: 1500, whtPercent: 3 } }), ctx("bn1"));
    expect(res.status).toBe(201);
    const [id, input, who] = vi.mocked(billing.recordBillingPayment).mock.calls[0];
    expect([id, who]).toEqual(["bn1", actor]);
    expect(input).toMatchObject({ amountSatang: 160500, method: "cheque", whtSatang: 1500, whtPercent: 3 });
  });

  it("cancels with the reason — no password; a body that is not JSON passes no reason", async () => {
    await cancel(req("/api/accounting/billing-notes/bn1/void", { method: "POST", body: { reason: "วางบิลใหม่" } }), ctx("bn1"));
    expect(billing.voidBillingNote).toHaveBeenCalledWith("bn1", "วางบิลใหม่", actor);
    expect(requirePassword).not.toHaveBeenCalled();
    await cancel(req("/api/accounting/billing-notes/bn1/void", { method: "POST", raw: "nope" }), ctx("bn1"));
    expect(billing.voidBillingNote).toHaveBeenLastCalledWith("bn1", "", actor);
  });
});
