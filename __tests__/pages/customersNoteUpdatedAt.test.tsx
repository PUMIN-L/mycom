/**
 * /customers — "อัปเดตล่าสุด" column and order (add-customer-note-updated-at).
 *
 * GET /api/customers still answers in createdAt order (other pages' dropdowns
 * read it), so every ordering assertion here feeds the rows in THAT order and
 * checks the page re-sorts them itself.
 */
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Customers from "@/app/customers/page";

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
vi.mock("@/app/lib/xlsxExport", () => ({ downloadExcel: vi.fn() }));

const base = { companyId: "co1", companyName: "บริษัท ก", department: "", phone: "", email: "" };

// createdAt DESC — the order the API really returns.
const NEWEST_NO_NOTE = {
  ...base,
  id: "c-empty",
  name: "ไม่มีบันทึก",
  note: "",
  createdAt: "2026-09-20T00:00:00.000Z",
  noteUpdatedAt: null,
};
const CALLED_LAST_WEEK = {
  ...base,
  id: "c-week",
  name: "โทรสัปดาห์ก่อน",
  note: "16/9/26 โทรติดตาม",
  createdAt: "2026-08-01T00:00:00.000Z",
  noteUpdatedAt: "2026-09-16T03:00:00.000Z",
};
const CALLED_TODAY = {
  ...base,
  id: "c-today",
  name: "โทรวันนี้",
  note: "24/9/26 โทรคุยเรื่องเวอร์เนีย",
  createdAt: "2025-01-01T00:00:00.000Z",
  noteUpdatedAt: "2026-09-24T07:30:00.000Z", // 14:30 Bangkok
};

function mockFetch(putResponse?: { noteUpdatedAt: string | null }) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/customers") {
      return { ok: true, status: 200, json: async () => [NEWEST_NO_NOTE, CALLED_LAST_WEEK, CALLED_TODAY] };
    }
    if (url.startsWith("/api/customers/") && init?.method === "PUT") {
      return { ok: true, status: 200, json: async () => ({ success: true, ...putResponse }) };
    }
    return { ok: true, status: 200, json: async () => [] };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Customer names in the order the customers table shows them. */
function customerOrder(): string[] {
  const table = screen.getByText("อัปเดตล่าสุด").closest("table")!;
  return within(table)
    .getAllByRole("row")
    .slice(1)
    .map((r) => r.querySelector("p.font-semibold")?.textContent ?? "");
}

beforeEach(() => {
  window.history.replaceState({}, "", "/customers");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("/customers — อัปเดตล่าสุด", () => {
  it("lists the most recently updated note first and an empty note last", async () => {
    mockFetch();
    render(<Customers />);
    await screen.findByText("โทรวันนี้");

    expect(customerOrder()).toEqual(["โทรวันนี้", "โทรสัปดาห์ก่อน", "ไม่มีบันทึก"]);
  });

  it("shows when the note was last updated, in Bangkok time, and '-' for no note", async () => {
    mockFetch();
    render(<Customers />);
    await screen.findByText("โทรวันนี้");

    const cells = screen.getAllByTestId("customer-note-updated-at").map((c) => c.textContent);
    expect(cells).toEqual(["24 Sep 2026 14:30", "16 Sep 2026 10:00", "-"]);
  });

  it("moves a customer to the top the moment their note is saved from the detail modal", async () => {
    // The modal patches the list in place rather than refetching it, so this
    // is the path where a server-side ORDER BY alone would have left the
    // customer stuck where they were until a reload.
    const fetchMock = mockFetch({ noteUpdatedAt: "2026-09-24T09:00:00.000Z" });
    render(<Customers />);
    await screen.findByText("ไม่มีบันทึก");

    fireEvent.click(screen.getByText("ไม่มีบันทึก"));
    await screen.findByRole("heading", { name: "ไม่มีบันทึก" });
    // The modal's own บันทึกลูกค้า box — its heading is an <h3>, unlike the
    // column header and the note-search panel that share the words.
    const noteHeading = screen.getAllByText("บันทึกลูกค้า").find((el) => el.tagName === "H3")!;
    const noteBox = noteHeading.parentElement!.parentElement as HTMLElement;
    fireEvent.click(within(noteBox).getByRole("button", { name: "✏️ แก้ไข" }));
    fireEvent.change(noteBox.querySelector("textarea")!, {
      target: { value: "24/9/26 โทรครั้งแรก" },
    });
    fireEvent.click(within(noteBox).getByRole("button", { name: "บันทึก" }));

    await waitFor(() =>
      expect(customerOrder()).toEqual(["ไม่มีบันทึก", "โทรวันนี้", "โทรสัปดาห์ก่อน"])
    );
    expect(screen.getAllByTestId("customer-note-updated-at")[0].textContent).toBe("24 Sep 2026 16:00");
    // Moved without a refetch — the stamp came from the PUT response.
    expect(fetchMock.mock.calls.filter(([u]) => String(u) === "/api/customers")).toHaveLength(1);
  });
});
