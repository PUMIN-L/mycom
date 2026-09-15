// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET as listGET, POST as createPOST } from "@/app/api/purchase-orders/route";
import { GET as oneGET } from "@/app/api/purchase-orders/[id]/route";
import { POST as cancelPOST } from "@/app/api/purchase-orders/[id]/cancel/route";
import { POST as supersedePOST } from "@/app/api/purchase-orders/[id]/supersede/route";
import { GET as docnosGET } from "@/app/api/purchase-orders/docnos/route";

// poStore fully mocked — error classes re-declared as real classes so the
// routes' `instanceof` checks work against the same reference (same
// convention __tests__/api/quotations.test.ts uses for DocNoConflictError).
vi.mock("@/app/lib/poStore", () => ({
  listPurchaseOrders: vi.fn(),
  createPurchaseOrder: vi.fn(),
  getPurchaseOrder: vi.fn(),
  cancelPurchaseOrder: vi.fn(),
  supersedePurchaseOrder: vi.fn(),
  PoDocNoConflictError: class PoDocNoConflictError extends Error {
    constructor(public docNo: string) {
      super(`docNo ${docNo} conflict`);
      this.name = "PoDocNoConflictError";
    }
  },
  PurchaseOrderNotFoundError: class PurchaseOrderNotFoundError extends Error {
    constructor(public id: string) {
      super(`not found ${id}`);
      this.name = "PurchaseOrderNotFoundError";
    }
  },
  PurchaseOrderFinalizedError: class PurchaseOrderFinalizedError extends Error {
    constructor(public id: string, public reason: "cancelled" | "superseded") {
      super(`finalized ${id}`);
      this.name = "PurchaseOrderFinalizedError";
    }
  },
}));
import {
  listPurchaseOrders,
  createPurchaseOrder,
  getPurchaseOrder,
  cancelPurchaseOrder,
  supersedePurchaseOrder,
  PoDocNoConflictError,
  PurchaseOrderNotFoundError,
  PurchaseOrderFinalizedError,
} from "@/app/lib/poStore";

// The docnos route reuses quotationStore's ledger functions directly — mock
// that module too, same as __tests__/api/quotations.test.ts does.
vi.mock("@/app/lib/quotationStore", () => ({
  listRecentDocNos: vi.fn(),
  listDocNosByBase: vi.fn(),
}));
import { listRecentDocNos, listDocNosByBase } from "@/app/lib/quotationStore";

vi.mock("@/app/lib/session", () => ({ getSession: vi.fn() }));
import { getSession } from "@/app/lib/session";

const adminSession = { userId: "1", username: "admin", expiresAt: new Date() } as any;

const postReq = (url: string, body: any) =>
  new NextRequest(url, {
    method: "POST",
    headers: { origin: "http://localhost", host: "localhost", "content-type": "application/json" },
    body: JSON.stringify(body),
  });

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(null);
});

describe("GET /api/purchase-orders (list)", () => {
  it("rejects anonymous callers with 401", async () => {
    const res = await listGET();
    expect(res.status).toBe(401);
    expect(listPurchaseOrders).not.toHaveBeenCalled();
  });

  it("returns the summary list to a logged-in admin", async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    const rows = [{ id: "po1", docNo: "PO150926-22", createdAt: "2026-09-15", supplier: "บริษัท ก", total: 100, cancelledAt: null, supersededById: null }];
    vi.mocked(listPurchaseOrders).mockResolvedValue(rows as any);
    const res = await listGET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(rows);
  });
});

