import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const pushMock = vi.fn();
const replaceMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock, prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/purchase-order",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/app/context/AuthContext", () => ({
  useAuth: () => ({ isLoggedIn: true, isLoading: false }),
}));

import PurchaseOrderPage from "@/app/purchase-order/page";

const SUPPLIERS = [
  { id: "s1", companyName: "บริษัท ก จำกัด", contactName: "คุณสมชาย", phone: "020000000", address: "ที่อยู่ ก", taxId: "0105500000000", createdAt: "2026-01-01" },
];

interface RouteOptions {
  supplierList?: unknown[];
  poById?: Record<string, unknown>;
  createResponses?: Array<{ status: number; body: unknown }>;
  cancelResponses?: Array<{ status: number; body: unknown }>;
  supersedeResponses?: Array<{ status: number; body: unknown }>;
  recentList?: unknown[];
}

function stubFetch({
  supplierList = SUPPLIERS,
  poById = {},
  createResponses = [{ status: 200, body: { id: "created" } }],
  cancelResponses = [{ status: 200, body: { success: true } }],
  supersedeResponses = [{ status: 200, body: { id: "new-po" } }],
  recentList = [],
}: RouteOptions = {}) {
  const createCalls: unknown[] = [];
  const supersedeCalls: { oldId: string; body: unknown }[] = [];
  const cancelCalls: string[] = [];

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);

    if (url.startsWith("/api/suppliers")) {
      return { ok: true, status: 200, json: async () => supplierList } as unknown as Response;
    }
    if (url.startsWith("/api/purchase-orders/docnos")) {
      return { ok: true, status: 200, json: async () => [] } as unknown as Response;
    }
    const cancelMatch = url.match(/^\/api\/purchase-orders\/([^/]+)\/cancel$/);
    if (cancelMatch && init?.method === "POST") {
      cancelCalls.push(cancelMatch[1]);
      const next = cancelResponses.shift() ?? { status: 200, body: { success: true } };
      return { ok: next.status < 300, status: next.status, json: async () => next.body } as unknown as Response;
    }
    const supersedeMatch = url.match(/^\/api\/purchase-orders\/([^/]+)\/supersede$/);
    if (supersedeMatch && init?.method === "POST") {
      supersedeCalls.push({ oldId: supersedeMatch[1], body: JSON.parse(String(init.body)) });
      const next = supersedeResponses.shift() ?? { status: 200, body: { id: "new-po" } };
      return { ok: next.status < 300, status: next.status, json: async () => next.body } as unknown as Response;
    }
    const oneMatch = url.match(/^\/api\/purchase-orders\/([^/]+)$/);
    if (oneMatch && (!init || !init.method || init.method === "GET")) {
      const rec = poById[oneMatch[1]];
      return rec
        ? ({ ok: true, status: 200, json: async () => rec } as unknown as Response)
        : ({ ok: false, status: 404, json: async () => ({ error: "ไม่พบใบสั่งซื้อ" }) } as unknown as Response);
    }
    if (url === "/api/purchase-orders" && init?.method === "POST") {
      createCalls.push(JSON.parse(String(init.body)));
      const next = createResponses.shift() ?? { status: 200, body: { id: "created" } };
      return { ok: next.status < 300, status: next.status, json: async () => next.body } as unknown as Response;
    }
    if (url === "/api/purchase-orders") {
      return { ok: true, status: 200, json: async () => recentList } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => [] } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, createCalls, supersedeCalls, cancelCalls };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("/purchase-order — a fresh visit", () => {
  it("mints a PO number and shows an empty item row ready to fill", async () => {
    stubFetch();
    render(<PurchaseOrderPage />);
    const docNoInput = await screen.findByLabelText("เลขที่ใบสั่งซื้อ");
    await waitFor(() => expect((docNoInput as HTMLInputElement).value).toMatch(/^PO\d{6}-\d{2}$/));
    expect(screen.getByText("+ เพิ่มรายการ")).toBeInTheDocument();
  });

  it("creates a purchase order on save", async () => {
    const { createCalls } = stubFetch();
    render(<PurchaseOrderPage />);
    await screen.findByLabelText("เลขที่ใบสั่งซื้อ");

    fireEvent.change(screen.getByLabelText("ชื่อบริษัทซัพพลายเออร์"), {
      target: { value: "บริษัท ทดสอบ จำกัด" },
    });
    fireEvent.change(screen.getByLabelText("ชื่อรายการ 1"), { target: { value: "น็อตหกเหลี่ยม" } });
    fireEvent.change(screen.getByLabelText("จำนวน 1"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("ราคาต่อหน่วย 1"), { target: { value: "5" } });

    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));

    await waitFor(() => expect(createCalls).toHaveLength(1));
    const saved = createCalls[0] as { data: { supplierCompany: string; items: unknown[] } };
    expect(saved.data.supplierCompany).toBe("บริษัท ทดสอบ จำกัด");
    expect(saved.data.items).toHaveLength(1);
  });

  it("filters the recent-PO list by docNo or supplier name", async () => {
    // Deliberately dated numbers far from "today" — a freshly-minted docNo
    // for today's date must never collide with these fixture values, or the
    // sheet preview's own docNo text (which also renders the string
    // verbatim) would make this ambiguous.
    stubFetch({
      recentList: [
        { id: "po1", docNo: "PO010124-05", supplier: "บริษัท ก จำกัด", total: 100, cancelledAt: null, supersededById: null },
        { id: "po2", docNo: "PO010124-06", supplier: "บริษัท ข จำกัด", total: 200, cancelledAt: null, supersededById: null },
      ],
    });
    render(<PurchaseOrderPage />);
    await screen.findByText("PO010124-05");
    expect(screen.getByText("PO010124-06")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("ค้นหาเลขที่/ผู้ขาย..."), {
      target: { value: "บริษัท ข" },
    });

    expect(screen.queryByText("PO010124-05")).not.toBeInTheDocument();
    expect(screen.getByText("PO010124-06")).toBeInTheDocument();
  });

  it("picking a supplier from the dropdown fills the address and tax id", async () => {
    stubFetch();
    render(<PurchaseOrderPage />);
    await screen.findByLabelText("เลขที่ใบสั่งซื้อ");

    fireEvent.click(screen.getByText("ค้นหาซัพพลายเออร์..."));
    fireEvent.click(await screen.findByText("บริษัท ก จำกัด"));

    await waitFor(() =>
      expect((screen.getByLabelText("ชื่อบริษัทซัพพลายเออร์") as HTMLInputElement).value).toBe(
        "บริษัท ก จำกัด"
      )
    );
    expect(screen.getByDisplayValue("0105500000000")).toBeInTheDocument();
  });
});

