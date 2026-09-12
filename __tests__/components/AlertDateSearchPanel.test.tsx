/**
 * ค้นหาแจ้งเตือนตามวันที่ — the search + bulk-reschedule block on /crm/alerts.
 *
 * The network is mocked in every test: this file is about what the SCREEN does
 * with a response, never about SQL (that is `__tests__/api/alertSearch.test.ts`
 * and `__tests__/lib/alertSearchStore.test.ts`).
 *
 * The rules worth pinning are the ones a refactor would quietly break:
 *   • a search reaches the PAST as freely as the future, and a single-day
 *     search is `from === to` — one code path, never widened;
 *   • a search opens as a TABLE until he picks otherwise, and after that HIS
 *     CHOICE WINS — including when the stored preference cannot be read at all;
 *   • an immovable row shows a DISABLED box with its reason as visible TEXT,
 *     and เลือกทั้งหมด SKIPS it instead of ticking it for the server to refuse;
 *   • nothing is written before a ConfirmDialog has shown the real
 *     before → after;
 *   • the all-refused 400 renders reasons, not a generic error.
 */

import { render, screen, fireEvent, waitFor, within, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import AlertDateSearchPanel, {
  ALERT_SEARCH_VIEW_STORAGE_KEY,
  readStoredSearchView,
} from "@/app/components/AlertDateSearchPanel";
import { IMMOVABLE_REASONS } from "@/app/lib/alertDateSearch";
import type { DatedAlertRow } from "@/app/lib/alertDateSearch";

const TODAY = "2026-06-12";

// ── Fixtures ────────────────────────────────────────────────────────────────

/** Rows as the SERVER builds them: `movable` / `immovableCode` /
 *  `immovableReason` already decided by `evaluateMovability`, so the screen
 *  renders the verdict rather than recomputing it. */
function row(overrides: Partial<DatedAlertRow> & Pick<DatedAlertRow, "kind" | "id">): DatedAlertRow {
  return {
    matchedDate: TODAY,
    title: "รายการ",
    subtitle: "",
    customerName: "",
    companyName: "",
    status: "pending",
    overdue: false,
    snoozedUntil: null,
    movable: true,
    immovableReason: null,
    immovableCode: null,
    ...overrides,
  } as DatedAlertRow;
}

const SCHEDULE = row({
  kind: "schedule",
  id: "s1",
  title: "นัดเข้าบริการ",
  customerName: "สมชาย",
  matchedDate: TODAY,
});
const TASK = row({
  kind: "task",
  id: "t1",
  title: "โทรหาเจ้านี้",
  matchedDate: "2026-06-14",
});
const CLOSED_SCHEDULE = row({
  kind: "schedule",
  id: "s2",
  title: "นัดที่ปิดงานแล้ว",
  status: "completed",
  movable: false,
  immovableCode: "closed",
  immovableReason: IMMOVABLE_REASONS.completed,
});
const WARRANTY = row({
  kind: "warranty",
  id: "w1",
  title: "เครื่องวัด A",
  status: "Active",
  movable: false,
  immovableCode: "immovable_fact",
  immovableReason: IMMOVABLE_REASONS.warranty,
});
const RECEIVABLE = row({
  kind: "receivable",
  id: "b1",
  title: "INV-2026-001",
  status: "unpaid",
  movable: false,
  immovableCode: "immovable_fact",
  immovableReason: IMMOVABLE_REASONS.receivable,
});

function searchResult(rows: DatedAlertRow[], from = TODAY, to = TODAY) {
  const bucket = (kind: string) => {
    const list = rows.filter((r) => r.kind === kind);
    return { rows: list, total: list.length };
  };
  return {
    from,
    to,
    schedules: bucket("schedule"),
    customerCalls: bucket("customer_call"),
    tasks: bucket("task"),
    warranties: bucket("warranty"),
    calibrations: bucket("calibration"),
    receivables: bucket("receivable"),
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    json: async () => body,
  } as unknown as Response;
}

const DEFAULT_ROWS = [SCHEDULE, TASK, CLOSED_SCHEDULE, WARRANTY, RECEIVABLE];

interface Harness {
  onToast: ReturnType<typeof vi.fn>;
  onRescheduled: ReturnType<typeof vi.fn>;
  onUnauthorized: ReturnType<typeof vi.fn>;
  fetchMock: ReturnType<typeof vi.fn>;
}

/** Mounts the panel with a fetch that answers the search and lets a test
 *  override the reschedule call. */
function renderPanel(options?: {
  rows?: DatedAlertRow[];
  searchStatus?: number;
  searchBody?: unknown;
  reschedule?: () => Response;
}): Harness {
  const onToast = vi.fn();
  const onRescheduled = vi.fn();
  const onUnauthorized = vi.fn();

  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("/api/admin/alerts/search")) {
      if (options?.searchBody !== undefined || options?.searchStatus) {
        return jsonResponse(options?.searchBody ?? {}, options?.searchStatus ?? 200);
      }
      const params = new URL(url, "http://localhost").searchParams;
      return jsonResponse(
        searchResult(options?.rows ?? DEFAULT_ROWS, params.get("from")!, params.get("to")!)
      );
    }
    if (url.startsWith("/api/admin/alerts/reschedule")) {
      return options?.reschedule
        ? options.reschedule()
        : jsonResponse({ movedCount: 0, unchangedCount: 0, refusedCount: 0, results: [] });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  render(
    <AlertDateSearchPanel
      onToast={onToast}
      onRescheduled={onRescheduled}
      onUnauthorized={onUnauthorized}
      today={TODAY}
    />
  );
  return { onToast, onRescheduled, onUnauthorized, fetchMock };
}

/** Runs the default single-day search (the panel opens on today) and waits for
 *  the results to land. */
async function search() {
  fireEvent.click(screen.getByRole("button", { name: "ค้นหา" }));
  await screen.findByRole("table");
}

function searchUrls(fetchMock: Harness["fetchMock"]): string[] {
  return fetchMock.mock.calls
    .map((call) => String(call[0]))
    .filter((url) => url.startsWith("/api/admin/alerts/search"));
}

function rescheduleBody(fetchMock: Harness["fetchMock"]): Record<string, unknown> {
  const call = fetchMock.mock.calls.find((c) =>
    String(c[0]).startsWith("/api/admin/alerts/reschedule")
  );
  return JSON.parse(String((call![1] as RequestInit).body));
}

/**
 * This test environment has NO `window.localStorage` at all (jsdom here does
 * not provide one), which is the very condition the panel has to survive. Each
 * test therefore installs a fake one, and the tests that care about a failed
 * read either remove it again or make it throw.
 */
function installStorage(): Storage {
  const map = new Map<string, string>();
  const store = {
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => void map.set(key, String(value)),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
  } as unknown as Storage;
  Object.defineProperty(window, "localStorage", {
    value: store,
    configurable: true,
    writable: true,
  });
  return store;
}

function removeStorage() {
  Object.defineProperty(window, "localStorage", { value: undefined, configurable: true });
}

let storage: Storage;

beforeEach(() => {
  storage = installStorage();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  removeStorage();
});

// ── The date control ────────────────────────────────────────────────────────

describe("AlertDateSearchPanel — วันเดียว vs ช่วงวัน", () => {
  it("searches a single day as from === to, and says which mode it is in", async () => {
    const { fetchMock } = renderPanel();

    // The mode is legible before anything is searched: one date field, a
    // pressed toggle, and a caption naming the day.
    expect(screen.getByRole("button", { name: "📅 วันเดียว" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.queryByPlaceholderText("วันที่สิ้นสุด")).toBeNull();

    await search();

    expect(searchUrls(fetchMock)).toEqual([
      `/api/admin/alerts/search?from=${TODAY}&to=${TODAY}`,
    ]);
    expect(screen.getByText(/ผลการค้นหาวันที่ 12 Jun 2026/)).toBeInTheDocument();
  });

  it("shows a second date field in range mode, so a range never looks like a day", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "🗓️ ช่วงวัน" }));

    expect(screen.getByRole("button", { name: "🗓️ ช่วงวัน" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByPlaceholderText("วันที่สิ้นสุด")).toBeInTheDocument();
    expect(screen.getByText(/ค้นหาเป็นช่วงวัน/)).toBeInTheDocument();
    // Switching modes must never leave "ถึง" empty behind a range label.
    expect(screen.getByText(/12 Jun 2026 ถึง 12 Jun 2026/)).toBeInTheDocument();
  });

  it("reaches into the PAST, which the automatic feed cannot", async () => {
    const { fetchMock } = renderPanel({ rows: [] });

    fireEvent.click(screen.getByRole("button", { name: "30 วันที่ผ่านมา" }));

    await waitFor(() =>
      expect(searchUrls(fetchMock)).toEqual([
        "/api/admin/alerts/search?from=2026-05-13&to=2026-06-12",
      ])
    );
    expect(screen.getByText(/ผลการค้นหาช่วง 13 May 2026 – 12 Jun 2026/)).toBeInTheDocument();
  });

  it("reaches into the future with the same control", async () => {
    const { fetchMock } = renderPanel({ rows: [] });
    fireEvent.click(screen.getByRole("button", { name: "7 วันข้างหน้า" }));
    await waitFor(() =>
      expect(searchUrls(fetchMock)).toEqual([
        "/api/admin/alerts/search?from=2026-06-12&to=2026-06-19",
      ])
    );
  });

  it("refuses an inverted range with the shared validator and issues NO request", async () => {
    const { fetchMock } = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "🗓️ ช่วงวัน" }));
    fireEvent.change(screen.getByPlaceholderText("วันที่สิ้นสุด"), {
      target: { value: "2026-06-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "ค้นหา" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("ช่วงวันที่กลับหัว");
    expect(searchUrls(fetchMock)).toEqual([]);
  });
});

// ── Table / cards ───────────────────────────────────────────────────────────

describe("AlertDateSearchPanel — ตาราง vs การ์ด", () => {
  it("opens as a table before any preference exists", async () => {
    renderPanel();
    await search();

    expect(screen.getByRole("button", { name: "📋 ตาราง" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("remembers cards once he switches, and does not re-impose the table", async () => {
    const first = renderPanel();
    await search();

    fireEvent.click(screen.getByRole("button", { name: "🗂️ การ์ด" }));
    expect(screen.queryByRole("table")).toBeNull();
    expect(storage.getItem(ALERT_SEARCH_VIEW_STORAGE_KEY)).toBe("cards");

    // A later search — in a freshly mounted panel, i.e. a new visit — opens in
    // the view he chose, not back in the table.
    cleanup();
    vi.unstubAllGlobals();
    const second = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "ค้นหา" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "🗂️ การ์ด" })).toHaveAttribute(
        "aria-pressed",
        "true"
      )
    );
    expect(screen.queryByRole("table")).toBeNull();
    expect(searchUrls(second.fetchMock)).toHaveLength(1);
    expect(first.fetchMock).not.toBe(second.fetchMock);
  });

  it("a SECOND search in the same mounted panel stays on cards", async () => {
    // The page keeps this panel MOUNTED (it collapses with a `hidden` class, it
    // does not unmount), so this — not a remount — is the flow that actually
    // happens: search, switch to cards, search again. Re-imposing the table
    // here would undo his choice on every single search, which is the exact
    // failure the "table default vs remember my choice" resolution exists to
    // avoid.
    const { fetchMock } = renderPanel();
    await search();
    fireEvent.click(screen.getByRole("button", { name: "🗂️ การ์ด" }));
    expect(screen.queryByRole("table")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "ค้นหา" }));
    await waitFor(() => expect(searchUrls(fetchMock)).toHaveLength(2));

    expect(screen.getByRole("button", { name: "🗂️ การ์ด" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("falls back to the table when the read THROWS", async () => {
    // A browser configured to block site data throws on access rather than
    // returning null. The panel must render, not crash, and land on the
    // default view.
    vi.spyOn(storage, "getItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    expect(readStoredSearchView()).toBe("table");

    renderPanel();
    await search();
    expect(screen.getByRole("button", { name: "📋 ตาราง" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  it("falls back to the table when there is no storage object at all", async () => {
    removeStorage();
    expect(readStoredSearchView()).toBe("table");

    renderPanel();
    await search();
    expect(screen.getByRole("button", { name: "📋 ตาราง" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    // And switching still works for the session, unremembered.
    fireEvent.click(screen.getByRole("button", { name: "🗂️ การ์ด" }));
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("never lets a failed WRITE break the toggle", async () => {
    vi.spyOn(storage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    renderPanel();
    await search();

    fireEvent.click(screen.getByRole("button", { name: "🗂️ การ์ด" }));
    expect(screen.getByRole("button", { name: "🗂️ การ์ด" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });
});

// ── Ticking ─────────────────────────────────────────────────────────────────

describe("AlertDateSearchPanel — ช่องติ๊ก และเหตุผลที่ติ๊กไม่ได้", () => {
  it("disables the box for a row whose date is a fact, and SHOWS the reason", async () => {
    renderPanel();
    await search();

    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(5);
    expect(boxes.filter((box) => (box as HTMLInputElement).disabled)).toHaveLength(3);

    // Visible text, not a `title` tooltip: half the people who use this screen
    // use it on a phone and cannot hover anything.
    expect(
      screen.getByText(/วันหมดประกันเป็นข้อเท็จจริงของเครื่อง/)
    ).toBeInTheDocument();
    expect(screen.getByText(/วันครบกำหนดชำระคือเงื่อนไขเครดิต/)).toBeInTheDocument();
    expect(screen.getByText(/นัดนี้ปิดงานไปแล้ว/)).toBeInTheDocument();
    for (const box of boxes) expect(box).not.toHaveAttribute("title");
  });

  it("เลือกทั้งหมด skips the rows the server would refuse", async () => {
    renderPanel();
    await search();

    fireEvent.click(screen.getByRole("button", { name: "☑️ เลือกทั้งหมด" }));

    const checked = screen
      .getAllByRole("checkbox")
      .filter((box) => (box as HTMLInputElement).checked);
    expect(checked).toHaveLength(2);
    expect(screen.getByText("เลือกไว้ 2 รายการ")).toBeInTheDocument();
    // And it says so before it does it, immovable rows counted out loud.
    expect(screen.getByText(/อีก 3 รายการเลื่อนวันไม่ได้ จึงข้ามให้/)).toBeInTheDocument();
  });

  it("shows no bulk bar until something is ticked", async () => {
    renderPanel();
    await search();
    expect(screen.queryByText(/^เลือกไว้/)).toBeNull();

    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(screen.getByText("เลือกไว้ 1 รายการ")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ตั้งเป็นวันที่เดียวกัน" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "เลื่อน ±N วัน" })).toBeInTheDocument();
  });
});

// ── The move ────────────────────────────────────────────────────────────────

describe("AlertDateSearchPanel — เลื่อนวันหลายรายการพร้อมกัน", () => {
  it("confirms with the real before → after before writing anything", async () => {
    const { fetchMock } = renderPanel();
    await search();

    fireEvent.click(screen.getByRole("button", { name: "☑️ เลือกทั้งหมด" }));
    fireEvent.click(screen.getByRole("button", { name: "เลื่อน ±N วัน" }));
    fireEvent.click(screen.getByRole("button", { name: "ตรวจสอบและเลื่อนวัน" }));

    const dialogText = screen.getByText(/กำลังจะเลื่อนวันของ 2 รายการ/).textContent!;
    expect(dialogText).toContain("+7 วัน");
    expect(dialogText).toContain("12 Jun 2026 → 19 Jun 2026");
    expect(dialogText).toContain("14 Jun 2026 → 21 Jun 2026");
    // Nothing has been written at the point the dialog is on screen.
    expect(
      fetchMock.mock.calls.filter((c) => String(c[0]).includes("/reschedule"))
    ).toHaveLength(0);
  });

  it("a row ticked under one filter is still DISCLOSED after the filter changes", async () => {
    // The most damaging shape this screen can take: rows ticked, then the
    // category filter narrowed so those rows scroll off screen, then "เลื่อนวัน"
    // pressed. The selection survives a filter change on purpose (that is what
    // makes cross-category moves possible at all), so the confirm dialog is the
    // only thing standing between the admin and a write he cannot see. It must
    // name EVERY selected row, not just the visible ones.
    const { fetchMock } = renderPanel();
    await search();

    // Tick the appointment and the task — two different categories.
    fireEvent.click(screen.getByRole("button", { name: "☑️ เลือกทั้งหมด" }));
    expect(screen.getByText("เลือกไว้ 2 รายการ")).toBeInTheDocument();

    // Narrow the filter to กำหนดการ, which hides the task from the table.
    fireEvent.click(screen.getByRole("button", { name: /ทุกหมวด/ }));
    fireEvent.click(screen.getByRole("button", { name: /กำหนดการ/ }));
    // Header + the two กำหนดการ rows; the task is gone from the table.
    await waitFor(() =>
      expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(3)
    );
    expect(screen.queryByText("โทรหาเจ้านี้")).toBeNull();
    // The hidden task is STILL counted, out loud, before anything is written.
    expect(screen.getByText("เลือกไว้ 2 รายการ")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "เลื่อน ±N วัน" }));
    fireEvent.click(screen.getByRole("button", { name: "ตรวจสอบและเลื่อนวัน" }));

    const dialogText = screen.getByText(/กำลังจะเลื่อนวันของ 2 รายการ/).textContent!;
    // The breakdown names both categories, and the preview shows the
    // off-screen task's own before → after.
    expect(dialogText).toContain("กำหนดการ 1");
    expect(dialogText).toContain("สิ่งที่ต้องทำ 1");
    expect(dialogText).toContain("14 Jun 2026 → 21 Jun 2026");
    expect(
      fetchMock.mock.calls.filter((c) => String(c[0]).includes("/reschedule"))
    ).toHaveLength(0);
  });

  it("posts mode/shiftDays and every item with the date the SCREEN saw", async () => {
    const { fetchMock, onRescheduled, onToast } = renderPanel({
      reschedule: () =>
        jsonResponse({
          movedCount: 2,
          unchangedCount: 0,
          refusedCount: 0,
          results: [
            { kind: "schedule", id: "s1", status: "moved", fromDate: TODAY, toDate: "2026-06-19", code: null, reason: "" },
            { kind: "task", id: "t1", status: "moved", fromDate: "2026-06-14", toDate: "2026-06-21", code: null, reason: "" },
          ],
        }),
    });
    await search();

    fireEvent.click(screen.getByRole("button", { name: "☑️ เลือกทั้งหมด" }));
    fireEvent.click(screen.getByRole("button", { name: "เลื่อน ±N วัน" }));
    fireEvent.click(screen.getByRole("button", { name: "ตรวจสอบและเลื่อนวัน" }));
    fireEvent.click(screen.getByRole("button", { name: "เลื่อนวัน 2 รายการ" }));

    await waitFor(() => expect(onRescheduled).toHaveBeenCalledTimes(1));

    expect(rescheduleBody(fetchMock)).toEqual({
      mode: "shift",
      shiftDays: 7,
      items: [
        { kind: "schedule", id: "s1", expectedDate: TODAY },
        { kind: "task", id: "t1", expectedDate: "2026-06-14" },
      ],
    });
    expect(onToast).toHaveBeenCalledWith(
      expect.stringContaining("เลื่อนวันสำเร็จ 2 รายการ"),
      "success"
    );
    // The truth about those dates now lives in the database, so the panel
    // re-reads rather than patching its own rows.
    expect(searchUrls(fetchMock)).toHaveLength(2);
  });

  it("posts a single target date in ตั้งเป็นวันที่เดียวกัน mode", async () => {
    const { fetchMock } = renderPanel({
      reschedule: () =>
        jsonResponse({
          movedCount: 1,
          unchangedCount: 0,
          refusedCount: 0,
          results: [
            { kind: "schedule", id: "s1", status: "moved", fromDate: TODAY, toDate: "2026-07-01", code: null, reason: "" },
          ],
        }),
    });
    await search();

    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    fireEvent.change(screen.getByPlaceholderText("เลือกวันที่ปลายทาง"), {
      target: { value: "2026-07-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "ตรวจสอบและเลื่อนวัน" }));
    expect(
      screen.getByText(/กำลังจะตั้งวันของ 1 รายการ ให้เป็นวันที่ 1 Jul 2026/)
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "เลื่อนวัน 1 รายการ" }));
    await waitFor(() =>
      expect(rescheduleBody(fetchMock)).toEqual({
        mode: "set",
        targetDate: "2026-07-01",
        items: [{ kind: "schedule", id: "s1", expectedDate: TODAY }],
      })
    );
  });

  it("treats an all-unchanged batch as the ordinary outcome it is", async () => {
    const { onToast } = renderPanel({
      reschedule: () =>
        jsonResponse({
          movedCount: 0,
          unchangedCount: 1,
          refusedCount: 0,
          results: [
            { kind: "schedule", id: "s1", status: "unchanged", fromDate: TODAY, toDate: TODAY, code: null, reason: "วันเดิมตรงกับวันปลายทางอยู่แล้ว" },
          ],
        }),
    });
    await search();

    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    fireEvent.change(screen.getByPlaceholderText("เลือกวันที่ปลายทาง"), {
      target: { value: TODAY },
    });
    fireEvent.click(screen.getByRole("button", { name: "ตรวจสอบและเลื่อนวัน" }));
    fireEvent.click(screen.getByRole("button", { name: "เลื่อนวัน 1 รายการ" }));

    // Nothing failed, so nothing is painted red.
    await waitFor(() =>
      expect(onToast).toHaveBeenCalledWith(
        expect.stringContaining("อยู่วันนั้นอยู่แล้ว"),
        "success"
      )
    );
  });

  it("caps เลือกทั้งหมด at the per-request limit and says how many are left", async () => {
    const many = Array.from({ length: 205 }, (_, index) =>
      row({ kind: "task", id: `t${index}`, title: `งานที่ ${index}` })
    );
    const { onToast } = renderPanel({ rows: many });
    await search();

    fireEvent.click(screen.getByRole("button", { name: "☑️ เลือกทั้งหมด" }));

    expect(screen.getByText("เลือกไว้ 200 รายการ")).toBeInTheDocument();
    // The overflow is ANNOUNCED, never silently trimmed.
    expect(onToast).toHaveBeenCalledWith(expect.stringContaining("ยังเหลืออีก 5 รายการ"), "error");
  });

  it("will not open the dialog without a target date", async () => {
    const { onToast, fetchMock } = renderPanel();
    await search();

    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    fireEvent.click(screen.getByRole("button", { name: "ตรวจสอบและเลื่อนวัน" }));

    expect(onToast).toHaveBeenCalledWith("กรุณาเลือกวันที่ปลายทางก่อน", "error");
    expect(screen.queryByText(/กำลังจะตั้งวันของ/)).toBeNull();
    expect(
      fetchMock.mock.calls.filter((c) => String(c[0]).includes("/reschedule"))
    ).toHaveLength(0);
  });

  it("rejects a 0-day shift with the shared validator's own words", async () => {
    const { onToast } = renderPanel();
    await search();

    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    fireEvent.click(screen.getByRole("button", { name: "เลื่อน ±N วัน" }));
    fireEvent.change(screen.getByLabelText(/เลื่อนกี่วัน/), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "ตรวจสอบและเลื่อนวัน" }));

    expect(onToast).toHaveBeenCalledWith(
      expect.stringContaining("ต้องไม่เป็น 0"),
      "error"
    );
  });

  it("renders WHICH row was refused and WHY when the route answers 400", async () => {
    // The all-refused case comes back as a 400 carrying the SAME body shape.
    // It has to show reasons — a generic "ผิดพลาด" would leave the admin with
    // no idea what to fix.
    const { onToast, onRescheduled } = renderPanel({
      reschedule: () =>
        jsonResponse(
          {
            movedCount: 0,
            unchangedCount: 0,
            refusedCount: 2,
            results: [
              {
                kind: "schedule",
                id: "s1",
                status: "refused",
                fromDate: "2026-06-20",
                toDate: null,
                code: "stale",
                reason: "วันที่บนหน้าจอไม่ตรงกับวันที่ในระบบ กรุณาค้นหาใหม่",
              },
              {
                kind: "task",
                id: "t1",
                status: "refused",
                fromDate: null,
                toDate: null,
                code: "not_found",
                reason: "ไม่พบรายการนี้แล้ว อาจถูกลบไปก่อนหน้านี้",
              },
            ],
          },
          400
        ),
    });
    await search();

    fireEvent.click(screen.getByRole("button", { name: "☑️ เลือกทั้งหมด" }));
    fireEvent.click(screen.getByRole("button", { name: "เลื่อน ±N วัน" }));
    fireEvent.click(screen.getByRole("button", { name: "ตรวจสอบและเลื่อนวัน" }));
    fireEvent.click(screen.getByRole("button", { name: "เลื่อนวัน 2 รายการ" }));

    expect(
      await screen.findByText(/วันที่บนหน้าจอไม่ตรงกับวันที่ในระบบ/)
    ).toBeInTheDocument();
    expect(screen.getByText(/ไม่พบรายการนี้แล้ว/)).toBeInTheDocument();
    // The refused rows are NAMED, not just counted: each reason sits with the
    // appointment it refers to.
    const staleEntry = screen
      .getByText(/วันที่บนหน้าจอไม่ตรงกับวันที่ในระบบ/)
      .closest("li")!;
    expect(staleEntry).toHaveTextContent("นัดเข้าบริการ");
    expect(staleEntry).toHaveTextContent("กำหนดการ");
    expect(onToast).toHaveBeenCalledWith(expect.stringContaining("ทำไม่ได้ 2 รายการ"), "error");
    // Nothing moved, so the feed above is left alone.
    expect(onRescheduled).not.toHaveBeenCalled();
  });

  it("shows a malformed-envelope 400 as its plain Thai error", async () => {
    const { onToast } = renderPanel({
      reschedule: () => jsonResponse({ error: "โหมดการย้ายวันไม่ถูกต้อง" }, 400),
    });
    await search();

    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    fireEvent.click(screen.getByRole("button", { name: "เลื่อน ±N วัน" }));
    fireEvent.click(screen.getByRole("button", { name: "ตรวจสอบและเลื่อนวัน" }));
    fireEvent.click(screen.getByRole("button", { name: "เลื่อนวัน 1 รายการ" }));

    await waitFor(() =>
      expect(onToast).toHaveBeenCalledWith("โหมดการย้ายวันไม่ถูกต้อง", "error")
    );
  });

  it("sends the session to login on a 401 instead of showing an empty result", async () => {
    const { onUnauthorized } = renderPanel({ searchStatus: 401, searchBody: {} });
    fireEvent.click(screen.getByRole("button", { name: "ค้นหา" }));
    await waitFor(() => expect(onUnauthorized).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("table")).toBeNull();
  });
});

// ── Reading the result ──────────────────────────────────────────────────────

describe("AlertDateSearchPanel — reading a result", () => {
  it("sorts by date and flips direction on the header", async () => {
    renderPanel({ rows: [TASK, SCHEDULE] });
    await search();

    const datesOf = () =>
      screen
        .getAllByRole("row")
        .slice(1)
        .map((tr) => within(tr).getAllByRole("cell")[1].textContent!.trim());

    expect(datesOf()[0]).toContain("12 Jun 2026");
    fireEvent.click(screen.getByRole("button", { name: /^วันที่ [▲▼]$/ }));
    expect(datesOf()[0]).toContain("14 Jun 2026");
  });

  it("says how many rows are over the per-category cap", async () => {
    const capped = searchResult([SCHEDULE]);
    capped.schedules.total = 250;
    renderPanel({ searchBody: capped });
    await search();

    expect(screen.getByText(/และอีก 249 รายการในหมวด กำหนดการ/)).toBeInTheDocument();
  });

  it("explains the two categories a date search can never return", async () => {
    renderPanel({ rows: [] });
    fireEvent.click(screen.getByRole("button", { name: "ค้นหา" }));

    expect(await screen.findByText("ไม่มีรายการในวันที่ค้นหา")).toBeInTheDocument();
    expect(
      screen.getByText(/“ข้อมูลไม่ครบ” และ “เอกสารค้าง” ไม่มีวันครบกำหนดของตัวเอง/)
    ).toBeInTheDocument();
  });
});

// ── Out-of-order responses ──────────────────────────────────────────────────
// `applyPreset` deliberately does NOT refuse a click while a search is in
// flight (handleSubmitSearch does) — changing your mind has to work. That makes
// overlapping requests normal, and without a sequence token a slow EARLIER
// response installs its rows over a newer one: the header and both date fields
// read the new range while the table holds the old one, and a row ticked from
// that table is then submitted against a range the screen says it is not
// showing.

describe("AlertDateSearchPanel — a slow earlier search cannot overwrite a newer one", () => {
  const FUTURE_ROW = row({
    kind: "schedule",
    id: "future-1",
    title: "แถวจากช่วงอนาคต",
    matchedDate: "2026-06-19",
  });
  const PAST_ROW = row({
    kind: "schedule",
    id: "past-1",
    title: "แถวจากช่วงที่ผ่านมา",
    matchedDate: "2026-05-20",
  });

  /** Mounts the panel with a fetch that hands back a resolver per search
   *  instead of answering, so a test can land the responses in any order. */
  function renderDeferredPanel() {
    const pending: { url: string; settle: (r: Response) => void; fail: (e: Error) => void }[] = [];
    const onToast = vi.fn();

    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      return new Promise<Response>((resolve, reject) => {
        pending.push({ url, settle: resolve, fail: reject });
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AlertDateSearchPanel
        onToast={onToast}
        onRescheduled={vi.fn()}
        onUnauthorized={vi.fn()}
        today={TODAY}
      />
    );
    return { pending, onToast };
  }

  const answer = (
    req: { url: string; settle: (r: Response) => void },
    rows: DatedAlertRow[]
  ) => {
    const params = new URL(req.url, "http://localhost").searchParams;
    req.settle(jsonResponse(searchResult(rows, params.get("from")!, params.get("to")!)));
  };

  it("keeps the NEWER preset's rows when the older request resolves last", async () => {
    const { pending } = renderDeferredPanel();

    fireEvent.click(screen.getByRole("button", { name: "7 วันข้างหน้า" }));
    fireEvent.click(screen.getByRole("button", { name: "30 วันที่ผ่านมา" }));
    expect(pending).toHaveLength(2);
    expect(pending[0].url).toContain(`from=${TODAY}`);
    expect(pending[1].url).toContain("to=2026-06-12");

    // The newer search lands first...
    answer(pending[1], [PAST_ROW]);
    expect(await screen.findByText("แถวจากช่วงที่ผ่านมา")).toBeInTheDocument();

    // ...and then the abandoned +7-day request finally answers.
    answer(pending[0], [FUTURE_ROW]);

    await waitFor(() =>
      expect(screen.getByText("แถวจากช่วงที่ผ่านมา")).toBeInTheDocument()
    );
    // The assertion that bites: before the sequence token these rows replaced
    // the ones above, under a header still describing the past-30-day range.
    expect(screen.queryByText("แถวจากช่วงอนาคต")).not.toBeInTheDocument();
  });

  it("does not let an abandoned request's FAILURE cover the newer result", async () => {
    const { pending, onToast } = renderDeferredPanel();

    fireEvent.click(screen.getByRole("button", { name: "7 วันข้างหน้า" }));
    fireEvent.click(screen.getByRole("button", { name: "30 วันที่ผ่านมา" }));

    answer(pending[1], [PAST_ROW]);
    expect(await screen.findByText("แถวจากช่วงที่ผ่านมา")).toBeInTheDocument();

    pending[0].fail(new Error("เครือข่ายขัดข้อง"));

    await waitFor(() =>
      expect(screen.getByText("แถวจากช่วงที่ผ่านมา")).toBeInTheDocument()
    );
    expect(onToast).not.toHaveBeenCalled();
  });

  it("does not clear the spinner while the search the admin is waiting for is still in flight", async () => {
    const { pending } = renderDeferredPanel();

    fireEvent.click(screen.getByRole("button", { name: "7 วันข้างหน้า" }));
    fireEvent.click(screen.getByRole("button", { name: "30 วันที่ผ่านมา" }));

    // The abandoned request finishes first; the screen must still look busy.
    answer(pending[0], [FUTURE_ROW]);
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(screen.getByRole("button", { name: /กำลังค้นหา/ })).toBeDisabled();

    answer(pending[1], [PAST_ROW]);
    expect(await screen.findByText("แถวจากช่วงที่ผ่านมา")).toBeInTheDocument();
  });
});
