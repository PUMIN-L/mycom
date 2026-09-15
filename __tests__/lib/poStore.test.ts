// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const conn = { query: vi.fn() };
vi.mock("@/app/lib/db", () => ({
  query: vi.fn(),
  withTransaction: vi.fn(async (fn: (c: typeof conn) => Promise<unknown>) => fn(conn)),
}));

import { query } from "@/app/lib/db";
import {
  createPurchaseOrder,
  getPurchaseOrder,
  listPurchaseOrders,
  cancelPurchaseOrder,
  supersedePurchaseOrder,
  PoDocNoConflictError,
  PurchaseOrderNotFoundError,
  PurchaseOrderFinalizedError,
} from "@/app/lib/poStore";

beforeEach(() => {
  vi.clearAllMocks();
  conn.query.mockReset();
});

const dupEntryError = () => Object.assign(new Error("ER_DUP_ENTRY"), { code: "ER_DUP_ENTRY" });

const rec = {
  id: "po1",
  docNo: "PO150926-22",
  data: { supplierCompany: "บริษัท ก", items: [{ qty: 1, unitPrice: 100 }] },
  createdAt: "2026-09-15T00:00:00.000Z",
};

describe("createPurchaseOrder", () => {
  // Same construction as saveQuotationAtomic (quotationStore.ts) — see that
  // file's own tests for the reasoning this mirrors verbatim.
  it("reserves a FREE docNo via an atomic ledger INSERT, then inserts the PO", async () => {
    conn.query
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // INSERT used_docnos
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // INSERT purchase_orders

    await createPurchaseOrder(rec);

    expect(conn.query).toHaveBeenCalledTimes(2);
    expect(conn.query.mock.calls[0][0]).toContain("INSERT INTO used_docnos");
    expect(conn.query.mock.calls[0][1]).toEqual([rec.docNo, rec.id, rec.createdAt]);
    expect(conn.query.mock.calls[1][0]).toContain("INSERT INTO purchase_orders");
  });

  it("throws PoDocNoConflictError and writes NOTHING when a DIFFERENT PO owns the docNo", async () => {
    conn.query
      .mockResolvedValueOnce(Promise.reject(dupEntryError()))
      .mockResolvedValueOnce([[{ quotationId: "other-po" }]]);

    await expect(createPurchaseOrder(rec)).rejects.toBeInstanceOf(PoDocNoConflictError);
    expect(
      conn.query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO purchase_orders"))
    ).toBe(false);
  });

  it("skips the ledger entirely when the PO has no docNo", async () => {
    conn.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
    await createPurchaseOrder({ ...rec, docNo: "" });
    expect(conn.query).toHaveBeenCalledTimes(1);
    expect(conn.query.mock.calls[0][0]).toContain("INSERT INTO purchase_orders");
  });
});

describe("getPurchaseOrder / listPurchaseOrders", () => {
  it("returns null when the PO doesn't exist", async () => {
    vi.mocked(query).mockResolvedValueOnce([[]] as any);
    expect(await getPurchaseOrder("missing")).toBeNull();
  });

  it("parses the stored JSON blob back into an object", async () => {
    vi.mocked(query).mockResolvedValueOnce([
      [{ id: "po1", docNo: "PO150926-22", data: JSON.stringify({ a: 1 }), supersededById: null, cancelledAt: null, createdAt: "2026-09-15T00:00:00.000Z" }],
    ] as any);
    const rec = await getPurchaseOrder("po1");
    expect(rec?.data).toEqual({ a: 1 });
    expect(rec?.cancelledAt).toBeNull();
  });

  it("summarizes the grand total and supplier name the same way the builder computes them", async () => {
    vi.mocked(query).mockResolvedValueOnce([
      [
        {
          id: "po1",
          docNo: "PO150926-22",
          data: JSON.stringify({
            supplierCompany: "บริษัท ก",
            items: [{ qty: 2, unitPrice: 100 }],
            vatEnabled: true,
          }),
          createdAt: "2026-09-15T00:00:00.000Z",
          cancelledAt: null,
          supersededById: null,
        },
      ],
    ] as any);
    const [summary] = await listPurchaseOrders();
    expect(summary.supplier).toBe("บริษัท ก");
    expect(summary.total).toBeCloseTo(200 * 1.07);
  });
});