describe("/purchase-order?id=... — viewing an issued PO", () => {
  const REC = {
    id: "po1",
    docNo: "PO150926-22",
    data: { docDate: "2026-09-15", supplierCompany: "บริษัท ก จำกัด", items: [{ id: "i1", name: "น็อต", qty: 1, unit: "ชิ้น", unitPrice: 100 }] },
    cancelledAt: null,
    supersededById: null,
  };

  beforeEach(() => {
    window.history.pushState({}, "", "/purchase-order?id=po1");
  });

  it("loads read-only, with cancel and supersede actions available", async () => {
    stubFetch({ poById: { po1: REC } });
    render(<PurchaseOrderPage />);
    expect(await screen.findByText("PO150926-22")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ยกเลิกใบนี้/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ออกใบใหม่แทนใบนี้/ })).toBeInTheDocument();
    // View mode: no editable form fields, no "บันทึก" button.
    expect(screen.queryByLabelText("ชื่อบริษัทซัพพลายเออร์")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "บันทึก" })).not.toBeInTheDocument();
  });

  it("cancels the PO and shows the cancelled banner", async () => {
    const { cancelCalls } = stubFetch({ poById: { po1: REC } });
    render(<PurchaseOrderPage />);
    fireEvent.click(await screen.findByRole("button", { name: /ยกเลิกใบนี้/ }));
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันการยกเลิก" }));

    await waitFor(() => expect(cancelCalls).toEqual(["po1"]));
    expect(await screen.findByText(/ใบสั่งซื้อนี้ถูกยกเลิกแล้ว/)).toBeInTheDocument();
  });

  it("does not offer cancel/supersede once the PO is already cancelled", async () => {
    stubFetch({ poById: { po1: { ...REC, cancelledAt: "2026-09-16T00:00:00.000Z" } } });
    render(<PurchaseOrderPage />);
    await screen.findByText("PO150926-22");
    expect(screen.getByText(/ใบสั่งซื้อนี้ถูกยกเลิกแล้ว/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ยกเลิกใบนี้/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ออกใบใหม่แทนใบนี้/ })).not.toBeInTheDocument();
  });

  it("starting a supersede opens an editable form pre-filled from the old PO, and saves to the supersede endpoint", async () => {
    const { supersedeCalls } = stubFetch({ poById: { po1: REC } });
    render(<PurchaseOrderPage />);
    fireEvent.click(await screen.findByRole("button", { name: /ออกใบใหม่แทนใบนี้/ }));

    const supplierInput = await screen.findByLabelText("ชื่อบริษัทซัพพลายเออร์");
    expect((supplierInput as HTMLInputElement).value).toBe("บริษัท ก จำกัด");

    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));

    await waitFor(() => expect(supersedeCalls).toHaveLength(1));
    expect(supersedeCalls[0].oldId).toBe("po1");
    const body = supersedeCalls[0].body as { id: string; data: { supplierCompany: string } };
    expect(body.id).not.toBe("po1");
    expect(body.data.supplierCompany).toBe("บริษัท ก จำกัด");
  });
});