describe("POST /api/purchase-orders (create)", () => {
  it("rejects anonymous callers with 401, without creating", async () => {
    const res = await createPOST(postReq("http://localhost/api/purchase-orders", { id: "po1" }));
    expect(res.status).toBe(401);
    expect(createPurchaseOrder).not.toHaveBeenCalled();
  });

  it("returns 400 when id is missing", async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    const res = await createPOST(postReq("http://localhost/api/purchase-orders", { docNo: "PO150926-22" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("id is required");
    expect(createPurchaseOrder).not.toHaveBeenCalled();
  });

  it("returns 400 and never creates when the line items compute a negative grand total", async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    const res = await createPOST(
      postReq("http://localhost/api/purchase-orders", {
        id: "po1",
        docNo: "PO150926-22",
        data: { items: [{ qty: -5, unitPrice: 1000 }] },
      })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("ยอดรวมสุทธิต้องไม่ติดลบ กรุณาตรวจสอบรายการสินค้า");
    expect(createPurchaseOrder).not.toHaveBeenCalled();
  });

  it("returns 409 when the docNo is already reserved", async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    vi.mocked(createPurchaseOrder).mockRejectedValue(new (PoDocNoConflictError as any)("PO150926-22"));
    const res = await createPOST(
      postReq("http://localhost/api/purchase-orders", { id: "po1", docNo: "PO150926-22" })
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("เลขที่ใบสั่งซื้อนี้ถูกใช้ไปแล้ว กรุณาเปลี่ยนเลขที่");
  });

  it("creates on success", async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    vi.mocked(createPurchaseOrder).mockResolvedValue(undefined);
    const res = await createPOST(
      postReq("http://localhost/api/purchase-orders", {
        id: "po1",
        docNo: "PO150926-22",
        data: { supplierCompany: "บริษัท ก" },
      })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "po1" });
    const saved = vi.mocked(createPurchaseOrder).mock.calls[0][0];
    expect(saved.id).toBe("po1");
    expect(saved.docNo).toBe("PO150926-22");
    expect(typeof saved.createdAt).toBe("string");
  });
});

