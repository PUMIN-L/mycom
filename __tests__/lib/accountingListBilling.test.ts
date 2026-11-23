// @vitest-environment node
//
// listAccDocuments says, for each row, whether an ISSUED billing note carries
// it — the invoice list's "ออกใบวางบิลแล้ว / ยังไม่ได้ออกใบวางบิล" (the owner,
// 2026-11-23), by the same rule as the invoice's page (billingNotesOf).
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/app/lib/db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
import { query } from "@/app/lib/db";
vi.mock("@/app/lib/salesDashboardStore", () => ({ prepareSaleWithLineItems: vi.fn(), insertPreparedSaleTx: vi.fn() }));
vi.mock("@/app/lib/accounting/settings", () => ({ getVatRate: vi.fn(async () => 7), getSellerProfile: vi.fn() }));
vi.mock("@/app/lib/accounting/audit", () => ({ writeAudit: vi.fn(async () => {}) }));
import { listAccDocuments } from "@/app/lib/accounting/documents";

beforeEach(() => vi.clearAllMocks());

const ROW = { id: "d3", docType: "INV", docNo: "INV2026110003", status: "issued", source: "internal", isTaxInvoice: 1, issueDate: "2026-11-20", dueDate: "2026-12-20", buyerName: "บริษัท เจเจบี จำกัด", projectName: "", customerPoNo: "123456", totalSatang: 2140000, paidSatang: 0, creditedSatang: 0, relatedDocId: null };

describe("listAccDocuments — on a billing note", () => {
  it("asks, per row, for an issued billing note carrying it", async () => {
    vi.mocked(query).mockResolvedValueOnce([[]] as never);
    await listAccDocuments({ type: "INV" });
    const sql = String(vi.mocked(query).mock.calls[0][0]).replace(/\s+/g, " ");
    expect(sql).toContain(
      "EXISTS (SELECT 1 FROM acc_billing_items bi JOIN acc_documents bn ON bn.id = bi.billingNoteId WHERE bi.invoiceId = d.id AND bn.status = 'issued') AS onBillingNote"
    );
  });

  it("answers a boolean, whatever the driver sends", async () => {
    vi.mocked(query).mockResolvedValueOnce([[{ ...ROW, onBillingNote: 1 }, { ...ROW, id: "d4", onBillingNote: "0" }, { ...ROW, id: "d5", onBillingNote: null }]] as never);
    const rows = await listAccDocuments({ type: "INV" });
    expect(rows.map((r) => r.onBillingNote)).toEqual([true, false, false]);
  });
});
