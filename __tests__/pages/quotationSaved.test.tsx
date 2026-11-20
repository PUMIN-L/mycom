/**
 * /quotation/saved — the list of saved quotations (it used to be a tab of the
 * old /billing/saved, which went with the billing module).
 *
 * The network is mocked throughout: this file is about what the SCREEN does —
 * which rows a search or a date range leaves visible, what ลบที่เลือก actually
 * sends, and what it says when the server refuses some. The rules themselves
 * are unit-tested in __tests__/lib/savedDocFilter.test.ts.
 *
 * The properties worth pinning are the ones a refactor would quietly break:
 *   • a bulk delete never touches a ticked row the filter has hidden;
 *   • a refused quotation is NAMED with its reason, never folded into a count;
 *   • the ones that did go are removed, the refused ones stay;
 *   • ticking a row does not also open it;
 *   • images freed by the deletes are pooled, de-duplicated, asked about once;
 *   • the countdown to the nightly purge is the real two years, not 30 days.
 */
import { render, screen, fireEvent, waitFor, within, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import SavedQuotationsPage from "@/app/quotation/saved/page";

const push = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace, prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/quotation/saved",
  useSearchParams: () => new URLSearchParams(),
}));
const auth = { isLoggedIn: true, isLoading: false };
vi.mock("@/app/context/AuthContext", () => ({
  useAuth: () => auth,
}));

/** 10:00 Bangkok on the given day — unambiguously that Bangkok date. */
const at = (day: string) => `${day}T03:00:00.000Z`;

/** As `/api/quotations` really answers: no `docType`, newest first. */
const QUOTES = [
  { id: "q-sep30", docNo: "QT-2609-030", createdAt: at("2026-09-30"), customer: "บริษัท กอไก่", total: 30000 },
  { id: "q-sep15", docNo: "QT-2609-015", createdAt: at("2026-09-15"), customer: "ห้างขอไข่", total: 20000 },
  { id: "q-sep10", docNo: "QT-2609-010", createdAt: at("2026-09-10"), customer: "ห้างขอไข่", total: 50000 },
  { id: "q-sep01", docNo: "QT-2609-001", createdAt: at("2026-09-01"), customer: "บริษัท กอไก่", total: 10000 },
];

interface DeleteBehaviour {
  /** Per quotation id: what its DELETE answers. Default = 200, no images. */
  [id: string]: { status?: number; body?: unknown };
}

function mockFetch(deletes: DeleteBehaviour = {}, list: unknown = QUOTES, listStatus = 200) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });
    if (init?.method === "DELETE") {
      const id = decodeURIComponent(url.split("/").pop()!);
      const behaviour = deletes[id] ?? {};
      return json(behaviour.status ?? 200, behaviour.body ?? { success: true });
    }
    if (url === "/api/quotations") return json(listStatus, list);
    return json(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const deleteCalls = (m: ReturnType<typeof mockFetch>) =>
  m.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "DELETE").map(([u]) => String(u));

/** The quotation numbers currently in the table. */
const visibleDocNos = () =>
  screen.queryByTestId("quotation-table")
    ? screen
        .getAllByRole("row")
        .slice(1)
        .map((row) => row.querySelector("td:nth-child(2) a")?.textContent?.trim() ?? "")
    : [];

const setRange = (from?: string, to?: string) => {
  if (from !== undefined) fireEvent.change(screen.getByPlaceholderText("วันที่เริ่มต้น"), { target: { value: from } });
  if (to !== undefined) fireEvent.change(screen.getByPlaceholderText("วันที่สิ้นสุด"), { target: { value: to } });
};

