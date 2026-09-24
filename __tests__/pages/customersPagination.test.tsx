/**
 * /customers is paged, 50 rows at a time. ~2,000 customers in one table was
 * tens of thousands of DOM nodes, all re-rendered on every keystroke in the
 * edit form. Only the RENDERED rows are paged: the order is still global, and
 * the count, Excel export and deep links still see every customer.
 */
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Customers from "@/app/customers/page";
import { downloadExcel } from "@/app/lib/xlsxExport";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/customers",
  useSearchParams: () => new URLSearchParams(),
  notFound: vi.fn(),
  redirect: vi.fn(),
}));
vi.mock("@/app/context/AuthContext", () => ({
  useAuth: () => ({ isLoggedIn: true, isLoading: false }),
}));
vi.mock("@/app/customers/EquipmentTab", () => ({ default: () => <div /> }));
vi.mock("@/app/components/modals/CustomerCallScheduleSection", () => ({ default: () => <div /> }));
vi.mock("@/app/lib/xlsxExport", () => ({ downloadExcel: vi.fn(async () => {}) }));

const pad = (n: number) => String(n).padStart(3, "0");

/** n customers with notes, "ลูกค้า 001" updated most recently, then 002, ... */
function customers(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `c${pad(i + 1)}`,
    companyId: "co1",
    companyName: i % 2 ? "บริษัท ข" : "บริษัท ก",
    name: `ลูกค้า ${pad(i + 1)}`,
    department: "",
    phone: "",
    email: "",
    note: `บันทึก ${i + 1}`,
    createdAt: "2025-01-01T00:00:00.000Z",
    noteUpdatedAt: new Date(Date.UTC(2026, 8, 1) - i * 3600_000).toISOString(),
  }));
}

function mockFetch(list: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) =>
      String(input) === "/api/customers"
        ? { ok: true, status: 200, json: async () => list }
        : { ok: true, status: 200, json: async () => [] }
    )
  );
}

/** Customer names in the customers table, top to bottom. */
function shownNames(): string[] {
  const table = screen.getByText("อัปเดตล่าสุด").closest("table")!;
  return within(table)
    .getAllByRole("row")
    .slice(1)
    .map((r) => r.querySelector("p.font-semibold")?.textContent ?? "");
}

const pager = () => screen.getByTestId("customer-pagination");

beforeEach(() => {
  window.history.replaceState({}, "", "/customers");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("/customers — pagination", () => {
  it("renders 50 rows and says which of how many", async () => {
    // Fed in reverse so the page has to sort before it slices.
    mockFetch(customers(120).reverse());
    render(<Customers />);
    await screen.findByText("ลูกค้า 001");

    const names = shownNames();
    expect(names).toHaveLength(50);
    expect(names[0]).toBe("ลูกค้า 001");
    expect(names[49]).toBe("ลูกค้า 050");
    expect(within(pager()).getByText("หน้า 1 / 3")).toBeInTheDocument();
    expect(pager().textContent).toContain("แสดง 1 ถึง 50 จาก 120 รายการ");
    // The heading still counts everyone, not the page.
    expect(screen.getByText("(120)")).toBeInTheDocument();
  });

  it("pages through the GLOBAL order, and stops at both ends", async () => {
    mockFetch(customers(120));
    render(<Customers />);
    await screen.findByText("ลูกค้า 001");

    const prev = () => within(pager()).getByRole("button", { name: "ก่อนหน้า" });
    const next = () => within(pager()).getByRole("button", { name: "ถัดไป" });
    expect(prev()).toBeDisabled();

    fireEvent.click(next());
    expect(shownNames()[0]).toBe("ลูกค้า 051");
    fireEvent.click(next());
    expect(shownNames()).toHaveLength(20);
    expect(shownNames()[19]).toBe("ลูกค้า 120");
    expect(pager().textContent).toContain("แสดง 101 ถึง 120 จาก 120 รายการ");
    expect(next()).toBeDisabled();

    fireEvent.click(prev());
    expect(shownNames()[0]).toBe("ลูกค้า 051");
  });

  it("goes back to page 1 when the search changes", async () => {
    mockFetch(customers(120));
    render(<Customers />);
    await screen.findByText("ลูกค้า 001");
    fireEvent.click(within(pager()).getByRole("button", { name: "ถัดไป" }));
    fireEvent.click(within(pager()).getByRole("button", { name: "ถัดไป" }));

    fireEvent.change(screen.getByPlaceholderText("ค้นหาชื่อลูกค้า หรือ ชื่อบริษัท..."), {
      target: { value: "บริษัท ก" },
    });

    // 60 of the 120 are บริษัท ก — two pages, and we are on the first.
    expect(shownNames()[0]).toBe("ลูกค้า 001");
    expect(within(pager()).getByText("หน้า 1 / 2")).toBeInTheDocument();
  });

  it("never strands the view on a page that no longer exists", async () => {
    mockFetch(customers(120));
    render(<Customers />);
    await screen.findByText("ลูกค้า 001");
    fireEvent.click(within(pager()).getByRole("button", { name: "ถัดไป" }));
    fireEvent.click(within(pager()).getByRole("button", { name: "ถัดไป" }));

    // A search that leaves one page: the stored page (3) is clamped, not shown
    // as an empty table.
    fireEvent.change(screen.getByPlaceholderText("ค้นหาชื่อลูกค้า หรือ ชื่อบริษัท..."), {
      target: { value: "ลูกค้า 00" },
    });
    expect(shownNames()).toHaveLength(9);
    expect(screen.queryByTestId("customer-pagination")).not.toBeInTheDocument();
  });

  it("shows no pager when everyone fits on one page", async () => {
    mockFetch(customers(50));
    render(<Customers />);
    await screen.findByText("ลูกค้า 001");
    expect(shownNames()).toHaveLength(50);
    expect(screen.queryByTestId("customer-pagination")).not.toBeInTheDocument();
  });

  it("still exports every customer, not just the page on screen", async () => {
    mockFetch(customers(120));
    render(<Customers />);
    await screen.findByText("ลูกค้า 001");

    fireEvent.click(screen.getByRole("button", { name: /Export/ }));
    await waitFor(() => expect(downloadExcel).toHaveBeenCalled());
    const sheets = vi.mocked(downloadExcel).mock.calls[0][1] as { rows: unknown[] }[];
    expect(sheets[0].rows).toHaveLength(120);
  });
});
