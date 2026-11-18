// @vitest-environment node
/**
 * /api/accounting/documents… — behind the same gate as the rest of the
 * module; a draft deleted as is, an ISSUED one only with the password again;
 * dates and types checked before anything is read.
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

vi.mock("@/app/lib/accounting/documents", () => ({
  listAccDocuments: vi.fn(async () => []),
  createInvoiceDraft: vi.fn(async () => ({ id: "d1" })),
  getAccDocument: vi.fn(),
  updateInvoiceDraft: vi.fn(async () => ({ id: "d1" })),
  deleteAccDocument: vi.fn(async () => ({ docNo: null })),
  deletionImpact: vi.fn(),
  issueInvoice: vi.fn(async () => ({ id: "d1", status: "issued" })),
  peekNextDocNo: vi.fn(async () => "INV2026110008"),
  documentSummary: vi.fn(async () => ({})),
  recordExternalInvoice: vi.fn(async () => ({ id: "x1" })),
  updateExternalReference: vi.fn(async () => ({ id: "x1" })),
  recentExternalNotes: vi.fn(async () => ["แฟ้ม 2569"]),
}));
import * as docs from "@/app/lib/accounting/documents";
vi.mock("@/app/lib/accounting/settings", () => ({
  getSellerProfile: vi.fn(async () => ({ seller: { name: "เรา" }, versionId: "v1" })),
  getSellerVersion: vi.fn(async () => ({ name: "เราเวอร์ชันเก่า" })),
}));

import { GET as list, POST as create } from "@/app/api/accounting/documents/route";
import { GET as getOne, PUT as update, DELETE as remove } from "@/app/api/accounting/documents/[id]/route";
import { POST as issue } from "@/app/api/accounting/documents/[id]/issue/route";
import { GET as nextNumber } from "@/app/api/accounting/documents/next-number/route";
import { GET as summary } from "@/app/api/accounting/documents/summary/route";
import { GET as externalNotes, POST as recordExternal } from "@/app/api/accounting/documents/external/route";
import { PATCH as fixReference } from "@/app/api/accounting/documents/[id]/external/route";

const admin = { userId: "admin-001", username: "admin", expiresAt: new Date() } as never;
const user = { id: "admin-001", username: "admin", passwordHash: "x", totpEnabled: true };
const req = (url: string, init: { method?: string; body?: unknown } = {}) =>
  new NextRequest(`http://localhost:3000${url}`, {
    method: init.method ?? "GET",
    headers: { host: "localhost:3000", origin: "http://localhost:3000", "content-type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const impact = (status: string) => ({ status, docNo: status === "draft" ? null : "INV2026110005", isLatestNumber: true, livePayments: 0, dependentDocs: 0, sale: null, machines: { total: 0, withHistory: 0 } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(admin);
  vi.mocked(getTwoFactorUser).mockResolvedValue(user);
  vi.mocked(requirePassword).mockResolvedValue(null);
});

describe("the gate", () => {
  it("401s anonymous and 403s without two-factor login, on every document route", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await list(req("/api/accounting/documents"))).status).toBe(401);
    vi.mocked(getSession).mockResolvedValue(admin);
    vi.mocked(getTwoFactorUser).mockResolvedValue({ ...user, totpEnabled: false });
    expect((await create(req("/api/accounting/documents", { method: "POST", body: {} }))).status).toBe(403);
    expect((await issue(req("/api/accounting/documents/d1/issue", { method: "POST", body: {} }), ctx("d1"))).status).toBe(403);
    expect(docs.createInvoiceDraft).not.toHaveBeenCalled();
    expect(docs.issueInvoice).not.toHaveBeenCalled();
  });
});

describe("GET /api/accounting/documents", () => {
  it("passes the type, range and search through", async () => {
    await list(req("/api/accounting/documents?type=INV&from=2026-01-01&to=2027-01-01&q=PO-1"));
    expect(docs.listAccDocuments).toHaveBeenCalledWith({ type: "INV", from: "2026-01-01", to: "2027-01-01", q: "PO-1" });
  });

  it("refuses an unknown type or a date that does not exist", async () => {
    expect((await list(req("/api/accounting/documents?type=XX"))).status).toBe(400);
    expect((await list(req("/api/accounting/documents?from=2026-02-31"))).status).toBe(400);
    expect(docs.listAccDocuments).not.toHaveBeenCalled();
  });
});

describe("GET /api/accounting/documents/[id]", () => {
  it("prints an issued document under the company version it was issued with", async () => {
    vi.mocked(docs.getAccDocument).mockResolvedValue({ id: "d1", sellerVersionId: "v0" } as never);
    vi.mocked(docs.deletionImpact).mockResolvedValue(impact("issued") as never);
    const body = await (await getOne(req("/api/accounting/documents/d1"), ctx("d1"))).json();
    expect(body.seller).toEqual({ name: "เราเวอร์ชันเก่า" });
    expect(body.impact.isLatestNumber).toBe(true);
  });

  it("404s a document that is not there", async () => {
    vi.mocked(docs.getAccDocument).mockResolvedValue(null);
    expect((await getOne(req("/api/accounting/documents/x"), ctx("x"))).status).toBe(404);
  });
});

describe("PUT /api/accounting/documents/[id]", () => {
  it("passes the editor's updatedAt along, so a save over a newer one is refused", async () => {
    await update(req("/api/accounting/documents/d1", { method: "PUT", body: { buyerName: "ก", expectedUpdatedAt: "t1" } }), ctx("d1"));
    expect(vi.mocked(docs.updateInvoiceDraft).mock.calls[0][3]).toBe("t1");
  });
});

describe("DELETE /api/accounting/documents/[id]", () => {
  it("deletes a draft without asking for the password", async () => {
    vi.mocked(docs.deletionImpact).mockResolvedValue(impact("draft") as never);
    const res = await remove(req("/api/accounting/documents/d1", { method: "DELETE" }), ctx("d1"));
    expect(res.status).toBe(200);
    expect(requirePassword).not.toHaveBeenCalled();
    expect(docs.deleteAccDocument).toHaveBeenCalledWith("d1", expect.anything(), { passwordChecked: false });
  });

  it("asks for the password for an issued one, and deletes nothing on a wrong one", async () => {
    vi.mocked(docs.deletionImpact).mockResolvedValue(impact("issued") as never);
    vi.mocked(requirePassword).mockResolvedValue(NextResponse.json({ error: "รหัสผ่านปัจจุบันไม่ถูกต้อง" }, { status: 403 }));
    const res = await remove(req("/api/accounting/documents/d1", { method: "DELETE", body: { password: "wrong" } }), ctx("d1"));
    expect(res.status).toBe(403);
    expect(docs.deleteAccDocument).not.toHaveBeenCalled();
  });

  it("deletes an issued one with the right password, telling the store it was checked", async () => {
    vi.mocked(docs.deletionImpact).mockResolvedValue(impact("issued") as never);
    const res = await remove(req("/api/accounting/documents/d1", { method: "DELETE", body: { password: "right" } }), ctx("d1"));
    expect(res.status).toBe(200);
    expect(requirePassword).toHaveBeenCalledWith(user, "right");
    expect(docs.deleteAccDocument).toHaveBeenCalledWith("d1", expect.anything(), { passwordChecked: true });
  });

  it("404s a document that is not there", async () => {
    vi.mocked(docs.deletionImpact).mockResolvedValue(null);
    expect((await remove(req("/api/accounting/documents/x", { method: "DELETE" }), ctx("x"))).status).toBe(404);
  });
});

describe("issue / next number / summary", () => {
  it("issues with the editor's updatedAt", async () => {
    await issue(req("/api/accounting/documents/d1/issue", { method: "POST", body: { expectedUpdatedAt: "t1" } }), ctx("d1"));
    expect(docs.issueInvoice).toHaveBeenCalledWith("d1", expect.anything(), "t1");
  });

  it("previews the next number only for a real type and date", async () => {
    expect(await (await nextNumber(req("/api/accounting/documents/next-number?type=INV&date=2026-11-18"))).json()).toEqual({ docNo: "INV2026110008" });
    expect((await nextNumber(req("/api/accounting/documents/next-number?type=SO&date=2026-11-18"))).status).toBe(400);
    expect((await nextNumber(req("/api/accounting/documents/next-number?type=INV&date=2026-13-01"))).status).toBe(400);
  });

  it("summarises the month asked for (this month by default)", async () => {
    await summary(req("/api/accounting/documents/summary?month=2026-10"));
    expect(vi.mocked(docs.documentSummary).mock.calls[0].slice(1)).toEqual(["2026-10-01", "2026-11-01"]);
    expect((await summary(req("/api/accounting/documents/summary?month=2026-13"))).status).toBe(400);
  });
});

describe("outside documents", () => {
  it("records one with its number, storage note and printed VAT", async () => {
    const res = await recordExternal(req("/api/accounting/documents/external", { method: "POST", body: { buyerName: "ก", docNo: " IV-42 ", externalNote: "แฟ้ม", vatSatangOverride: 406002, lines: [] } }));
    expect(res.status).toBe(201);
    expect(vi.mocked(docs.recordExternalInvoice).mock.calls[0][1]).toEqual({ docNo: "IV-42", externalNote: "แฟ้ม", vatSatangOverride: 406002 });
  });

  it("suggests where papers were kept lately", async () => {
    expect(await (await externalNotes()).json()).toEqual({ notes: ["แฟ้ม 2569"] });
  });

  it("fixes a number with a reason", async () => {
    await fixReference(req("/api/accounting/documents/x1/external", { method: "PATCH", body: { docNo: " IV-0042 ", externalNote: "แฟ้ม", reason: "พิมพ์ผิด" } }), ctx("x1"));
    expect(docs.updateExternalReference).toHaveBeenCalledWith("x1", { docNo: "IV-0042", externalNote: "แฟ้ม", reason: "พิมพ์ผิด" }, expect.anything());
  });

  it("is behind the same gate", async () => {
    vi.mocked(getTwoFactorUser).mockResolvedValue({ ...user, totpEnabled: false });
    expect((await recordExternal(req("/api/accounting/documents/external", { method: "POST", body: {} }))).status).toBe(403);
    expect(docs.recordExternalInvoice).not.toHaveBeenCalled();
  });
});