describe("cancelPurchaseOrder", () => {
  it("marks the row cancelled", async () => {
    conn.query
      .mockResolvedValueOnce([[{ cancelledAt: null, supersededById: null }]]) // lock+check
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE
    await cancelPurchaseOrder("po1", "2026-09-15T00:00:00.000Z");
    expect(conn.query.mock.calls[1][0]).toContain("UPDATE purchase_orders SET cancelledAt");
  });

  it("throws PurchaseOrderNotFoundError for a missing PO", async () => {
    conn.query.mockResolvedValueOnce([[]]);
    await expect(cancelPurchaseOrder("missing", "now")).rejects.toBeInstanceOf(
      PurchaseOrderNotFoundError
    );
  });

  it("refuses a repeat cancel on an already-cancelled PO", async () => {
    conn.query.mockResolvedValueOnce([[{ cancelledAt: "2026-09-01T00:00:00.000Z", supersededById: null }]]);
    const err = await cancelPurchaseOrder("po1", "now").catch((e) => e);
    expect(err).toBeInstanceOf(PurchaseOrderFinalizedError);
    expect(err.reason).toBe("cancelled");
  });

  it("refuses to cancel a PO that has already been superseded", async () => {
    conn.query.mockResolvedValueOnce([[{ cancelledAt: null, supersededById: "po2" }]]);
    const err = await cancelPurchaseOrder("po1", "now").catch((e) => e);
    expect(err).toBeInstanceOf(PurchaseOrderFinalizedError);
    expect(err.reason).toBe("superseded");
  });
});

const newRec = {
  id: "po2",
  docNo: "PO150926-23",
  data: { supplierCompany: "บริษัท ก แก้ไข", items: [] },
  createdAt: "2026-09-15T01:00:00.000Z",
};

describe("supersedePurchaseOrder", () => {
  it("inserts the new PO and stamps the old row's supersededById, in one transaction", async () => {
    conn.query
      .mockResolvedValueOnce([[{ cancelledAt: null, supersededById: null }]]) // lock old row
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // INSERT used_docnos (new docNo)
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // INSERT purchase_orders (new row)
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE old row's supersededById

    await supersedePurchaseOrder("po1", newRec);

    expect(conn.query.mock.calls[2][0]).toContain("INSERT INTO purchase_orders");
    const finalCall = conn.query.mock.calls[3];
    expect(finalCall[0]).toContain("UPDATE purchase_orders SET supersededById");
    expect(finalCall[1]).toEqual(["po2", "po1"]);
  });

  it("throws PurchaseOrderNotFoundError when the old PO doesn't exist", async () => {
    conn.query.mockResolvedValueOnce([[]]);
    await expect(supersedePurchaseOrder("missing", newRec)).rejects.toBeInstanceOf(
      PurchaseOrderNotFoundError
    );
  });

  it("refuses to supersede a PO that is already cancelled", async () => {
    conn.query.mockResolvedValueOnce([[{ cancelledAt: "2026-09-01T00:00:00.000Z", supersededById: null }]]);
    const err = await supersedePurchaseOrder("po1", newRec).catch((e) => e);
    expect(err).toBeInstanceOf(PurchaseOrderFinalizedError);
    expect(err.reason).toBe("cancelled");
  });

  it("refuses to supersede a PO that has already been superseded once", async () => {
    conn.query.mockResolvedValueOnce([[{ cancelledAt: null, supersededById: "po-existing" }]]);
    const err = await supersedePurchaseOrder("po1", newRec).catch((e) => e);
    expect(err).toBeInstanceOf(PurchaseOrderFinalizedError);
    expect(err.reason).toBe("superseded");
  });

  it("throws PoDocNoConflictError and never stamps the old row when the new docNo is taken", async () => {
    conn.query
      .mockResolvedValueOnce([[{ cancelledAt: null, supersededById: null }]]) // lock old row
      .mockResolvedValueOnce(Promise.reject(dupEntryError())) // ledger insert fails
      .mockResolvedValueOnce([[{ quotationId: "someone-else" }]]); // owned by someone else

    await expect(supersedePurchaseOrder("po1", newRec)).rejects.toBeInstanceOf(PoDocNoConflictError);
    expect(
      conn.query.mock.calls.some(([sql]) => String(sql).includes("UPDATE purchase_orders SET supersededById"))
    ).toBe(false);
  });
});
