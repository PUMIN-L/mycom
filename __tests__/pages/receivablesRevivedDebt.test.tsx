/**
 * หนี้ที่กลับเข้ามาในยอดค้าง ต้องอธิบายตัวเองได้บนหน้าจอ
 *
 * `buildReceivablesLedger` already revives an invoice whose "แก้ไข (New Ver.)"
 * was later cancelled — correctly: ฿80,000 of real debt used to vanish from
 * the ledger, every ageing bucket and the headline at once. But the flag that
 * says WHY it came back (`status.revivedFromCancelledSuccessor`,
 * `revivedSupersededDocs`, `REVIVED_SUPERSEDE_LABEL`) was computed, shipped
 * over the wire and rendered by nobody, so the debt re-entered ยอดค้างทั้งหมด
 * in total silence and the admin who thought he had cancelled it had no way to
 * find out why his total grew.
 *
 * These tests drive the REAL ledger builder into the REAL page and assert what
 * the admin can actually read. They fail against a page that only receives the
 * flag — asserting the flag on the API object is the exact mistake being fixed
 * here, so nothing below asserts on the payload.
 */
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/app/context/AuthContext", () => ({
  useAuth: () => ({ isLoggedIn: true, isLoading: false }),
}));

import ReceivablesPage from "@/app/billing/receivables/page";
import {
  buildReceivablesLedger,
  REVIVED_SUPERSEDE_LABEL,
  type ReceivableRow,
} from "@/app/lib/receivables";

const TODAY = "2026-09-12";

function row(over: Partial<ReceivableRow> & { id: string }): ReceivableRow {
  return {
    docNo: "",
    docType: "invoice",
    docDate: "2026-05-01",
    dueDate: null,
    customerName: "บริษัท ทดสอบ จำกัด",
    customerPhone: "081-000-0000",
    linkedQuotationId: null,
    totalAmount: 80000,
    paidAmount: 0,
    receivableOverride: null,
    cancelledAt: null,
    supersededById: null,
    settlesDocId: null,
    createdAt: "2026-05-01T00:00:00.000Z",
    ...over,
  } as ReceivableRow;
}

/**
 * Four rows, two stories:
 *   • v1 was replaced by v2, and v2 was then CANCELLED → the debt is back.
 *   • o1 was replaced by o2, and o2 is alive → o1 stays terminal and absent.
 */
const ROWS: ReceivableRow[] = [
  row({
    id: "v1",
    docNo: "INV050926-22",
    dueDate: "2026-06-01", // 103 วัน → เกิน 90 วัน
    customerName: "บริษัท ฟื้นคืน จำกัด",
    supersededById: "v2",
  }),
  row({
    id: "v2",
    docNo: "INV050926-22v1",
    dueDate: "2026-06-01",
    customerName: "บริษัท ฟื้นคืน จำกัด",
    cancelledAt: "2026-09-01T00:00:00.000Z",
  }),
  row({
    id: "o1",
    docNo: "INV010926-07",
    dueDate: "2026-09-30",
    customerName: "บริษัท ปกติ จำกัด",
    totalAmount: 12000,
    supersededById: "o2",
  }),
  row({
    id: "o2",
    docNo: "INV010926-07v1",
    dueDate: "2026-09-30", // ยังไม่ถึงกำหนด
    customerName: "บริษัท ปกติ จำกัด",
    totalAmount: 12000,
  }),
];

function payload(rows: ReceivableRow[] = ROWS) {
  return {
    today: TODAY,
    creditTermDays: 30,
    ...buildReceivablesLedger(rows, TODAY),
    undatedTargets: [],
  };
}

/** GET returns the ledger; every other call is recorded and answered ok. */
function stubFetch(rows: ReceivableRow[] = ROWS) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      const body =
        url === "/api/billing/receivables" ? payload(rows) : { ok: true, updated: 1 };
      return { ok: true, status: 200, json: async () => body } as unknown as Response;
    })
  );
  return calls;
}

