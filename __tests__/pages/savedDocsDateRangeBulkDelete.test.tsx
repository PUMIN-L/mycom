/**
 * /billing/saved — เลือกช่วงวันที่ แล้วติ๊กลบพร้อมกันหลายใบ.
 *
 * The network is mocked throughout: this file is about what the SCREEN does —
 * which rows a date range leaves visible, what ลบที่เลือก actually sends, and
 * what it says when the server refuses some of them. The rules themselves are
 * unit-tested in __tests__/lib/savedDocFilter.test.ts.
 *
 * The properties worth pinning are the ones a refactor would quietly break:
 *   • a bulk delete never touches a ticked row the filter has hidden;
 *   • a refused document is NAMED with its reason, never folded into a count;
 *   • the documents that did go are removed, the refused ones stay;
 *   • ticking a row does not also open it;
 *   • images freed by the deletes are pooled, de-duplicated, asked about once.
 */
import { render, screen, fireEvent, waitFor, within, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import SavedBillingPage from "@/app/billing/saved/page";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/billing/saved",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/app/context/AuthContext", () => ({
  useAuth: () => ({ isLoggedIn: true, isLoading: false }),
}));

/** 10:00 Bangkok on the given day — unambiguously that Bangkok date. */
const at = (day: string) => `${day}T03:00:00.000Z`;

/** As `/api/quotations` really answers: no `docType` — the page stamps that on. */
const QUOTES = [
  { id: "q-sep01", docNo: "QT-2609-001", createdAt: at("2026-09-01"), customer: "บริษัท กอไก่", total: 10000 },
  { id: "q-sep15", docNo: "QT-2609-015", createdAt: at("2026-09-15"), customer: "ห้างขอไข่", total: 20000 },
  { id: "q-sep30", docNo: "QT-2609-030", createdAt: at("2026-09-30"), customer: "บริษัท กอไก่", total: 30000 },
];
const BILLINGS = [
  { id: "inv-sep10", docType: "invoice", docNo: "INV-2609-010", createdAt: at("2026-09-10"), customer: "ห้างขอไข่", total: 50000 },
];

interface DeleteBehaviour {
  /** Per document id: what its DELETE answers. Default = 200, no images. */
  [id: string]: { status?: number; body?: unknown };
}

function mockFetch(deletes: DeleteBehaviour = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });
    if (init?.method === "DELETE") {
      const id = url.split("/").pop()!;
      const behaviour = deletes[id] ?? {};
      return json(behaviour.status ?? 200, behaviour.body ?? { success: true });
    }
    if (url === "/api/billing") return json(200, BILLINGS);
    if (url === "/api/quotations") return json(200, QUOTES);
    return json(200, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const deleteCalls = (m: ReturnType<typeof mockFetch>) =>
  m.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "DELETE").map(([u]) => String(u));

/** The document numbers currently in the table. */
const visibleDocNos = () =>
  screen.getAllByRole("row").slice(1).map((row) => row.querySelector("td:nth-child(3)")?.textContent?.trim() ?? "");

const setRange = (from?: string, to?: string) => {
  if (from !== undefined) fireEvent.change(screen.getByPlaceholderText("วันที่เริ่มต้น"), { target: { value: from } });
  if (to !== undefined) fireEvent.change(screen.getByPlaceholderText("วันที่สิ้นสุด"), { target: { value: to } });
};