/** Renders and waits for the first load to finish. */
async function renderPage(deletes?: DeleteBehaviour) {
  const fetchMock = mockFetch(deletes);
  render(<SavedQuotationsPage />);
  await screen.findByText("QT-2609-001");
  return fetchMock;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-30T03:00:00.000Z"));
  auth.isLoggedIn = true;
  auth.isLoading = false;
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("/quotation/saved — the list", () => {
  it("lists every saved quotation, newest first, with the customer, the total and the save date", async () => {
    await renderPage();
    expect(visibleDocNos()).toEqual(["QT-2609-030", "QT-2609-015", "QT-2609-010", "QT-2609-001"]);
    const row = screen.getByText("QT-2609-010").closest("tr")!;
    expect(row.textContent).toContain("ห้างขอไข่");
    expect(row.textContent).toContain("50,000.00");
    expect(row.textContent).toContain("10 Sep 2026");
    // Says how long a save keeps — the constant the nightly purge uses.
    expect(screen.getByText(/เก็บไว้ 2 ปี นับจากการบันทึกครั้งล่าสุด/)).toBeInTheDocument();
  });

  it("asks the list without a cache — a quotation saved a moment ago must be in it", async () => {
    const fetchMock = await renderPage();
    expect(fetchMock).toHaveBeenCalledWith("/api/quotations", { cache: "no-store" });
  });

  it("a click on a row opens the quotation to view; the number is a link for the keyboard", async () => {
    await renderPage();
    const row = screen.getByText("QT-2609-015").closest("tr")!;
    fireEvent.click(within(row).getByText("ห้างขอไข่"));
    expect(push).toHaveBeenCalledWith("/quotation?id=q-sep15&view=1");
    expect(screen.getByRole("link", { name: "QT-2609-010" }).getAttribute("href")).toBe("/quotation?id=q-sep10&view=1");
  });

  it("แก้ไข (New Ver.) opens a new version, and does not also open the row", async () => {
    await renderPage();
    const row = screen.getByText("QT-2609-030").closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: /แก้ไข \(New Ver\.\)/ }));
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/quotation?id=q-sep30&action=clone");
  });

  it("searches the number and the customer", async () => {
    await renderPage();
    fireEvent.change(screen.getByRole("textbox", { name: "ค้นหาใบเสนอราคา" }), { target: { value: "ขอไข่" } });
    await waitFor(() => expect(visibleDocNos()).toEqual(["QT-2609-015", "QT-2609-010"]));
    fireEvent.change(screen.getByRole("textbox", { name: "ค้นหาใบเสนอราคา" }), { target: { value: "2609-001" } });
    await waitFor(() => expect(visibleDocNos()).toEqual(["QT-2609-001"]));
  });

  it("says nothing matched — not that there are no quotations — when a search hides them all", async () => {
    await renderPage();
    fireEvent.change(screen.getByRole("textbox", { name: "ค้นหาใบเสนอราคา" }), { target: { value: "ไม่มีชื่อนี้" } });
    expect(await screen.findByText(/ไม่พบใบเสนอราคาที่ตรงกับการค้นหาหรือช่วงวันที่/)).toBeInTheDocument();
    expect(screen.queryByText("ยังไม่มีใบเสนอราคาที่บันทึกไว้")).toBeNull();
  });

  it("with none saved, offers to make one", async () => {
    mockFetch({}, []);
    render(<SavedQuotationsPage />);
    expect(await screen.findByText("ยังไม่มีใบเสนอราคาที่บันทึกไว้")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "สร้างใบเสนอราคาใหม่" }).getAttribute("href")).toBe("/quotation?new=1");
  });

  it("a failed load says so and ลองใหม่ asks again", async () => {
    const fetchMock = mockFetch({}, { error: "x" }, 500);
    render(<SavedQuotationsPage />);
    expect(await screen.findByText("โหลดรายการใบเสนอราคาไม่สำเร็จ")).toBeInTheDocument();
    mockFetch();
    fireEvent.click(screen.getByRole("button", { name: "ลองใหม่" }));
    expect(await screen.findByText("QT-2609-001")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("an answer that is not a list is a failed load, not an empty one", async () => {
    mockFetch({}, { rows: [] });
    render(<SavedQuotationsPage />);
    expect(await screen.findByText("โหลดรายการใบเสนอราคาไม่สำเร็จ")).toBeInTheDocument();
  });

  it("sends a signed-out visitor to the login page", async () => {
    auth.isLoggedIn = false;
    mockFetch();
    render(<SavedQuotationsPage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
  });

  it("tags the versions of one number: the highest is the latest, the rest are old", async () => {
    mockFetch({}, [
      { id: "v2", docNo: "QT20260930-22v2", createdAt: at("2026-09-30"), customer: "ก", total: 1 },
      { id: "v1", docNo: "QT20260930-22", createdAt: at("2026-09-29"), customer: "ก", total: 1 },
      { id: "solo", docNo: "QT20260930-23", createdAt: at("2026-09-28"), customer: "ข", total: 1 },
    ]);
    render(<SavedQuotationsPage />);
    const latest = (await screen.findByText("QT20260930-22v2")).closest("tr")!;
    expect(latest.textContent).toContain("(เวอร์ชันล่าสุด)");
    expect(screen.getByText("QT20260930-22").closest("tr")!.textContent).toContain("(เวอร์ชันเก่า)");
    // A number with one version carries no tag.
    expect(screen.getByText("QT20260930-23").closest("tr")!.textContent).not.toMatch(/เวอร์ชัน/);
  });

  it("warns only of a purge that is near — the real two years, not the old 30 days", async () => {
    mockFetch({}, [
      // Saved 2 years less 10 days ago — the nightly cleanup takes it in 10 days.
      { id: "old", docNo: "QT-OLD", createdAt: new Date(Date.parse("2026-09-30T03:00:00.000Z") - 720 * 86400000).toISOString(), customer: "ก", total: 1 },
      // Saved 29 days ago: the old list showed it red, "1d" left.
      { id: "recent", docNo: "QT-RECENT", createdAt: at("2026-09-01"), customer: "ข", total: 1 },
    ]);
    render(<SavedQuotationsPage />);
    expect((await screen.findByText("QT-OLD")).closest("tr")!.textContent).toContain("ระบบจะลบอัตโนมัติใน 10 วัน");
    expect(screen.getByText("QT-RECENT").closest("tr")!.textContent).not.toContain("ระบบจะลบอัตโนมัติ");
  });
});

describe("/quotation/saved — ช่วงวันที่", () => {
  it("narrows the table to the chosen range, both ends included", async () => {
    await renderPage();
    setRange("2026-09-10", "2026-09-15");
    await waitFor(() => expect(visibleDocNos()).toEqual(["QT-2609-015", "QT-2609-010"]));
    expect(screen.getByText(/พบ 2 ใบ/)).toBeInTheDocument();
  });

  it("takes one end on its own", async () => {
    await renderPage();
    setRange("2026-09-15", undefined);
    await waitFor(() => expect(visibleDocNos()).toHaveLength(2)); // 15th + 30th
    // "เป็นต้นมา" belongs to the caption alone — "ตั้งแต่" is also the field label.
    expect(screen.getByText(/เป็นต้นมา/)).toBeInTheDocument();
  });

  it("never leaves a range that reads forwards but runs backwards", async () => {
    await renderPage();
    fireEvent.change(screen.getByPlaceholderText("วันที่สิ้นสุด"), { target: { value: "2026-09-05" } });
    fireEvent.change(screen.getByPlaceholderText("วันที่เริ่มต้น"), { target: { value: "2026-09-20" } });
    await waitFor(() =>
      expect(screen.queryByText(/อยู่หลังวันสิ้นสุด/) ?? screen.getByText(/กำลังดูใบเสนอราคาที่บันทึก/)).toBeInTheDocument()
    );
  });

  it("ล้างช่วงวันที่ brings every quotation back", async () => {
    await renderPage();
    setRange("2026-09-10", "2026-09-15");
    await waitFor(() => expect(visibleDocNos()).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "ล้างช่วงวันที่" }));
    await waitFor(() => expect(visibleDocNos()).toHaveLength(4));
  });

  it("the วันนี้ shortcut shows only today's quotations", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "วันนี้" }));
    await waitFor(() => expect(visibleDocNos()).toEqual(["QT-2609-030"]));
  });
});