/** The nudge panel, found by its heading and scoped to its card. */
function revivedPanel() {
  return screen.getByRole("heading", { name: /กลับมาเป็นลูกหนี้: เวอร์ชันใหม่ถูกยกเลิก/ })
    .parentElement as HTMLElement;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("หน้าลูกหนี้ค้างชำระ — ใบที่กลับมาเป็นหนี้เพราะเวอร์ชันใหม่ถูกยกเลิก", () => {
  it("แสดงใบนั้นในยอดค้าง และติดป้ายบอกเหตุผลไว้บนแถว", async () => {
    stubFetch();
    render(<ReceivablesPage />);

    // The debt IS counted — ฿80,000 back in the headline, with the ฿12,000 of
    // the ordinary live invoice: ฿92,000.
    await screen.findByText("฿92,000.00");

    // ...and the row says why it is here, rather than appearing as an ordinary
    // open invoice.
    const badges = screen.getAllByText(REVIVED_SUPERSEDE_LABEL, { exact: false });
    expect(badges.length).toBeGreaterThan(0);
    expect(
      screen.getByText(/เคยถูกแทนที่ด้วย\s*INV050926-22v1\s*แต่เวอร์ชันนั้นถูกยกเลิก/)
    ).toBeInTheDocument();
  });

  it("ใบที่ถูกแทนที่ตามปกติ (เวอร์ชันใหม่ยังอยู่) ยังไม่ใช่หนี้ และไม่มีป้ายใด ๆ", async () => {
    stubFetch();
    render(<ReceivablesPage />);
    await screen.findByText("฿92,000.00");

    // The live successor is on screen; the version it replaced is not, and is
    // not marked as revived either.
    expect(screen.getAllByText("INV010926-07v1").length).toBeGreaterThan(0);
    expect(screen.queryByText("INV010926-07")).toBeNull();
    // Exactly ONE document is marked — the revived one.
    expect(screen.getAllByText(REVIVED_SUPERSEDE_LABEL, { exact: false })).toHaveLength(1);
  });

  it("บอกไว้ในรายการสรุปด้วย ซึ่งไม่หายไปตามตัวกรองช่วงอายุหนี้", async () => {
    stubFetch();
    render(<ReceivablesPage />);
    await screen.findByText("฿92,000.00");

    const panel = revivedPanel();
    expect(within(panel).getByText("INV050926-22")).toBeInTheDocument();
    expect(within(panel).getByText(/เวอร์ชันที่ถูกยกเลิก:\s*INV050926-22v1/)).toBeInTheDocument();

    // Filter to a bucket the revived row is NOT in: its badge leaves the
    // screen, but the money is still in ยอดค้างทั้งหมด — so the explanation
    // must still be reachable. A badge alone would fail here.
    fireEvent.click(screen.getByRole("button", { name: /ยังไม่ถึงกำหนด/ }));
    await waitFor(() =>
      expect(screen.queryByText(REVIVED_SUPERSEDE_LABEL, { exact: false })).toBeNull()
    );
    expect(
      screen.getByRole("heading", { name: /กลับมาเป็นลูกหนี้: เวอร์ชันใหม่ถูกยกเลิก \(1\)/ })
    ).toBeInTheDocument();
  });

  it("กด “ไม่นับเป็นลูกหนี้” แล้วยืนยัน จึงตัดออกจากยอดค้าง — ไม่ใช่กดครั้งเดียวหาย", async () => {
    const calls = stubFetch();
    render(<ReceivablesPage />);
    await screen.findByText("฿92,000.00");

    fireEvent.click(within(revivedPanel()).getByRole("button", { name: "ไม่นับเป็นลูกหนี้" }));

    // One click only asks. The dialog states the money that will leave.
    expect(await screen.findByText(/฿80,000.00 จะหายออกจากยอดค้างทั้งหมด/)).toBeInTheDocument();
    expect(calls.filter((c) => c.init?.method === "PATCH")).toHaveLength(0);

    const dialogConfirm = screen
      .getAllByRole("button", { name: "ไม่นับเป็นลูกหนี้" })
      .at(-1) as HTMLElement;
    fireEvent.click(dialogConfirm);

    await waitFor(() => {
      const patch = calls.find((c) => c.init?.method === "PATCH");
      expect(patch?.url).toBe("/api/billing/v1/receivable");
      expect(JSON.parse(String(patch?.init?.body))).toEqual({ receivableOverride: 0 });
    });
  });
});
