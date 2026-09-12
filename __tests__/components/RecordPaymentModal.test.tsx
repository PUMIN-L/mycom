/**
 * "บันทึกรับชำระ" — and, more importantly, the ONLY way to take a payment back.
 *
 * `/api/billing/payments/[paymentId]/void` has exactly one caller in the whole
 * app: the ยกเลิกรายการ button inside this modal's payment history. That
 * history used to be hidden until a document carried MORE THAN ONE live
 * payment, which left the commonest mistake there is — typing 500000 for 50000
 * and confirming the overpay dialog — with no correction path at all: one
 * payment, so no disclosure, so no button, and "ชำระเกิน ฿450,000" on the
 * ledger for good. These tests hold that door open.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import RecordPaymentModal from "@/app/components/modals/RecordPaymentModal";

const DOC = {
  id: "inv-1",
  docNo: "INV050926-22",
  customerName: "บริษัท ก",
  totalAmount: 50000,
  paidAmount: 500000,
};

interface HistoryRow {
  id: string;
  amount: number;
  paidDate: string;
  method: string;
  ref: string;
  receiptDocId: string | null;
  voidedAt: string | null;
  voidReason: string | null;
}

const PAYMENT: HistoryRow = {
  id: "pay-1",
  amount: 500000,
  paidDate: "2026-09-06",
  method: "โอนเงิน",
  ref: "TRF-1",
  receiptDocId: null,
  voidedAt: null,
  voidReason: null,
};

const json = (body: unknown) =>
  Promise.resolve({ ok: true, json: async () => body } as Response);

function renderModal(history: HistoryRow[], doc = DOC) {
  const onSaved = vi.fn();
  const onError = vi.fn();
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/payments") && (!init || init.method !== "POST")) {
      return json(history);
    }
    if (/\/api\/billing\/payments\/.+\/void$/.test(url)) {
      return json({ paidAmount: 0 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  render(
    <RecordPaymentModal
      doc={doc}
      onClose={vi.fn()}
      onSaved={onSaved}
      onError={onError}
    />
  );
  return { onSaved, onError, fetchMock };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RecordPaymentModal — the payment history", () => {
  it("shows the history for a SINGLE payment, because one wrong payment is what needs correcting", async () => {
    renderModal([PAYMENT]);
    // Was hidden until `livePayments.length > 1`.
    expect(await screen.findByText("ประวัติการรับชำระ (1)")).toBeInTheDocument();
  });

  it("offers ยกเลิกรายการ on that single payment and calls the void endpoint with its id", async () => {
    const { fetchMock, onSaved } = renderModal([PAYMENT]);

    fireEvent.click(await screen.findByText("ประวัติการรับชำระ (1)"));
    const rowButton = await screen.findByRole("button", { name: "ยกเลิกรายการ" });
    fireEvent.click(rowButton);

    // The ConfirmDialog states what is about to happen, in Thai, before anything
    // is sent.
    const confirm = await screen.findAllByRole("button", { name: "ยกเลิกรายการ" });
    fireEvent.click(confirm[confirm.length - 1]);

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url) === "/api/billing/payments/pay-1/void" &&
            (init as RequestInit)?.method === "POST"
        )
      ).toBe(true)
    );
    expect(onSaved).toHaveBeenCalledWith("ยกเลิกรายการรับชำระแล้ว");
  });

  it("renders nothing at all when the document carries no payments yet", async () => {
    renderModal([]);
    await screen.findByText("💰 บันทึกรับชำระ");
    expect(screen.queryByText(/ประวัติการรับชำระ/)).not.toBeInTheDocument();
  });

  it("keeps showing a payment that was already voided — struck through, with no second ยกเลิก", async () => {
    renderModal([
      { ...PAYMENT, voidedAt: "2026-09-07T00:00:00.000Z", voidReason: "พิมพ์ยอดผิด" },
    ]);

    fireEvent.click(await screen.findByText("ประวัติการรับชำระ (0)"));
    expect(screen.getByText("ยกเลิกแล้ว 1 รายการ")).toBeInTheDocument();
    expect(screen.getByText(/พิมพ์ยอดผิด/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ยกเลิกรายการ" })).not.toBeInTheDocument();
  });

  it("still shows the ledger when a document carries several payments", async () => {
    renderModal([PAYMENT, { ...PAYMENT, id: "pay-2", amount: 20000 }]);
    expect(await screen.findByText("ประวัติการรับชำระ (2)")).toBeInTheDocument();
  });
});