describe("/quotation/saved — ลบ", () => {
  it("ลบ on one row asks first, then deletes that one and drops it", async () => {
    const fetchMock = await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "ลบ QT-2609-015" }));
    expect(screen.getByText(/ต้องการลบ QT-2609-015 หรือไม่\?/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ลบ" }));
    await waitFor(() => expect(deleteCalls(fetchMock)).toEqual(["/api/quotations/q-sep15"]));
    await waitFor(() => expect(visibleDocNos()).toEqual(["QT-2609-030", "QT-2609-010", "QT-2609-001"]));
    expect(push).not.toHaveBeenCalled();
  });

  it("a refused single delete keeps the row and says the server's reason", async () => {
    await renderPage({ "q-sep15": { status: 404, body: { success: false } } });
    fireEvent.click(screen.getByRole("button", { name: "ลบ QT-2609-015" }));
    fireEvent.click(screen.getByRole("button", { name: "ลบ" }));
    // The toast reads "❌ <reason>" — the server's reason, or ours when it gives none.
    expect(await screen.findByText(/ไม่พบใบเสนอราคานี้แล้ว \(อาจถูกลบไปก่อนหน้านี้\)/)).toBeInTheDocument();
    expect(visibleDocNos()).toContain("QT-2609-015");
  });

  it("the images a single delete frees are asked about", async () => {
    const OWN = "https://res.cloudinary.com/demo/image/upload/v1/own.jpg";
    await renderPage({ "q-sep15": { body: { success: true, orphanedImages: [OWN] } } });
    fireEvent.click(screen.getByRole("button", { name: "ลบ QT-2609-015" }));
    fireEvent.click(screen.getByRole("button", { name: "ลบ" }));
    expect(await screen.findByText(/รูปที่ 1/)).toBeInTheDocument();
  });
});