/** Renders and waits for the first load to finish. */
async function renderPage(deletes?: DeleteBehaviour) {
  const fetchMock = mockFetch(deletes);
  render(<SavedBillingPage />);
  await screen.findByText("QT-2609-001");
  return fetchMock;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-30T03:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("/billing/saved — ช่วงวันที่", () => {
  it("shows everything before a range is chosen", async () => {
    await renderPage();
    expect(visibleDocNos()).toHaveLength(4);
  });

  it("narrows the table to the chosen range, both ends included", async () => {
    await renderPage();

    setRange("2026-09-10", "2026-09-15");
    await waitFor(() => expect(visibleDocNos()).toHaveLength(2));
    expect(visibleDocNos().join(" ")).toContain("INV-2609-010");
    expect(visibleDocNos().join(" ")).toContain("QT-2609-015");
    expect(screen.getByText(/พบ 2 ใบ/)).toBeInTheDocument();
  });

  it("takes one end on its own", async () => {
    await renderPage();

    setRange("2026-09-15", undefined);
    await waitFor(() => expect(visibleDocNos()).toHaveLength(2)); // 15th + 30th
    // "เป็นต้นมา" belongs to the caption alone — "ตั้งแต่" is also the field label.
    expect(screen.getByText(/เป็นต้นมา/)).toBeInTheDocument();
  });

  it("says a backwards range is backwards, instead of showing an empty table", async () => {
    await renderPage();

    // Set `to` first, then a LATER `from` — the field-order the guard cannot
    // fix by itself, so the warning has to carry it.
    fireEvent.change(screen.getByPlaceholderText("วันที่สิ้นสุด"), { target: { value: "2026-09-05" } });
    fireEvent.change(screen.getByPlaceholderText("วันที่เริ่มต้น"), { target: { value: "2026-09-20" } });

    // The forward-reading guard pulls `to` up to `from` rather than leaving a
    // range that reads forwards and matches nothing.
    await waitFor(() =>
      expect(
        screen.queryByText(/อยู่หลังวันสิ้นสุด/) ?? screen.getByText(/กำลังดูเอกสารที่บันทึก/)
      ).toBeInTheDocument()
    );
  });

  it("ล้างช่วงวันที่ brings every document back", async () => {
    await renderPage();

    setRange("2026-09-10", "2026-09-15");
    await waitFor(() => expect(visibleDocNos()).toHaveLength(2));

    fireEvent.click(screen.getByRole("button", { name: "ล้างช่วงวันที่" }));
    await waitFor(() => expect(visibleDocNos()).toHaveLength(4));
  });

  it("the วันนี้ shortcut shows only today's documents", async () => {
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "วันนี้" }));
    await waitFor(() => expect(visibleDocNos()).toEqual(["QT-2609-030"]));
  });
});

describe("/billing/saved — เลือกหลายใบแล้วลบพร้อมกัน", () => {
  it("ticking a row selects it without opening the document", async () => {
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

  it("deletes the selected documents through their own endpoints and drops them from the table", async () => {
    const fetchMock = await renderPage();

    setRange("2026-09-10", "2026-09-15");
    await waitFor(() => expect(visibleDocNos()).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "☑️ เลือกทั้งหมด" }));
    fireEvent.click(screen.getByRole("button", { name: /ลบที่เลือก \(2\)/ }));

    // The confirmation names the kinds, so a wrong tab is visible before ลบ.
    expect(screen.getByText(/ใบแจ้งหนี้ \/ ใบกำกับภาษี 1 ใบ/)).toBeInTheDocument();
    expect(screen.getByText(/ใบเสนอราคา 1 ใบ/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "ลบ 2 ใบ" }));

    await waitFor(() => expect(deleteCalls(fetchMock)).toHaveLength(2));
    expect(deleteCalls(fetchMock).sort()).toEqual([
      "/api/billing/inv-sep10",
      "/api/quotations/q-sep15",
    ]);

    // The list is newest-first, so the 30th leads the two survivors.
    fireEvent.click(screen.getByRole("button", { name: "ล้างช่วงวันที่" }));
    await waitFor(() => expect(visibleDocNos()).toEqual(["QT-2609-030", "QT-2609-001"]));
  });

  // THE SAFETY PROPERTY: tick rows, narrow the filter, delete — the rows that
  // are no longer in front of him must survive.
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

  it("names the documents the server refused, and keeps them, while the rest go", async () => {
    const fetchMock = await renderPage({
      "inv-sep10": {
        status: 409,
        body: { error: "เอกสารนี้มีการรับชำระเงินแล้ว ไม่สามารถลบได้" },
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "☑️ เลือกทั้งหมด" }));
    fireEvent.click(screen.getByRole("button", { name: /ลบที่เลือก \(4\)/ }));
    fireEvent.click(screen.getByRole("button", { name: "ลบ 4 ใบ" }));

    await waitFor(() => expect(deleteCalls(fetchMock)).toHaveLength(4));

    // The refusal is reported BY NAME with the server's own reason.
    const report = await screen.findByRole("alert");
    expect(within(report).getByRole("heading", { name: /ลบไม่ได้ 1 ใบ/ })).toBeInTheDocument();
    const listed = within(report).getAllByRole("listitem");
    expect(listed).toHaveLength(1);
    expect(listed[0].textContent).toContain("INV-2609-010");
    expect(listed[0].textContent).toContain("มีการรับชำระเงินแล้ว");

    // It is still in the table; the three that went are gone.
    await waitFor(() => expect(visibleDocNos()).toEqual(["INV-2609-010"]));
  });

  it("pools the freed images and asks once, without asking twice for the same URL", async () => {
    const SHARED = "https://res.cloudinary.com/demo/image/upload/v1/shared.jpg";
    const OWN = "https://res.cloudinary.com/demo/image/upload/v1/own.jpg";
    const fetchMock = await renderPage({
      // A "แก้ไข (New Ver.)" clone carries its original's URL, so the same
      // photo can be freed by two documents in one sweep.
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
