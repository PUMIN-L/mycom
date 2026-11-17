/**
 * The อุปกรณ์ที่ขาย tab of /customers — warranty status that agrees with
 * itself on the last day, Thai wording and dates, sortable columns, one
 * search box, a failed load said as one, no skeleton flash on a reload, the
 * pager back to the top, the export, and the delete dialog over the bell.
 */
import { render, screen, fireEvent, within, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import EquipmentTab from "@/app/customers/EquipmentTab";
import { downloadExcel } from "@/app/lib/xlsxExport";
import { formatDisplayDate, toLocalDateString } from "@/app/lib/dateFormat";

vi.mock("@/app/components/modals/EquipmentDetailsModal", () => ({
  default: ({ equipment, onClose }: { equipment: { id: string }; onClose: () => void }) => (
    <div data-testid="eq-details">
      {equipment.id}
      <button type="button" onClick={onClose}>close-details</button>
    </div>
  ),
}));
vi.mock("@/app/components/modals/EquipmentEditModal", () => ({ default: () => <div data-testid="eq-edit" /> }));
vi.mock("@/app/lib/xlsxExport", () => ({ downloadExcel: vi.fn(async () => {}) }));

/** Today plus `days`, as stored. */
const day = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return toLocalDateString(d);
};
function machine(id: string, over: Record<string, unknown> = {}) {
  return {
    id, customerId: "c1", productId: "p1", serialNumber: `SN-${id}`, quotationNumber: "", warrantyCertNumber: "",
    warrantyType: "1 ปี", warrantyStartDate: null, warrantyEndDate: null, status: "Active", createdAt: "2026-01-01T00:00:00.000Z",
    customerName: `ลูกค้า ${id}`, companyName: "บริษัท ก", productName: `<p>เครื่อง ${id}</p>`, ...over,
  };
}
const fixture = () => [
  machine("today", { warrantyEndDate: day(0) }),
  machine("past", { warrantyEndDate: day(-5) }),
  machine("later", { warrantyEndDate: day(90) }),
  machine("none"),
];

let equipments: unknown[];
let override: ((url: string) => unknown) | null = null;
const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
function installFetch() {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const custom = override?.(url);
    if (custom !== undefined) return custom;
    return json(url === "/api/admin/equipments" ? equipments : []);
  }));
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const rowOf = (id: string) => screen.getByRole("row", { name: new RegExp(`^ดูข้อมูล เครื่อง ${id} `) });
const serials = () => screen.queryAllByRole("row", { name: /^ดูข้อมูล / }).map((r) => r.querySelector("td.font-mono")?.textContent);
async function renderTab() {
  const showToast = vi.fn();
  render(<EquipmentTab showToast={showToast} />);
  await screen.findByText("SN-today");
  return showToast;
}

