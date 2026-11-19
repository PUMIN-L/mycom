// @vitest-environment node
/**
 * The credit-note, invoice-void and refund routes (step 8) — behind the
 * module's gate like the rest; what the browser sends is cleaned before the
 * store sees it; voiding a tax document asks a reason FIRST (a typo there
 * spends no password try), then the password.
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

vi.mock("@/app/lib/accounting/creditNotes", () => ({
  listCreditNotes: vi.fn(async () => []),
  issueCreditNote: vi.fn(async () => ({ id: "cn1", docType: "CN", docNo: "CN2026110001" })),
  creditContext: vi.fn(),
  voidCreditNote: vi.fn(async () => ({ id: "cn1", status: "void" })),
  recordRefund: vi.fn(async () => {}),
}));
import * as credits from "@/app/lib/accounting/creditNotes";
vi.mock("@/app/lib/accounting/documents", () => ({ voidInvoice: vi.fn(async () => ({ id: "inv1", status: "void" })) }));
import { voidInvoice } from "@/app/lib/accounting/documents";

import { GET as list, POST as issue } from "@/app/api/accounting/credit-notes/route";
import { GET as context } from "@/app/api/accounting/credit-notes/context/route";
import { POST as voidCredit } from "@/app/api/accounting/credit-notes/[id]/void/route";
import { POST as voidInv } from "@/app/api/accounting/documents/[id]/void/route";
import { POST as refund } from "@/app/api/accounting/documents/[id]/refunds/route";

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
const post = (url: string, body?: unknown, raw?: string) => req(url, { method: "POST", body, raw });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(admin);
  vi.mocked(getTwoFactorUser).mockResolvedValue(user);
  vi.mocked(requirePassword).mockResolvedValue(null);
});

describe("the gate", () => {
  it("401s anonymous and 403s without two-factor login, on every route", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await list(req("/api/accounting/credit-notes"))).status).toBe(401);
    expect((await context(req("/api/accounting/credit-notes/context?invoice=inv1"))).status).toBe(401);
    expect((await issue(post("/api/accounting/credit-notes", {}))).status).toBe(401);
    vi.mocked(getSession).mockResolvedValue(admin);
    vi.mocked(getTwoFactorUser).mockResolvedValue({ ...user, totpEnabled: false });
    expect((await voidCredit(post("/api/accounting/credit-notes/cn1/void", { reason: "x", password: "p" }), ctx("cn1"))).status).toBe(403);
    expect((await voidInv(post("/api/accounting/documents/inv1/void", { reason: "x", password: "p" }), ctx("inv1"))).status).toBe(403);
    expect((await refund(post("/api/accounting/documents/inv1/refunds", {}), ctx("inv1"))).status).toBe(403);
    expect(credits.issueCreditNote).not.toHaveBeenCalled();
    expect(credits.voidCreditNote).not.toHaveBeenCalled();
    expect(voidInvoice).not.toHaveBeenCalled();
    expect(credits.recordRefund).not.toHaveBeenCalled();
  });
});

describe("/api/accounting/credit-notes", () => {
  it("lists in the range and search asked for, never cached — refuses a range that is not dates", async () => {
    const res = await list(req("/api/accounting/credit-notes?from=2026-11-01&to=2026-12-01&q=CN"));
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(credits.listCreditNotes).toHaveBeenCalledWith({ from: "2026-11-01", to: "2026-12-01", q: "CN" });
    expect((await list(req("/api/accounting/credit-notes?from=2026-02-30"))).status).toBe(400);
  });

  it("issues one from a cleaned body — 201", async () => {
    const res = await issue(
      post("/api/accounting/credit-notes", {
        invoiceId: "inv1",
        issueDate: "2026-11-19",
        reason: "  รับคืนสินค้า  ",
        lines: [{ lineType: "goods", productId: "p1", name: "เครื่องวัดความดัน", qty: 1, unit: "เครื่อง", unitPriceSatang: 100000, discountSatang: 0, isMachine: true, serials: "SN1", sourceLineId: "pol1" }],
      })
    );
    expect(res.status).toBe(201);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const [input, who] = vi.mocked(credits.issueCreditNote).mock.calls[0];
    expect(who).toEqual(actor);
    expect(input).toMatchObject({ invoiceId: "inv1", issueDate: "2026-11-19", reason: "รับคืนสินค้า" });
    expect(input.lines[0]).toMatchObject({ isMachine: false, serials: "", sourceLineId: "" });
  });
});

describe("/api/accounting/credit-notes/context", () => {
  it("answers what a credit note against the invoice needs — 404 when it is not an issued invoice", async () => {
    vi.mocked(credits.creditContext).mockResolvedValueOnce({ invoice: { id: "inv1" }, credit: {}, creditNotes: [], refundDueSatang: 0 } as never);
    const res = await context(req("/api/accounting/credit-notes/context?invoice=inv1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(credits.creditContext).toHaveBeenCalledWith("inv1");
    vi.mocked(credits.creditContext).mockResolvedValueOnce(null);
    expect((await context(req("/api/accounting/credit-notes/context?invoice=nope"))).status).toBe(404);
  });
});

describe.each([
  ["a credit note", voidCredit, "/api/accounting/credit-notes/cn1/void", "cn1", () => credits.voidCreditNote],
  ["an invoice", voidInv, "/api/accounting/documents/inv1/void", "inv1", () => voidInvoice],
] as const)("voiding %s", (_label, route, url, id, store) => {
  it("asks the reason first — a blank one spends no password try", async () => {
    const res = await route(post(url, { reason: "  ", password: "secret" }), ctx(id));
    expect(res.status).toBe(400);
    expect(requirePassword).not.toHaveBeenCalled();
    expect(store()).not.toHaveBeenCalled();
    expect((await route(post(url, undefined, "nope"), ctx(id))).status).toBe(400);
  });

  it("then the password — a wrong one stops it", async () => {
    vi.mocked(requirePassword).mockResolvedValueOnce(NextResponse.json({ error: "รหัสผ่านไม่ถูกต้อง" }, { status: 403 }));
    expect((await route(post(url, { reason: "ออกผิด", password: "wrong" }), ctx(id))).status).toBe(403);
    expect(store()).not.toHaveBeenCalled();
  });

  it("voids it with the reason, trimmed, never cached", async () => {
    const res = await route(post(url, { reason: " ออกผิดลูกค้า ", password: "secret" }), ctx(id));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(requirePassword).toHaveBeenCalledWith(user, "secret");
    expect(store()).toHaveBeenCalledWith(id, "ออกผิดลูกค้า", actor);
  });
});

describe("/api/accounting/documents/[id]/refunds", () => {
  it("records a refund from a cleaned body — 201", async () => {
    const res = await refund(post("/api/accounting/documents/inv1/refunds", { paidDate: "2026-11-19", method: "transfer", bankAccountId: "bank1", amountSatang: 107000.4, note: " โอนคืน " }), ctx("inv1"));
    expect(res.status).toBe(201);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(credits.recordRefund).toHaveBeenCalledWith("inv1", { paidDate: "2026-11-19", method: "transfer", bankAccountId: "bank1", amountSatang: 107000, note: "โอนคืน" }, actor);
  });

  it("an unknown method is a transfer; cash names no account; an amount that is not a number is refused by the store", async () => {
    await refund(post("/api/accounting/documents/inv1/refunds", { paidDate: "2026-11-19", method: "bitcoin", bankAccountId: "bank1", amountSatang: "abc" }), ctx("inv1"));
    expect(vi.mocked(credits.recordRefund).mock.calls[0][1]).toMatchObject({ method: "transfer", amountSatang: -1, note: "" });
    await refund(post("/api/accounting/documents/inv1/refunds", { paidDate: "2026-11-19", method: "cash", bankAccountId: "bank1", amountSatang: 5000 }), ctx("inv1"));
    expect(vi.mocked(credits.recordRefund).mock.calls[1][1]).toMatchObject({ method: "cash", bankAccountId: "" });
  });
});