describe("/quotation/saved — เลือกหลายใบแล้วลบพร้อมกัน", () => {
  it("ticking a row selects it without opening the quotation", async () => {
    await renderPage();
    fireEvent.click(screen.getByLabelText("เลือก QT-2609-001"));
    expect(screen.getByRole("button", { name: /ลบที่เลือก \(1\)/ })).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("เลือกทั้งหมด ticks every row on screen — only the ones on screen", async () => {
    await renderPage();
    setRange("2026-09-10", "2026-09-15");
    await waitFor(() => expect(visibleDocNos()).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "☑️ เลือกทั้งหมด" }));
    expect(screen.getByRole("button", { name: /ลบที่เลือก \(2\)/ })).toBeInTheDocument();
    expect(screen.getByText(/เลือกไว้ 2 จาก 2 ใบที่เห็นอยู่/)).toBeInTheDocument();
  });

  it("deletes the selected quotations and drops them from the table", async () => {
    const fetchMock = await renderPage();
    setRange("2026-09-10", "2026-09-15");
    await waitFor(() => expect(visibleDocNos()).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "☑️ เลือกทั้งหมด" }));
    fireEvent.click(screen.getByRole("button", { name: /ลบที่เลือก \(2\)/ }));

    // The confirmation names the count and the range, so a wrong month shows before ลบ.
    expect(screen.getByText(/กำลังจะลบใบเสนอราคา 2 ใบ/)).toBeInTheDocument();
    expect(screen.getByText(/ช่วงวันที่: 10 Sep 2026 ถึง 15 Sep 2026/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "ลบ 2 ใบ" }));
    await waitFor(() => expect(deleteCalls(fetchMock)).toHaveLength(2));
    expect(deleteCalls(fetchMock).sort()).toEqual(["/api/quotations/q-sep10", "/api/quotations/q-sep15"]);

    fireEvent.click(screen.getByRole("button", { name: "ล้างช่วงวันที่" }));
    await waitFor(() => expect(visibleDocNos()).toEqual(["QT-2609-030", "QT-2609-001"]));
  });

  // THE SAFETY PROPERTY: tick rows, narrow the filter, delete — the rows that
  // are no longer in front of the admin must survive.
  it("never deletes a ticked row the filter has hidden", async () => {
    const fetchMock = await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "☑️ เลือกทั้งหมด" })); // all 4
    expect(screen.getByRole("button", { name: /ลบที่เลือก \(4\)/ })).toBeInTheDocument();

    setRange("2026-09-15", "2026-09-15"); // only QT-2609-015 left on screen
    await waitFor(() => expect(visibleDocNos()).toEqual(["QT-2609-015"]));
    expect(screen.getByText(/อีก 3 ใบที่ติ๊กไว้ถูกตัวกรองซ่อนอยู่ จะไม่ถูกลบ/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /ลบที่เลือก \(1\)/ }));
    fireEvent.click(screen.getByRole("button", { name: "ลบ 1 ใบ" }));
    await waitFor(() => expect(deleteCalls(fetchMock)).toEqual(["/api/quotations/q-sep15"]));
  });

  it("names the quotations the server refused, and keeps them, while the rest go", async () => {
    const fetchMock = await renderPage({
      "q-sep10": { status: 500, body: { error: "ลบใบเสนอราคาไม่สำเร็จ" } },
    });
    fireEvent.click(screen.getByRole("button", { name: "☑️ เลือกทั้งหมด" }));
    fireEvent.click(screen.getByRole("button", { name: /ลบที่เลือก \(4\)/ }));
    fireEvent.click(screen.getByRole("button", { name: "ลบ 4 ใบ" }));
    await waitFor(() => expect(deleteCalls(fetchMock)).toHaveLength(4));

    const report = await screen.findByRole("alert");
    expect(within(report).getByRole("heading", { name: /ลบไม่ได้ 1 ใบ/ })).toBeInTheDocument();
    const listed = within(report).getAllByRole("listitem");
    expect(listed).toHaveLength(1);
    expect(listed[0].textContent).toContain("QT-2609-010");
    expect(listed[0].textContent).toContain("ลบใบเสนอราคาไม่สำเร็จ");

    await waitFor(() => expect(visibleDocNos()).toEqual(["QT-2609-010"]));
    // The refused one stays ticked, ready for another try.
    expect((screen.getByLabelText("เลือก QT-2609-010") as HTMLInputElement).checked).toBe(true);
  });

  it("a dropped connection mid-sweep is reported for that quotation, and the sweep carries on", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "DELETE") {
        if (url.endsWith("q-sep15")) throw new TypeError("Failed to fetch");
        return { ok: true, status: 200, json: async () => ({ success: true }) };
      }
      return { ok: true, status: 200, json: async () => QUOTES };
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<SavedQuotationsPage />);
    await screen.findByText("QT-2609-001");
    fireEvent.click(screen.getByRole("button", { name: "☑️ เลือกทั้งหมด" }));
    fireEvent.click(screen.getByRole("button", { name: /ลบที่เลือก \(4\)/ }));
    fireEvent.click(screen.getByRole("button", { name: "ลบ 4 ใบ" }));
    const report = await screen.findByRole("alert");
    expect(within(report).getByRole("listitem").textContent).toContain("QT-2609-015 — เชื่อมต่อไม่สำเร็จ");
    await waitFor(() => expect(visibleDocNos()).toEqual(["QT-2609-015"]));
  });

  it("pools the freed images and asks once, without asking twice for the same URL", async () => {
    const SHARED = "https://res.cloudinary.com/demo/image/upload/v1/shared.jpg";
    const OWN = "https://res.cloudinary.com/demo/image/upload/v1/own.jpg";
    const fetchMock = await renderPage({
      // A "แก้ไข (New Ver.)" clone carries its original's URL, so the same
      // photo can be freed by two quotations in one sweep.
      "q-sep01": { body: { success: true, orphanedImages: [SHARED] } },
      "q-sep15": { body: { success: true, orphanedImages: [SHARED, OWN] } },
    });
    setRange("2026-09-01", "2026-09-15");
    await waitFor(() => expect(visibleDocNos()).toHaveLength(3));
    fireEvent.click(screen.getByRole("button", { name: "☑️ เลือกทั้งหมด" }));
    fireEvent.click(screen.getByRole("button", { name: /ลบที่เลือก \(3\)/ }));
    fireEvent.click(screen.getByRole("button", { name: "ลบ 3 ใบ" }));
    await waitFor(() => expect(deleteCalls(fetchMock)).toHaveLength(3));

    // One dialog, two images — not three.
    expect(await screen.findByText(/รูปที่ 1/)).toBeInTheDocument();
    expect(screen.getByText(/จาก 2/)).toBeInTheDocument();
  });

  it("ล้างการเลือก unticks everything", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "☑️ เลือกทั้งหมด" }));
    fireEvent.click(screen.getByRole("button", { name: "ล้างการเลือก" }));
    expect(screen.queryByRole("button", { name: /ลบที่เลือก/ })).not.toBeInTheDocument();
  });
});