beforeEach(() => {
  equipments = fixture();
  override = null;
  installFetch();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("อุปกรณ์ที่ขาย — the warranty, said once and in Thai", () => {
  it("on its last day the warranty still holds — both columns agree", async () => {
    await renderTab();
    const today = rowOf("today");
    expect(within(today).getByTestId("warranty-left")).toHaveTextContent("หมดวันนี้");
    expect(within(today).getByTestId("warranty-status")).toHaveTextContent("อยู่ในประกัน");

    const past = rowOf("past");
    expect(within(past).getByTestId("warranty-left")).toHaveTextContent("หมดแล้ว");
    expect(within(past).getByTestId("warranty-status")).toHaveTextContent("หมดประกัน");

    expect(within(rowOf("later")).getByTestId("warranty-left")).toHaveTextContent("เหลือ 90 วัน");
    expect(within(rowOf("none")).getByTestId("warranty-status")).toHaveTextContent("ไม่ระบุวันหมด");
    expect(screen.queryByText("Active")).not.toBeInTheDocument();
    expect(screen.queryByText("Expired")).not.toBeInTheDocument();
  });

  it("shows the end date the way the rest of the site does", async () => {
    await renderTab();
    expect(within(rowOf("later")).getByText(formatDisplayDate(day(90)))).toBeInTheDocument();
    expect(screen.queryByText(day(90))).not.toBeInTheDocument();
  });

  it("the warranty filter says what it filters", async () => {
    await renderTab();
    expect(screen.getByRole("button", { name: "ประกัน: ทั้งหมด" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ประกัน: ทั้งหมด" }));
    fireEvent.click(screen.getByRole("button", { name: "ประกัน: หมดภายใน 30 วัน" }));
    expect(serials()).toEqual(["SN-today"]);
    fireEvent.click(screen.getByRole("button", { name: "ประกัน: หมดภายใน 30 วัน" }));
    fireEvent.click(screen.getByRole("button", { name: "ประกัน: หมดแล้ว" }));
    expect(serials()).toEqual(["SN-past"]);
  });
});

describe("อุปกรณ์ที่ขาย — sorting and searching", () => {
  it("sorts by customer, product, S/N and the warranty's end from the headers", async () => {
    await renderTab();
    expect(serials()).toEqual(["SN-today", "SN-past", "SN-later", "SN-none"]);
    const header = (name: RegExp) => screen.getByRole("button", { name });

    fireEvent.click(header(/^หมดประกัน/));
    expect(serials()).toEqual(["SN-past", "SN-today", "SN-later", "SN-none"]);
    expect(header(/^หมดประกัน/).closest("th")).toHaveAttribute("aria-sort", "ascending");
    fireEvent.click(header(/^หมดประกัน/));
    expect(serials()).toEqual(["SN-later", "SN-today", "SN-past", "SN-none"]);

    fireEvent.click(header(/^S\/N/));
    expect(serials()).toEqual(["SN-later", "SN-none", "SN-past", "SN-today"]);
    fireEvent.click(header(/^สินค้า/));
    expect(serials()).toEqual(["SN-later", "SN-none", "SN-past", "SN-today"]);
    fireEvent.click(header(/^ลูกค้า/));
    expect(header(/^ลูกค้า/).closest("th")).toHaveAttribute("aria-sort", "ascending");
  });

  it("a sort starts again from page 1", async () => {
    equipments = Array.from({ length: 25 }, (_, i) => machine(String(i + 10)));
    render(<EquipmentTab showToast={vi.fn()} />);
    await screen.findByText("SN-10");
    const pager = screen.getByTestId("equipment-pagination");
    fireEvent.click(within(pager).getByRole("button", { name: "หน้าสุดท้าย" }));
    fireEvent.click(screen.getByRole("button", { name: /^S\/N/ }));
    expect((within(screen.getByTestId("equipment-pagination")).getByRole("textbox", { name: "ไปที่หน้า" }) as HTMLInputElement).value).toBe("1");
  });

  it("one search box with ✕ to clear it", async () => {
    await renderTab();
    const box = screen.getByRole("textbox", { name: "ค้นหาอุปกรณ์" }) as HTMLInputElement;
    fireEvent.change(box, { target: { value: "SN-past" } });
    expect(serials()).toEqual(["SN-past"]);
    fireEvent.click(screen.getByRole("button", { name: "ล้างคำค้น" }));
    expect(box.value).toBe("");
    expect(serials()).toHaveLength(4);
  });
});

describe("อุปกรณ์ที่ขาย — loading", () => {
  it("a list that fails to load says so with ลองใหม่ — not that there are no machines", async () => {
    let fail = true;
    override = (url) => (url === "/api/admin/equipments" && fail ? json({ error: "x" }, 500) : undefined);
    render(<EquipmentTab showToast={vi.fn()} />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("โหลดรายการอุปกรณ์ไม่สำเร็จ");
    expect(screen.queryByText("ยังไม่มีอุปกรณ์ที่บันทึกไว้")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ส่งออก Excel" })).toBeDisabled();

    fail = false;
    fireEvent.click(within(alert).getByRole("button", { name: "ลองใหม่" }));
    expect(await screen.findByText("SN-today")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ส่งออก Excel" })).toBeEnabled();
  });

  it("a lost connection is a failed load too", async () => {
    override = (url) => (url === "/api/admin/equipments" ? Promise.reject(new TypeError("Failed to fetch")) : undefined);
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<EquipmentTab showToast={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("โหลดรายการอุปกรณ์ไม่สำเร็จ");
  });

  it("no machines at all still says there are none", async () => {
    equipments = [];
    render(<EquipmentTab showToast={vi.fn()} />);
    expect(await screen.findByText("ยังไม่มีอุปกรณ์ที่บันทึกไว้")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("a reload keeps the rows on screen — no skeleton flash", async () => {
    await renderTab();
    override = (url) => (url === "/api/admin/equipments" ? new Promise(() => {}) : undefined);
    fireEvent.click(rowOf("today"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "close-details" }));
    });
    expect(screen.getByText("SN-today")).toBeInTheDocument();
    expect(document.querySelector("tr.animate-pulse")).toBeNull();
  });

  it("the first load shows skeleton rows", async () => {
    override = (url) => (url === "/api/admin/equipments" ? new Promise(() => {}) : undefined);
    render(<EquipmentTab showToast={vi.fn()} />);
    await waitFor(() => expect(document.querySelectorAll("tr.animate-pulse").length).toBeGreaterThan(0));
  });

  it("an older reload answering last never overwrites a newer one", async () => {
    await renderTab();
    const older = deferred<unknown>();
    const newer = deferred<unknown>();
    let n = 0;
    override = (url) => (url === "/api/admin/equipments" ? (++n === 1 ? older.promise : newer.promise) : undefined);
    for (let i = 0; i < 2; i++) {
      fireEvent.click(rowOf("today"));
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "close-details" }));
      });
    }
    await act(async () => newer.resolve(json([machine("today", { warrantyEndDate: day(0) }), machine("fresh")])));
    expect(await screen.findByText("SN-fresh")).toBeInTheDocument();
    await act(async () => older.resolve(json([machine("today", { warrantyEndDate: day(0) }), machine("stale")])));
    expect(screen.queryByText("SN-stale")).not.toBeInTheDocument();
    expect(screen.getByText("SN-fresh")).toBeInTheDocument();
  });

  it("a failed reload keeps what was there", async () => {
    await renderTab();
    override = (url) => (url === "/api/admin/equipments" ? json({ error: "x" }, 500) : undefined);
    fireEvent.click(rowOf("today"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "close-details" }));
    });
    expect(screen.getByText("SN-today")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("อุปกรณ์ที่ขาย — paging, exporting, deleting", () => {
  it("changing page from below the list brings its top back into view", async () => {
    equipments = Array.from({ length: 25 }, (_, i) => machine(String(i + 10)));
    const { container } = render(<EquipmentTab showToast={vi.fn()} />);
    await screen.findByText("SN-10");
    const top = container.firstChild as HTMLElement;
    const scrollIntoView = vi.fn();
    top.scrollIntoView = scrollIntoView;
    const next = () => within(screen.getByTestId("equipment-pagination")).getByRole("button", { name: "ถัดไป" });

    vi.spyOn(top, "getBoundingClientRect").mockReturnValue({ top: 80 } as DOMRect);
    fireEvent.click(next());
    expect(scrollIntoView).not.toHaveBeenCalled();
    vi.spyOn(top, "getBoundingClientRect").mockReturnValue({ top: -700 } as DOMRect);
    fireEvent.click(next());
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "start" });
  });

  it("exports with the status in Thai, and says so in Thai", async () => {
    const showToast = await renderTab();
    fireEvent.click(screen.getByRole("button", { name: "ส่งออก Excel" }));
    await waitFor(() => expect(downloadExcel).toHaveBeenCalled());
    const rows = (vi.mocked(downloadExcel).mock.calls[0][1] as { rows: Record<string, string>[] }[])[0].rows;
    expect(rows.map((r) => r["สถานะ"])).toEqual(["อยู่ในประกัน", "หมดประกัน", "อยู่ในประกัน", "ไม่ระบุวันหมด"]);
    expect(showToast).toHaveBeenCalledWith("ส่งออกไฟล์อุปกรณ์สำเร็จ", "success");
  });

  it("the delete dialog sits over the admin bell", async () => {
    await renderTab();
    fireEvent.click(within(rowOf("past")).getByRole("button", { name: "ลบอุปกรณ์" }));
    const dialog = screen.getByText("ยืนยันการลบอุปกรณ์").closest(".fixed") as HTMLElement;
    expect(dialog.className).toContain("z-100");
  });
});