describe("GET /api/purchase-orders/[id]", () => {
  it("rejects anonymous callers with 401", async () => {
    const res = await oneGET(new NextRequest("http://localhost/api/purchase-orders/po1"), ctx("po1"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when not found", async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    vi.mocked(getPurchaseOrder).mockResolvedValue(null);
    const res = await oneGET(new NextRequest("http://localhost/api/purchase-orders/missing"), ctx("missing"));
    expect(res.status).toBe(404);
  });

  it("returns the PO to a logged-in admin", async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    const rec = { id: "po1", docNo: "PO150926-22", data: {}, supersededById: null, cancelledAt: null, createdAt: "2026-09-15" };
    vi.mocked(getPurchaseOrder).mockResolvedValue(rec as any);
    const res = await oneGET(new NextRequest("http://localhost/api/purchase-orders/po1"), ctx("po1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(rec);
  });
});

describe("POST /api/purchase-orders/[id]/cancel", () => {
  it("rejects anonymous callers with 401", async () => {
    const res = await cancelPOST(postReq("http://localhost/api/purchase-orders/po1/cancel", {}), ctx("po1"));
    expect(res.status).toBe(401);
    expect(cancelPurchaseOrder).not.toHaveBeenCalled();
  });

  it("returns 404 for a missing PO", async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    vi.mocked(cancelPurchaseOrder).mockRejectedValue(new (PurchaseOrderNotFoundError as any)("missing"));
    const res = await cancelPOST(postReq("http://localhost/api/purchase-orders/missing/cancel", {}), ctx("missing"));
    expect(res.status).toBe(404);
  });

  it("returns 409 with a Thai message when the PO is already cancelled", async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    vi.mocked(cancelPurchaseOrder).mockRejectedValue(new (PurchaseOrderFinalizedError as any)("po1", "cancelled"));
    const res = await cancelPOST(postReq("http://localhost/api/purchase-orders/po1/cancel", {}), ctx("po1"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("ใบสั่งซื้อนี้ถูกยกเลิกไปแล้ว");
  });

  it("returns 409 with a Thai message when the PO has already been superseded", async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    vi.mocked(cancelPurchaseOrder).mockRejectedValue(new (PurchaseOrderFinalizedError as any)("po1", "superseded"));
    const res = await cancelPOST(postReq("http://localhost/api/purchase-orders/po1/cancel", {}), ctx("po1"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("ใบสั่งซื้อนี้ถูกออกใบใหม่แทนไปแล้ว ไม่สามารถยกเลิกได้");
  });

  it("cancels on success", async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    vi.mocked(cancelPurchaseOrder).mockResolvedValue(undefined);
    const res = await cancelPOST(postReq("http://localhost/api/purchase-orders/po1/cancel", {}), ctx("po1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(cancelPurchaseOrder).toHaveBeenCalledWith("po1", expect.any(String));
  });
});

describe("POST /api/purchase-orders/[id]/supersede", () => {
  it("rejects anonymous callers with 401", async () => {
    const res = await supersedePOST(
      postReq("http://localhost/api/purchase-orders/po1/supersede", { id: "po2" }),
      ctx("po1")
    );
    expect(res.status).toBe(401);
    expect(supersedePurchaseOrder).not.toHaveBeenCalled();
  });

  it("returns 400 when the new id is missing", async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    const res = await supersedePOST(
      postReq("http://localhost/api/purchase-orders/po1/supersede", { docNo: "PO150926-23" }),
      ctx("po1")
    );
    expect(res.status).toBe(400);
    expect(supersedePurchaseOrder).not.toHaveBeenCalled();
  });

  it("returns 400 and never supersedes on a negative grand total", async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    const res = await supersedePOST(
      postReq("http://localhost/api/purchase-orders/po1/supersede", {
        id: "po2",
        data: { items: [{ qty: -1, unitPrice: 100 }] },
      }),
      ctx("po1")
    );
    expect(res.status).toBe(400);
    expect(supersedePurchaseOrder).not.toHaveBeenCalled();
  });

  it("returns 404 when the old PO doesn't exist", async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    vi.mocked(supersedePurchaseOrder).mockRejectedValue(new (PurchaseOrderNotFoundError as any)("po1"));
    const res = await supersedePOST(
      postReq("http://localhost/api/purchase-orders/po1/supersede", { id: "po2", docNo: "PO150926-23" }),
      ctx("po1")
    );
    expect(res.status).toBe(404);
  });

  it("returns 409 when the old PO is already cancelled", async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    vi.mocked(supersedePurchaseOrder).mockRejectedValue(new (PurchaseOrderFinalizedError as any)("po1", "cancelled"));
    const res = await supersedePOST(
      postReq("http://localhost/api/purchase-orders/po1/supersede", { id: "po2", docNo: "PO150926-23" }),
      ctx("po1")
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("ใบสั่งซื้อเดิมถูกยกเลิกไปแล้ว ไม่สามารถออกใบใหม่แทนได้");
  });

  it("returns 409 when the new docNo conflicts", async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    vi.mocked(supersedePurchaseOrder).mockRejectedValue(new (PoDocNoConflictError as any)("PO150926-23"));
    const res = await supersedePOST(
      postReq("http://localhost/api/purchase-orders/po1/supersede", { id: "po2", docNo: "PO150926-23" }),
      ctx("po1")
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("เลขที่ใบสั่งซื้อนี้ถูกใช้ไปแล้ว กรุณาเปลี่ยนเลขที่");
  });

  it("supersedes on success", async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    vi.mocked(supersedePurchaseOrder).mockResolvedValue(undefined);
    const res = await supersedePOST(
      postReq("http://localhost/api/purchase-orders/po1/supersede", {
        id: "po2",
        docNo: "PO150926-23",
        data: { supplierCompany: "บริษัท ก" },
      }),
      ctx("po1")
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "po2" });
    expect(supersedePurchaseOrder).toHaveBeenCalledWith(
      "po1",
      expect.objectContaining({ id: "po2", docNo: "PO150926-23" })
    );
  });
});

describe("GET /api/purchase-orders/docnos", () => {
  it("rejects anonymous callers with 401", async () => {
    const res = await docnosGET();
    expect(res.status).toBe(401);
    expect(listRecentDocNos).not.toHaveBeenCalled();
  });

  it("returns the recent ledger with no ?base=", async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    vi.mocked(listRecentDocNos).mockResolvedValue([{ docNo: "PO150926-22", quotationId: "po1" }] as any);
    const res = await docnosGET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ docNo: "PO150926-22", quotationId: "po1" }]);
  });

  it("mints from the non-windowed ledger when ?base= is given", async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    vi.mocked(listDocNosByBase).mockResolvedValue([{ docNo: "PO150926-22", quotationId: "po1" }] as any);
    const res = await docnosGET(
      new NextRequest("http://localhost/api/purchase-orders/docnos?base=PO150926-")
    );
    expect(res.status).toBe(200);
    expect(listDocNosByBase).toHaveBeenCalledWith("PO150926-");
    expect(listRecentDocNos).not.toHaveBeenCalled();
  });
});
