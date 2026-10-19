/**
 * The อุปกรณ์ที่ขาย tab of /customers (app/customers/EquipmentTab.tsx), in the
 * same shape as the other lists: the shared pager, rows that open from the
 * keyboard, delete only on hover — and a reload that keeps the page.
 */
import { render, screen, fireEvent, within, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import EquipmentTab from "@/app/customers/EquipmentTab";

vi.mock("@/app/components/modals/EquipmentDetailsModal", () => ({
  default: ({ equipment, onClose }: { equipment: { id: string }; onClose: () => void }) => (
    <div data-testid="eq-details">
      {equipment.id}
      <button type="button" onClick={onClose}>close-details</button>
    </div>
  ),
}));
vi.mock("@/app/components/modals/EquipmentEditModal", () => ({
  default: ({ initialData }: { initialData: { id?: string } }) => <div data-testid="eq-edit">{initialData.id ?? "new"}</div>,
}));
vi.mock("@/app/lib/xlsxExport", () => ({ downloadExcel: vi.fn(async () => {}) }));

const pad = (n: number) => String(n).padStart(2, "0");
function machines(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `e${pad(i + 1)}`,
    customerId: "c1",
    productId: "p1",
    serialNumber: `SN-${pad(i + 1)}`,
    quotationNumber: "",
    warrantyCertNumber: "",
    warrantyType: "",
    warrantyStartDate: null,
    warrantyEndDate: null,
    status: "Active",
    createdAt: "2025-01-01T00:00:00.000Z",
    customerName: `ลูกค้า ${pad(i + 1)}`,
    companyName: "บริษัท ก",
    productName: `เครื่อง ${pad(i + 1)}`,
  }));
}

let equipmentList = machines(25);
function mockFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url === "/api/admin/equipments" ? equipmentList : [];
      return { ok: true, status: 200, json: async () => body };
    })
  );
}

const pager = () => screen.getByTestId("equipment-pagination");
const pageBox = () => within(pager()).getByRole("textbox", { name: "ไปที่หน้า" }) as HTMLInputElement;
const shownSerials = () =>
  screen.getAllByRole("row", { name: /^ดูข้อมูล / }).map((r) => r.querySelector("td.font-mono")?.textContent);

async function renderTab() {
  const showToast = vi.fn();
  render(<EquipmentTab showToast={showToast} />);
  await screen.findByText("SN-01");
  return showToast;
}

beforeEach(() => {
  equipmentList = machines(25);
  window.history.replaceState({}, "", "/customers?tab=equipment");
  mockFetch();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("/customers อุปกรณ์ที่ขาย", () => {
  it("uses the shared pager: 10 a page, first / last and a page box", async () => {
    await renderTab();
    expect(shownSerials()).toHaveLength(10);
    expect(pageBox().value).toBe("1");
    expect(pager().textContent).toContain("/ 3");

    fireEvent.click(within(pager()).getByRole("button", { name: "หน้าสุดท้าย" }));
    expect(shownSerials()).toEqual(["SN-21", "SN-22", "SN-23", "SN-24", "SN-25"]);
    expect(pager().textContent).toContain("แสดง 21 ถึง 25 จาก 25 รายการ");

    fireEvent.change(pageBox(), { target: { value: "2" } });
    fireEvent.keyDown(pageBox(), { key: "Enter" });
    expect(shownSerials()[0]).toBe("SN-11");
    fireEvent.click(within(pager()).getByRole("button", { name: "หน้าแรก" }));
    expect(shownSerials()[0]).toBe("SN-01");
  });

  it("shows no pager when everything fits", async () => {
    equipmentList = machines(10);
    await renderTab();
    expect(screen.queryByTestId("equipment-pagination")).not.toBeInTheDocument();
  });

  it("keeps the page when the list is reloaded (closing a machine refetches it)", async () => {
    await renderTab();
    fireEvent.click(within(pager()).getByRole("button", { name: "หน้าสุดท้าย" }));
    fireEvent.click(screen.getByRole("row", { name: "ดูข้อมูล เครื่อง 22 SN-22" }));
    expect(screen.getByTestId("eq-details").textContent).toContain("e22");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "close-details" }));
    });
    await screen.findByText("SN-21");
    expect(pageBox().value).toBe("3");
    expect(shownSerials()[0]).toBe("SN-21");
  });

  it("lands on the new last page when a reload brings back fewer machines", async () => {
    await renderTab();
    fireEvent.click(within(pager()).getByRole("button", { name: "หน้าสุดท้าย" }));
    fireEvent.click(screen.getByRole("row", { name: "ดูข้อมูล เครื่อง 25 SN-25" }));
    equipmentList = machines(15);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "close-details" }));
    });
    await screen.findByText("SN-11");
    expect(pageBox().value).toBe("2");
    expect(shownSerials()).toEqual(["SN-11", "SN-12", "SN-13", "SN-14", "SN-15"]);
  });

  it("a new search starts again from page 1", async () => {
    await renderTab();
    fireEvent.click(within(pager()).getByRole("button", { name: "หน้าสุดท้าย" }));
    fireEvent.change(screen.getByPlaceholderText("ค้นหาลูกค้า, บริษัท, สินค้า, Serial Number..."), {
      target: { value: "SN-" },
    });
    expect(pageBox().value).toBe("1");
    expect(shownSerials()[0]).toBe("SN-01");
  });

  it("rows open with Enter or Space; a key on a button inside is that button's", async () => {
    await renderTab();
    const row = screen.getByRole("row", { name: "ดูข้อมูล เครื่อง 03 SN-03" });
    expect(row).toHaveAttribute("tabindex", "0");

    fireEvent.keyDown(within(row).getByRole("button", { name: "แก้ไขอุปกรณ์" }), { key: "Enter" });
    fireEvent.keyDown(row, { key: "x" });
    expect(screen.queryByTestId("eq-details")).not.toBeInTheDocument();

    fireEvent.keyDown(row, { key: "Enter" });
    expect(screen.getByTestId("eq-details").textContent).toContain("e03");
    fireEvent.click(screen.getByRole("button", { name: "close-details" }));
    await screen.findByText("SN-01");

    fireEvent.keyDown(screen.getByRole("row", { name: "ดูข้อมูล เครื่อง 04 SN-04" }), { key: " " });
    expect(screen.getByTestId("eq-details").textContent).toContain("e04");
  });

  it("edit opens the form, not the machine; delete waits for hover", async () => {
    await renderTab();
    const row = screen.getByRole("row", { name: "ดูข้อมูล เครื่อง 01 SN-01" });
    const del = within(row).getByRole("button", { name: "ลบอุปกรณ์" });
    expect(del.className).toContain("opacity-0");
    expect(del.className).toContain("group-hover:opacity-100");
    expect(row.className).toContain("group");

    fireEvent.click(within(row).getByRole("button", { name: "แก้ไขอุปกรณ์" }));
    expect(screen.getByTestId("eq-edit").textContent).toBe("e01");
    expect(screen.queryByTestId("eq-details")).not.toBeInTheDocument();
  });

  it("one orange button; the rest plain white, as on the other tabs", async () => {
    await renderTab();
    const add = screen.getByRole("button", { name: /เพิ่มอุปกรณ์/ });
    expect(add.className).toContain("bg-orange-500");
    expect(add.className).not.toContain("gradient");
    const exportButton = screen.getByRole("button", { name: /Export Excel/ });
    expect(exportButton.className).toContain("bg-white");
    expect(exportButton.className).not.toContain("emerald");
    expect(screen.getByRole("link", { name: /แจ้งเตือน/ }).className).not.toContain("amber");
  });
});
