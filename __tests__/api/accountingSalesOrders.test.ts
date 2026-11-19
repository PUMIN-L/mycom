// @vitest-environment node
/**
 * The customer-PO routes — behind the module's gate like the rest (switched
 * off, the dashboard's backlog answers 404 and its section hides); what the
 * browser sends is cleaned before the store sees it; "today" is Bangkok's;
 * cancelling asks for a reason, not the password (not a tax matter).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/app/lib/db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("@/app/lib/session", () => ({ getSession: vi.fn() }));
import { getSession } from "@/app/lib/session";
vi.mock("@/app/lib/twoFactor", () => ({ getTwoFactorUser: vi.fn() }));
import { getTwoFactorUser } from "@/app/lib/twoFactor";
vi.mock("@/app/lib/twoFactorReauth", () => ({ requirePassword: vi.fn() }));
import { requirePassword } from "@/app/lib/twoFactorReauth";

vi.mock("@/app/lib/accounting/salesOrders", () => ({
  listSalesOrders: vi.fn(async () => []),
  createSalesOrder: vi.fn(async () => ({ id: "so1", docType: "SO" })),
  orderBacklog: vi.fn(async (today: string) => ({ today, rows: [], totals: { backlogSatang: 0, count: 0, lateSatang: 0, lateCount: 0 } })),
  salesOrderDetail: vi.fn(),
  updateSalesOrder: vi.fn(async () => ({ id: "so1" })),
  updateSalesOrderSchedule: vi.fn(async () => ({ id: "so1" })),
  cancelSalesOrder: vi.fn(async () => ({ id: "so1", status: "void" })),
  saveSalesOrderPlan: vi.fn(async () => []),
}));
import * as orders from "@/app/lib/accounting/salesOrders";
vi.mock("@/app/lib/accounting/documents", () => ({ deletionImpact: vi.fn(async () => ({ status: "issued", blockedReason: null })) }));
import { deletionImpact } from "@/app/lib/accounting/documents";

import { GET as list, POST as create } from "@/app/api/accounting/sales-orders/route";
import { GET as backlog } from "@/app/api/accounting/sales-orders/backlog/route";
import { GET as getOne, PUT as put, PATCH as patch } from "@/app/api/accounting/sales-orders/[id]/route";
import { POST as cancel } from "@/app/api/accounting/sales-orders/[id]/cancel/route";
import { GET as deposits, POST as deposit } from "@/app/api/accounting/sales-orders/[id]/deposits/route";
import { PUT as plan } from "@/app/api/accounting/sales-orders/[id]/plan/route";
vi.mock("@/app/lib/accounting/deposits", () => ({
  depositContext: vi.fn(),
  recordDeposit: vi.fn(async () => ({ payment: { id: "p1" }, receipt: { id: "re1", docNo: "RE2026110007", title: "ใบเสร็จรับเงิน/ใบกำกับภาษี" }, paidSatang: 3210000 })),
}));
import * as depositStore from "@/app/lib/accounting/deposits";

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

const ORDER_BODY = {
  issueDate: "2026-11-10", creditDays: 30, companyId: "co1", customerId: "c1", buyerName: "บริษัท เอ จำกัด",
  priceMode: "exclusive", discountSatang: 0, isTaxInvoice: true, customerPoNo: " PO-6611 ", salesOrderId: "so-x",
  expectedDeliveryDate: "2026-11-30", storageNote: "แฟ้ม PO",
  lines: [{ lineType: "goods", name: "เครื่องชั่ง", qty: 2, unit: "เครื่อง", unitPriceSatang: 5000000, isMachine: true, serials: "SN-1", sourceLineId: "l-x", warrantyMonths: 12 }],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(admin);
  vi.mocked(getTwoFactorUser).mockResolvedValue(user);
  vi.mocked(requirePassword).mockResolvedValue(null);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("the gate", () => {
  it("401s anonymous and 403s without two-factor login, on every customer-PO route", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await list(req("/api/accounting/sales-orders"))).status).toBe(401);
    expect((await backlog()).status).toBe(401);
    expect((await getOne(req("/api/accounting/sales-orders/so1"), ctx("so1"))).status).toBe(401);
    vi.mocked(getSession).mockResolvedValue(admin);
    vi.mocked(getTwoFactorUser).mockResolvedValue({ ...user, totpEnabled: false });
    expect((await create(req("/api/accounting/sales-orders", { method: "POST", body: ORDER_BODY }))).status).toBe(403);
    expect((await put(req("/api/accounting/sales-orders/so1", { method: "PUT", body: ORDER_BODY }), ctx("so1"))).status).toBe(403);
    expect((await patch(req("/api/accounting/sales-orders/so1", { method: "PATCH", body: {} }), ctx("so1"))).status).toBe(403);
    expect((await cancel(req("/api/accounting/sales-orders/so1/cancel", { method: "POST", body: { reason: "x" } }), ctx("so1"))).status).toBe(403);
    expect(orders.createSalesOrder).not.toHaveBeenCalled();
    expect(orders.updateSalesOrder).not.toHaveBeenCalled();
    expect(orders.updateSalesOrderSchedule).not.toHaveBeenCalled();
    expect(orders.cancelSalesOrder).not.toHaveBeenCalled();
  });

  it("answers 404 while the module is switched off on the live site — the dashboard then hides its backlog", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_ACCOUNTING_ENABLED", "");
    expect((await backlog()).status).toBe(404);
    expect(orders.orderBacklog).not.toHaveBeenCalled();
  });
});

describe("/api/accounting/sales-orders", () => {
  it("lists in the range and search asked for, as of Bangkok's today, never cached", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-18T18:30:00.000Z")); // 01:30 on the 19th in Bangkok
    const res = await list(req("/api/accounting/sales-orders?from=2026-11-01&to=2026-12-01&q=PO-66"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(orders.listSalesOrders).toHaveBeenCalledWith({ from: "2026-11-01", to: "2026-12-01", q: "PO-66", today: "2026-11-19" });
  });

  it("refuses a range that is not dates", async () => {
    expect((await list(req("/api/accounting/sales-orders?from=2026-13-01"))).status).toBe(400);
    expect(orders.listSalesOrders).not.toHaveBeenCalled();
  });

  it("records a PO from a cleaned body — never a tax invoice, no serials, no PO pointers — 201", async () => {
    const res = await create(req("/api/accounting/sales-orders", { method: "POST", body: ORDER_BODY }));
    expect(res.status).toBe(201);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const [input, who] = vi.mocked(orders.createSalesOrder).mock.calls[0];
    expect(input).toMatchObject({ customerPoNo: "PO-6611", isTaxInvoice: false, salesOrderId: "", expectedDeliveryDate: "2026-11-30", storageNote: "แฟ้ม PO" });
    expect(input.lines[0]).toMatchObject({ isMachine: true, serials: "", sourceLineId: "" });
    expect(who).toEqual(actor);
  });

  it("says what the store refused, in Thai", async () => {
    const { ApiError } = await import("@/app/lib/apiHelpers");
    vi.mocked(orders.createSalesOrder).mockRejectedValueOnce(new ApiError(409, "PO เลขที่ PO-6611 ของลูกค้านี้บันทึกไว้แล้ว"));
    const res = await create(req("/api/accounting/sales-orders", { method: "POST", body: ORDER_BODY }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("PO เลขที่ PO-6611 ของลูกค้านี้บันทึกไว้แล้ว");
  });
});

describe("/api/accounting/sales-orders/backlog", () => {
  it("is as of today in Bangkok, never cached", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-18T18:30:00.000Z"));
    const res = await backlog();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(orders.orderBacklog).toHaveBeenCalledWith("2026-11-19");
    expect((await res.json()).today).toBe("2026-11-19");
  });
});

describe("/api/accounting/sales-orders/[id]", () => {
  it("brings the PO with what deleting it would do; 404 when there is no such PO", async () => {
    vi.mocked(orders.salesOrderDetail).mockResolvedValueOnce({ order: { id: "so1" } } as never);
    const res = await getOne(req("/api/accounting/sales-orders/so1"), ctx("so1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toMatchObject({ order: { id: "so1" }, impact: { status: "issued" } });
    expect(deletionImpact).toHaveBeenCalledWith("so1");

    vi.mocked(orders.salesOrderDetail).mockResolvedValueOnce(null);
    expect((await getOne(req("/api/accounting/sales-orders/zzz"), ctx("zzz"))).status).toBe(404);
  });

  it("saves over it from a cleaned body, passing on what the editor opened", async () => {
    await put(req("/api/accounting/sales-orders/so1", { method: "PUT", body: { ...ORDER_BODY, expectedUpdatedAt: "t1" } }), ctx("so1"));
    const [id, input, who, expected] = vi.mocked(orders.updateSalesOrder).mock.calls[0];
    expect([id, who, expected]).toEqual(["so1", actor, "t1"]);
    expect(input).toMatchObject({ isTaxInvoice: false, salesOrderId: "" });
  });

  it("changes the schedule and notes from text only", async () => {
    await patch(req("/api/accounting/sales-orders/so1", { method: "PATCH", body: { expectedDeliveryDate: "2026-12-15", storageNote: 5, note: "เลื่อน" } }), ctx("so1"));
    expect(orders.updateSalesOrderSchedule).toHaveBeenCalledWith("so1", { expectedDeliveryDate: "2026-12-15", storageNote: "", note: "เลื่อน" }, actor);
  });
});

describe("/api/accounting/sales-orders/[id]/cancel", () => {
  it("cancels with the reason — no password asked", async () => {
    const res = await cancel(req("/api/accounting/sales-orders/so1/cancel", { method: "POST", body: { reason: "ลูกค้ายกเลิก" } }), ctx("so1"));
    expect(res.status).toBe(200);
    expect(orders.cancelSalesOrder).toHaveBeenCalledWith("so1", "ลูกค้ายกเลิก", actor);
    expect(requirePassword).not.toHaveBeenCalled();
  });

  it("passes no reason on when the body is not JSON — the store asks for one", async () => {
    await cancel(req("/api/accounting/sales-orders/so1/cancel", { method: "POST", raw: "not json" }), ctx("so1"));
    expect(orders.cancelSalesOrder).toHaveBeenCalledWith("so1", "", actor);
  });
});

// Step 6 — deposits and the payment plan.
describe("/api/accounting/sales-orders/[id]/deposits", () => {
  it("is behind the gate", async () => {
    vi.mocked(getTwoFactorUser).mockResolvedValue({ ...user, totpEnabled: false });
    expect((await deposits(req("/api/accounting/sales-orders/so1/deposits"), ctx("so1"))).status).toBe(403);
    expect((await deposit(req("/api/accounting/sales-orders/so1/deposits", { method: "POST", body: {} }), ctx("so1"))).status).toBe(403);
    expect(depositStore.recordDeposit).not.toHaveBeenCalled();
  });

  it("answers the PO's deposits and what the dialog needs, never cached — 404 for no such PO", async () => {
    vi.mocked(depositStore.depositContext).mockResolvedValueOnce({ payments: [], outstandingSatang: 7490000 } as never);
    const res = await deposits(req("/api/accounting/sales-orders/so1/deposits"), ctx("so1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toMatchObject({ outstandingSatang: 7490000 });
    vi.mocked(depositStore.depositContext).mockResolvedValueOnce(null);
    expect((await deposits(req("/api/accounting/sales-orders/zzz/deposits"), ctx("zzz"))).status).toBe(404);
  });

  it("records a deposit from a cleaned body — 201", async () => {
    const res = await deposit(
      req("/api/accounting/sales-orders/so1/deposits", { method: "POST", body: { paidDate: "2026-11-18", method: "cash", bankAccountId: "b1", amountSatang: "3210000", note: " มัดจำ " } }),
      ctx("so1")
    );
    expect(res.status).toBe(201);
    const [id, input, who] = vi.mocked(depositStore.recordDeposit).mock.calls[0];
    expect(id).toBe("so1");
    expect(input).toMatchObject({ amountSatang: 3210000, method: "cash", bankAccountId: "", note: "มัดจำ" });
    expect(who).toEqual(actor);
  });
});

describe("/api/accounting/sales-orders/[id]/plan", () => {
  it("saves the plan from a cleaned body and answers it", async () => {
    const res = await plan(
      req("/api/accounting/sales-orders/so1/plan", { method: "PUT", body: { items: [{ label: " มัดจำ ", stage: "deposit", amountSatang: 3210000, dueDate: "2026-11-20" }] } }),
      ctx("so1")
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ plan: [] });
    expect(orders.saveSalesOrderPlan).toHaveBeenCalledWith("so1", [{ label: "มัดจำ", stage: "deposit", amountSatang: 3210000, dueDate: "2026-11-20" }], actor);
  });

  it("takes a body that is not JSON as no plan at all, and is behind the gate", async () => {
    await plan(req("/api/accounting/sales-orders/so1/plan", { method: "PUT", raw: "nope" }), ctx("so1"));
    expect(orders.saveSalesOrderPlan).toHaveBeenCalledWith("so1", [], actor);
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await plan(req("/api/accounting/sales-orders/so1/plan", { method: "PUT", body: { items: [] } }), ctx("so1"))).status).toBe(401);
  });
});
