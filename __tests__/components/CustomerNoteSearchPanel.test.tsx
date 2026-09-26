/**
 * ค้นหา–แทนที่ใน "บันทึกลูกค้า" — the search block on /customers.
 *
 * The network is mocked in every test: this file is about what the SCREEN does
 * with a response, never about SQL (that is `__tests__/lib/noteSearch.test.ts`,
 * `__tests__/lib/customerNoteSearchStore.test.ts` and the route tests).
 *
 * THE FIXTURES ARE BUILT WITH THE REAL MATCHER. `buildMatcher` + `findMatches`
 * from `app/lib/noteSearch.ts` produce the rows these tests feed back in, so
 * the snippets, the offsets and the counts are the ones the server would
 * actually send — a fixture hand-written with guessed offsets would let the
 * highlight drift without a test noticing.
 *
 * The rules worth pinning are the ones a refactor would quietly break:
 *   • pressing ค้นหา issues a GET and NOTHING ELSE — no write, ever;
 *   • a refused pattern (`.*`, an empty term) never leaves the browser;
 *   • a ConfirmDialog showing the REAL before → after stands between every
 *     click and the POST, and cancelling it writes nothing;
 *   • a refused customer is NAMED with its reason, never folded into a count;
 *   • a capped result says how many more matched;
 *   • a note containing `<script>` is TEXT on the screen, not an element;
 *   • the page's own ชื่อลูกค้า/ชื่อบริษัท box still filters exactly as before.
 */

import { render, screen, fireEvent, waitFor, within, cleanup, act, configure } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The replace flow here (confirm → mocked fetch → report) settles within
// ~100 ms alone, but under the full parallel run with coverage (the pre-push
// hook) a starved worker has missed testing-library's 1 s default wait. No
// test in this file waits for something to NOT appear, so a longer ceiling
// costs the passing tests nothing. The test's own limit is raised with it:
// a wait allowed 5 s inside a test limited to vitest's default 5 s just
// trades one timeout for the other.
configure({ asyncUtilTimeout: 5_000 });
vi.setConfig({ testTimeout: 30_000 });
import { useState } from "react";
import CustomerNoteSearchPanel, {
  buildChangeExcerpt,
  replacementNeedsWarning,
} from "@/app/components/CustomerNoteSearchPanel";
import type {
  CustomerNoteSearchResponse,
  CustomerNoteSearchRow,
} from "@/app/components/CustomerNoteSearchPanel";
import { buildMatcher, findMatches } from "@/app/lib/noteSearch";
import Customers from "@/app/customers/page";

// The customers page pulls in tabs and modals that own their own data and
// network; none of them is the subject here.
vi.mock("@/app/context/AuthContext", () => ({
  useAuth: () => ({ isLoggedIn: true, isLoading: false }),
}));
vi.mock("@/app/customers/EquipmentTab", () => ({
  default: () => <div data-testid="equipment-tab" />,
}));
vi.mock("@/app/components/modals/CustomerCallScheduleSection", () => ({
  default: () => <div data-testid="call-schedule" />,
}));
vi.mock("@/app/lib/xlsxExport", () => ({ downloadExcel: vi.fn() }));

// ── Fixtures ────────────────────────────────────────────────────────────────

const TERM = "เวอร์เนีย";

const NOTE_A = "6/9/26 ส่งเวอร์เนีย 2 ตัว ให้ลูกค้าแล้ว";
const NOTE_B = "1/8/26 ลูกค้าถามราคาเวอร์เนีย\n3/8/26 ส่งใบเสนอราคาเวอร์เนียแล้ว";
/** A note that reads as markup. Notes are typed by hand over years; this is the
 *  kind of thing that ends up in one. */
const NOTE_SCRIPTY = "ลูกค้าส่งมาว่า <script>alert(1)</script> เวอร์เนีย ราคาเท่าไร";

/** A row exactly as `searchNotes` builds it — real counts, real snippets, real
 *  highlight offsets, produced by the same two functions the server calls. */
function searchRow(
  customerId: string,
  customerName: string,
  companyName: string,
  note: string,
  options?: { term?: string; matchCase?: boolean; useRegex?: boolean }
): CustomerNoteSearchRow {
  const built = buildMatcher({
    term: options?.term ?? TERM,
    matchCase: options?.matchCase,
    useRegex: options?.useRegex,
  });
  if (!built.ok) throw new Error(`fixture term refused: ${built.reason}`);
  const summary = findMatches(note, built.matcher);
  return {
    customerId,
    customerName,
    companyName,
    note,
    matchCount: summary.count,
    countCapped: summary.countCapped,
    matches: summary.matches,
  };
}

const ROW_A = searchRow("c1", "สมชาย ใจดี", "บริษัท ก จำกัด", NOTE_A);
const ROW_B = searchRow("c2", "สมหญิง รักดี", "บริษัท ข จำกัด", NOTE_B);

function searchResponse(
  rows: CustomerNoteSearchRow[],
  overrides?: Partial<CustomerNoteSearchResponse>
): CustomerNoteSearchResponse {
  return {
    term: TERM,
    matchCase: false,
    useRegex: false,
    rows,
    total: rows.length,
    hidden: 0,
    cap: 100,
    totalMatches: rows.reduce((sum, r) => sum + r.matchCount, 0),
    skippedOversize: 0,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as unknown as Response;
}

// ── Harness ─────────────────────────────────────────────────────────────────

interface Harness {
  onToast: ReturnType<typeof vi.fn>;
  onOpenCustomer: ReturnType<typeof vi.fn>;
  onReplaced: ReturnType<typeof vi.fn>;
  onUnauthorized: ReturnType<typeof vi.fn>;
  fetchMock: ReturnType<typeof vi.fn>;
}

function renderPanel(options?: {
  search?: () => Response;
  replace?: () => Response;
}): Harness {
  const onToast = vi.fn();
  const onOpenCustomer = vi.fn();
  const onReplaced = vi.fn();
  const onUnauthorized = vi.fn();

  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("/api/customers/note-search")) {
      return options?.search
        ? options.search()
        : jsonResponse(searchResponse([ROW_A, ROW_B]));
    }
    if (url.startsWith("/api/customers/note-replace")) {
      return options?.replace
        ? options.replace()
        : jsonResponse({
            replacedCount: 0,
            unchangedCount: 0,
            refusedCount: 0,
            results: [],
          });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  render(
    <CustomerNoteSearchPanel
      onToast={onToast}
      onOpenCustomer={onOpenCustomer}
      onReplaced={onReplaced}
      onUnauthorized={onUnauthorized}
    />
  );
  return { onToast, onOpenCustomer, onReplaced, onUnauthorized, fetchMock };
}

/** Types a term and presses ค้นหา, then waits for the results table. */
async function search(term = TERM) {
  fireEvent.change(screen.getByLabelText("คำที่ต้องการค้นในบันทึกลูกค้า"), {
    target: { value: term },
  });
  fireEvent.submit(screen.getByLabelText("คำที่ต้องการค้นในบันทึกลูกค้า"));
  await screen.findByRole("table");
}

function replaceCalls(fetchMock: Harness["fetchMock"]) {
  return fetchMock.mock.calls.filter((call) =>
    String(call[0]).startsWith("/api/customers/note-replace")
  );
}

function replaceBody(fetchMock: Harness["fetchMock"]): Record<string, unknown> {
  const call = replaceCalls(fetchMock)[0];
  return JSON.parse(String((call![1] as RequestInit).body));
}

/** The shared ConfirmDialog's root. It is the only `z-[100]` overlay on this
 *  screen, so its presence IS "the confirmation is up". */
function dialogEl(): HTMLElement | null {
  return document.querySelector<HTMLElement>('div[class*="z-[100]"]');
}

function dialogText(): string {
  return (dialogEl()?.textContent ?? "").replace(/\s+/g, " ");
}

function normalised(el: HTMLElement): string {
  return (el.textContent ?? "").replace(/\s+/g, " ");
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// ── Searching never writes ──────────────────────────────────────────────────

describe("การค้นหา", () => {
  it("ยิงแค่ GET ไปที่ note-search และไม่มีคำขอเขียนใดๆ", async () => {
    const { fetchMock } = renderPanel();
    await search();

    expect(screen.getByText("สมชาย ใจดี")).toBeInTheDocument();
    expect(screen.getByText("สมหญิง รักดี")).toBeInTheDocument();

    // Every call this screen made — button click and possibly the 200ms auto-
    // search debounce — goes to note-search and nothing else.
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.length).toBeGreaterThanOrEqual(1);
    for (const url of urls) {
      expect(url).toContain("/api/customers/note-search");
    }
    // All are GETs: either no init, or an init with only a signal. No body.
    for (const call of fetchMock.mock.calls) {
      expect(call[1]?.method ?? "GET").toBe("GET");
      expect(call[1]?.body).toBeUndefined();
    }
    expect(replaceCalls(fetchMock)).toHaveLength(0);
  });

  it("ส่งปุ่ม Aa และ .* ไปกับคำขอ และค่าเริ่มต้นคือปิดทั้งคู่", async () => {
    const { fetchMock } = renderPanel({
      search: () => jsonResponse(searchResponse([ROW_A], { matchCase: true })),
    });

    fireEvent.change(screen.getByLabelText("คำที่ต้องการค้นในบันทึกลูกค้า"), {
      target: { value: "Company" },
    });
    fireEvent.submit(screen.getByLabelText("คำที่ต้องการค้นในบันทึกลูกค้า"));
    await screen.findByRole("table");
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("matchCase");
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("useRegex");
  });



  it("คำค้นว่างถูกปฏิเสธในเบราว์เซอร์ ไม่ยิงคำขอ และไม่แสดงผลว่าง “ไม่พบ”", () => {
    const { fetchMock } = renderPanel();
    fireEvent.submit(screen.getByLabelText("คำที่ต้องการค้นในบันทึกลูกค้า"));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("กรุณาพิมพ์คำที่ต้องการค้นหาก่อน");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText(/ไม่พบคำว่า/)).not.toBeInTheDocument();
  });

});

// ── The results table ───────────────────────────────────────────────────────

describe("ตารางผลการค้นหา", () => {
  it("มีคอลัมน์ชื่อ · บริษัท · จำนวนที่เจอ · ข้อความรอบๆ และทางเข้าไปดูลูกค้า", async () => {
    const { onOpenCustomer } = renderPanel();
    await search();

    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual([
      "ชื่อลูกค้า",
      "บริษัท",
      "จำนวนที่เจอ",
      "ข้อความรอบๆ คำที่เจอ",
      "จัดการ",
    ]);

    const rowB = screen.getAllByRole("row")[2];
    expect(normalised(rowB)).toContain("บริษัท ข จำกัด");
    // NOTE_B holds the term twice, and the row says so rather than showing one
    // snippet and letting it read as the whole story.
    expect(normalised(rowB)).toContain("2 ครั้ง");
    expect(normalised(rowB)).toContain("ส่งใบเสนอราคา");

    fireEvent.click(within(rowB).getByRole("button", { name: "เปิดดูลูกค้า" }));
    expect(onOpenCustomer).toHaveBeenCalledWith("c2");
  });

  it("ไฮไลต์คำที่เจอโดยตัดสตริงเป็นส่วนๆ ไม่ใช่ฝัง HTML", async () => {
    renderPanel();
    await search();

    const marks = screen.getAllByText(TERM, { selector: "mark" });
    expect(marks.length).toBeGreaterThan(0);
    for (const mark of marks) expect(mark.textContent).toBe(TERM);
  });

  it("บันทึกที่มี <script> แสดงเป็นตัวหนังสือ ไม่กลายเป็นแท็ก", async () => {
    const scripty = searchRow("c9", "ลูกค้าเจ้าปัญหา", "บริษัท ค จำกัด", NOTE_SCRIPTY);
    renderPanel({ search: () => jsonResponse(searchResponse([scripty])) });
    await search();

    // Visible as characters …
    expect(normalised(screen.getByRole("table"))).toContain("<script>alert(1)</script>");
    // … and never as an element. React escaped it; nothing here uses
    // dangerouslySetInnerHTML.
    expect(document.querySelectorAll("script")).toHaveLength(0);
    expect(screen.getByRole("table").querySelector("script")).toBeNull();
  });

  it("เมื่อชนเพดานแถว บอกว่ายังเหลืออีกกี่ราย ไม่ตัดทิ้งเงียบๆ", async () => {
    renderPanel({
      search: () =>
        jsonResponse(
          searchResponse([ROW_A, ROW_B], { total: 42, hidden: 40, cap: 2, totalMatches: 60 })
        ),
    });
    await search();

    const panel = screen.getByLabelText("ค้นหาคำในบันทึกลูกค้า");
    expect(normalised(panel)).toContain("ยังมีอีก 40 ราย ที่ไม่ได้แสดง");
    // And it says plainly that "แทนที่ทั้งหมด" only covers what is on screen.
    expect(normalised(panel)).toContain("จะแก้เฉพาะ 2 รายที่เห็นบนจอนี้");
  });

  it("บันทึกที่ยาวเกินจนค้นไม่ได้ถูกรายงาน ไม่ถูกนับเป็น “ไม่เจอ”", async () => {
    renderPanel({
      search: () => jsonResponse(searchResponse([ROW_A], { skippedOversize: 3 })),
    });
    await search();
    expect(normalised(screen.getByLabelText("ค้นหาคำในบันทึกลูกค้า"))).toContain(
      "มีบันทึกของ 3 ราย ที่ยาวเกินกว่าจะค้นได้อย่างปลอดภัย"
    );
  });
});

// ── Nothing is written without the dialog ───────────────────────────────────

describe("การแทนที่ต้องผ่านหน้ายืนยันเสมอ", () => {
  it("กดแทนที่ทั้งหมดแล้วยังไม่มี POST — มีแต่หน้ายืนยันที่แสดงของเดิม → ของใหม่ ของจริง", async () => {
    const { fetchMock } = renderPanel();
    await search();

    fireEvent.change(screen.getByLabelText("แทนที่ด้วย"), {
      target: { value: "เวอร์เนียดิจิตอล" },
    });
    fireEvent.click(screen.getByRole("button", { name: "แทนที่ทั้งหมด (2 ราย)" }));

    // The dialog is up and NOTHING has been written.
    expect(dialogEl()).not.toBeNull();
    expect(replaceCalls(fetchMock)).toHaveLength(0);

    const text = dialogText();
    expect(text).toContain("กำลังจะแก้ “บันทึกลูกค้า” ของ 2 ราย รวม 3 จุด");
    expect(text).toContain("สมชาย ใจดี");
    // REAL text, both sides — computed with `applyReplace`, the same function
    // the store runs inside the transaction.
    expect(text).toContain("เดิม: 6/9/26 ส่งเวอร์เนีย 2 ตัว ให้ลูกค้าแล้ว");
    expect(text).toContain("ใหม่: 6/9/26 ส่งเวอร์เนียดิจิตอล 2 ตัว ให้ลูกค้าแล้ว");
    expect(text).toContain("บันทึกการติดต่อจริงของลูกค้า");
  });

  it("ยกเลิกแล้วไม่มีอะไรถูกเขียนเลย", async () => {
    const { fetchMock, onReplaced } = renderPanel();
    await search();
    fireEvent.click(screen.getByRole("button", { name: "แทนที่ทั้งหมด (2 ราย)" }));
    expect(dialogEl()).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "ยกเลิก" }));

    expect(dialogEl()).toBeNull();
    expect(replaceCalls(fetchMock)).toHaveLength(0);
    expect(onReplaced).not.toHaveBeenCalled();
  });

  it("ยืนยันแล้วจึงส่ง POST พร้อม expectedNote ของทุกราย", async () => {
    const { fetchMock, onReplaced } = renderPanel({
      replace: () =>
        jsonResponse({
          replacedCount: 2,
          unchangedCount: 0,
          refusedCount: 0,
          results: [
            {
              customerId: "c1",
              customerName: "สมชาย ใจดี",
              status: "replaced",
              matchCount: 1,
              resultLength: 40,
              code: null,
              reason: "",
            },
            {
              customerId: "c2",
              customerName: "สมหญิง รักดี",
              status: "replaced",
              matchCount: 2,
              resultLength: 70,
              code: null,
              reason: "",
            },
          ],
        }),
    });
    await search();
    fireEvent.change(screen.getByLabelText("แทนที่ด้วย"), {
      target: { value: "เวอร์เนียดิจิตอล" },
    });
    fireEvent.click(screen.getByRole("button", { name: "แทนที่ทั้งหมด (2 ราย)" }));
    fireEvent.click(screen.getByRole("button", { name: "แทนที่ 2 ราย" }));

    await waitFor(() => expect(replaceCalls(fetchMock)).toHaveLength(1));
    const body = replaceBody(fetchMock);
    expect(body.term).toBe(TERM);
    expect(body.replacement).toBe("เวอร์เนียดิจิตอล");
    expect(body.items).toEqual([
      { customerId: "c1", expectedNote: NOTE_A },
      { customerId: "c2", expectedNote: NOTE_B },
    ]);
    expect(onReplaced).toHaveBeenCalled();
  });

  it("แทนที่รายคนส่งไปแค่รายนั้น", async () => {
    const { fetchMock } = renderPanel();
    await search();

    const rowB = screen.getAllByRole("row")[2];
    fireEvent.click(within(rowB).getByRole("button", { name: "แทนที่รายนี้" }));
    expect(dialogText()).toContain("ของ 1 ราย");
    fireEvent.click(screen.getByRole("button", { name: "แทนที่ 1 ราย" }));

    await waitFor(() => expect(replaceCalls(fetchMock)).toHaveLength(1));
    expect(replaceBody(fetchMock).items).toEqual([
      { customerId: "c2", expectedNote: NOTE_B },
    ]);
  });

  it("คำแทนที่ว่างบอกชัดว่าเป็นการลบคำ ไม่ใช่การแทนที่", async () => {
    renderPanel();
    await search();
    fireEvent.click(screen.getByRole("button", { name: "แทนที่ทั้งหมด (2 ราย)" }));
    const text = dialogText();
    expect(text).toContain("นี่คือการ ลบ คำค้นออกจากบันทึก");
    expect(text).toContain("เดิม: 6/9/26 ส่งเวอร์เนีย 2 ตัว ให้ลูกค้าแล้ว");
    expect(text).toContain("ใหม่: 6/9/26 ส่ง 2 ตัว ให้ลูกค้าแล้ว");
  });
});

// ── The report ──────────────────────────────────────────────────────────────

describe("รายงานผลการแทนที่", () => {
  it("รายที่ถูกปฏิเสธถูกเรียกชื่อพร้อมเหตุผล ไม่ถูกรวบเป็นตัวเลข", async () => {
    const TOO_LONG =
      "บันทึกใหม่จะยาว 2040 ตัวอักษร เกินเพดาน 2000 ตัวอักษรที่ระบบเก็บได้ กรุณาใช้คำแทนที่ที่สั้นลง";
    const STALE = "บันทึกของลูกค้ารายนี้ถูกแก้ไขไปแล้วหลังจากที่หน้าจอค้นหามา ระบบจึงไม่เขียนทับให้";
    const { fetchMock, onReplaced } = renderPanel({
      replace: () =>
        jsonResponse(
          {
            replacedCount: 0,
            unchangedCount: 0,
            refusedCount: 2,
            results: [
              {
                customerId: "c1",
                customerName: "สมชาย ใจดี",
                status: "refused",
                matchCount: 1,
                resultLength: 0,
                code: "too_long",
                reason: TOO_LONG,
              },
              {
                customerId: "c2",
                customerName: "สมหญิง รักดี",
                status: "refused",
                matchCount: 2,
                resultLength: 0,
                code: "stale",
                reason: STALE,
              },
            ],
          },
          // The route answers 400 when EVERY customer was refused. The reasons
          // still have to appear — this must not fall through to a generic
          // "ไม่สำเร็จ" toast with nothing on screen.
          400
        ),
    });
    await search();
    fireEvent.click(screen.getByRole("button", { name: "แทนที่ทั้งหมด (2 ราย)" }));
    fireEvent.click(screen.getByRole("button", { name: "แทนที่ 2 ราย" }));

    await waitFor(() => expect(screen.getByText("ผลการแทนที่")).toBeInTheDocument());
    expect(replaceCalls(fetchMock)).toHaveLength(1);

    const report = screen.getByText("ผลการแทนที่").parentElement as HTMLElement;
    expect(normalised(report)).toContain("สมชาย ใจดี");
    expect(normalised(report)).toContain(TOO_LONG);
    expect(normalised(report)).toContain("สมหญิง รักดี");
    expect(normalised(report)).toContain(STALE);
    // Nothing was written, so the list is not re-read.
    expect(onReplaced).not.toHaveBeenCalled();
  });

  it("สำเร็จบางส่วนก็ยังบอกชื่อรายที่ทำไม่ได้", async () => {
    const REASON = "ไม่พบลูกค้ารายนี้แล้ว อาจถูกลบไปหลังจากที่หน้าจอค้นหาครั้งล่าสุด";
    renderPanel({
      replace: () =>
        jsonResponse({
          replacedCount: 1,
          unchangedCount: 0,
          refusedCount: 1,
          results: [
            {
              customerId: "c1",
              customerName: "สมชาย ใจดี",
              status: "replaced",
              matchCount: 1,
              resultLength: 40,
              code: null,
              reason: "",
            },
            {
              customerId: "c2",
              customerName: "สมหญิง รักดี",
              status: "refused",
              matchCount: 0,
              resultLength: 0,
              code: "not_found",
              reason: REASON,
            },
          ],
        }),
    });
    await search();
    fireEvent.click(screen.getByRole("button", { name: "แทนที่ทั้งหมด (2 ราย)" }));
    fireEvent.click(screen.getByRole("button", { name: "แทนที่ 2 ราย" }));

    await waitFor(() => expect(screen.getByText("ผลการแทนที่")).toBeInTheDocument());
    const report = screen.getByText("ผลการแทนที่").parentElement as HTMLElement;
    expect(normalised(report)).toContain("แทนที่สำเร็จ 1 ราย");
    expect(normalised(report)).toContain("สมหญิง รักดี");
    expect(normalised(report)).toContain(REASON);
  });
});

// ── The excerpt helper ──────────────────────────────────────────────────────

describe("buildChangeExcerpt", () => {
  it("คืน null เมื่อไม่มีอะไรเปลี่ยน", () => {
    expect(buildChangeExcerpt(NOTE_A, NOTE_A)).toBeNull();
  });

  it("ยกมาทั้งบรรทัดที่เปลี่ยน จากสตริงจริงทั้งสองฝั่ง", () => {
    const note = "1/1/26 บรรทัดแรก\n2/1/26 ส่งเวอร์เนีย\n3/1/26 บรรทัดท้าย";
    const next = "1/1/26 บรรทัดแรก\n2/1/26 ส่งไม้บรรทัด\n3/1/26 บรรทัดท้าย";
    const excerpt = buildChangeExcerpt(note, next)!;
    expect(excerpt.before).toBe("…2/1/26 ส่งเวอร์เนีย…");
    expect(excerpt.after).toBe("…2/1/26 ส่งไม้บรรทัด…");
  });
});

// ── The page's own search is untouched ──────────────────────────────────────

describe("หน้ารายชื่อลูกค้า", () => {
  const CUSTOMERS = [
    {
      id: "c1",
      companyId: "co1",
      companyName: "บริษัท ก จำกัด",
      name: "สมชาย ใจดี",
      department: "ฝ่ายแล็บ",
      phone: "020000001",
      email: "somchai@example.com",
      note: NOTE_A,
    },
    {
      id: "c2",
      companyId: "co2",
      companyName: "บริษัท ข จำกัด",
      name: "สมหญิง รักดี",
      department: "จัดซื้อ",
      phone: "020000002",
      email: "somying@example.com",
      note: NOTE_B,
    },
  ];

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/customers") {
          return { ok: true, status: 200, json: async () => CUSTOMERS };
        }
        return { ok: true, status: 200, json: async () => [] };
      })
    );
  });

  it("ช่องค้นชื่อลูกค้า/ชื่อบริษัทเดิมยังกรองเหมือนเดิมทุกประการ", async () => {
    render(<Customers />);
    await waitFor(() => expect(screen.getByText("สมชาย ใจดี")).toBeInTheDocument());

    const box = screen.getByPlaceholderText("ค้นหาชื่อลูกค้า หรือ ชื่อบริษัท...");

    // By customer name.
    fireEvent.change(box, { target: { value: "สมหญิง" } });
    expect(screen.queryByText("สมชาย ใจดี")).not.toBeInTheDocument();
    expect(screen.getByText("สมหญิง รักดี")).toBeInTheDocument();

    // By company name — the same one box, exactly as before.
    fireEvent.change(box, { target: { value: "บริษัท ก" } });
    expect(screen.getByText("สมชาย ใจดี")).toBeInTheDocument();
    expect(screen.queryByText("สมหญิง รักดี")).not.toBeInTheDocument();

    // Cleared: everybody is back.
    fireEvent.change(box, { target: { value: "" } });
    expect(screen.getByText("สมชาย ใจดี")).toBeInTheDocument();
    expect(screen.getByText("สมหญิง รักดี")).toBeInTheDocument();
  });


});


// ════════════════════════════════════════════════════════════════════════════
// The panel under the props the REAL page passes
//
// `renderPanel` above hands the component four `vi.fn()`s, which are stable for
// the life of the test — and stable props are exactly what hid this bug.
// `app/customers/page.tsx` passes `onToast={showToast}`, a plain function
// re-declared on every render, and `onUnauthorized={() => router.replace(…)}`,
// an inline arrow. Those were in `runSearch`'s dependency list, so ANY parent
// re-render produced a new `runSearch`, which tore down the debounce effect and
// re-fired the search — WITHOUT `keepReport`, and aborting anything in flight.
// ════════════════════════════════════════════════════════════════════════════

/** The prop shapes `app/customers/page.tsx` really uses: nothing memoised, a
 *  toast that re-renders the parent, and an `onReplaced` that kicks off the
 *  customer-list re-read (another parent state change). */
function UnstableParent() {
  const [toast, setToast] = useState<string | null>(null);
  const [listVersion, setListVersion] = useState(0);
  return (
    <div>
      {toast && <p data-testid="page-toast">{toast}</p>}
      <span data-testid="list-version">{listVersion}</span>
      <CustomerNoteSearchPanel
        onToast={(message) => setToast(message)}
        onOpenCustomer={(customerId) => setToast(customerId)}
        onReplaced={() => setListVersion((v) => v + 1)}
        onUnauthorized={() => setToast("unauthorized")}
      />
    </div>
  );
}

/** A batch like the one in the finding: most replaced, a few refused, and the
 *  refusals are named only in the report. */
const PARTIAL_REPORT = {
  replacedCount: 1,
  unchangedCount: 0,
  refusedCount: 1,
  results: [
    {
      customerId: "c1",
      customerName: "สมชาย ใจดี",
      status: "replaced",
      matchCount: 1,
      resultLength: 40,
      code: null,
      reason: "",
    },
    {
      customerId: "c2",
      customerName: "สมหญิง รักดี",
      status: "refused",
      matchCount: 2,
      resultLength: 0,
      code: "stale",
      reason:
        "บันทึกของลูกค้ารายนี้ถูกแก้ไขไปแล้วหลังจากที่หน้าจอค้นหามา ระบบจึงไม่เขียนทับให้",
    },
  ],
};

/** Long enough for the 200ms debounce to fire twice over if anything
 *  re-scheduled it. Real timers: the component's own fetches are promises and
 *  mixing them with a fake clock would prove less than it looks. */
async function letTheDebounceRun(ms = 500) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

describe("หน้าแม่เรนเดอร์ใหม่ ผลการแทนที่ต้องไม่หาย", () => {
  function stubFetch() {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/customers/note-search")) {
        return jsonResponse(searchResponse([ROW_A, ROW_B]));
      }
      if (url.startsWith("/api/customers/note-replace")) {
        return jsonResponse(PARTIAL_REPORT);
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  /** Type, let the debounce search run, replace, confirm. */
  async function replaceEverything() {
    fireEvent.change(screen.getByLabelText("คำที่ต้องการค้นในบันทึกลูกค้า"), {
      target: { value: TERM },
    });
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "แทนที่ทั้งหมด (2 ราย)" }));
    fireEvent.click(screen.getByRole("button", { name: "แทนที่ 2 ราย" }));
    await screen.findByText("ผลการแทนที่");
  }

  it("รายชื่อรายที่ทำไม่ได้ยังอยู่บนจอ หลังโทสต์ทำให้หน้าแม่เรนเดอร์ใหม่", async () => {
    stubFetch();
    render(<UnstableParent />);
    await replaceEverything();

    // The toast fired, so the parent has already re-rendered with brand-new
    // prop identities — and `onReplaced` bumped its list state as well.
    expect(screen.getByTestId("page-toast").textContent).toContain("ทำไม่ได้ 1 ราย");
    expect(screen.getByTestId("list-version").textContent).toBe("1");

    await letTheDebounceRun();

    // THE ASSERTION. Before the fix, a fresh `runSearch` re-fired the debounce
    // effect without `keepReport` about 200ms after the toast, `setReport(null)`
    // ran, and this list — the only place the refused customers are named —
    // vanished, leaving "ทำไม่ได้ 1 ราย" as the last thing the admin was told.
    const report = screen.getByText("ผลการแทนที่").parentElement as HTMLElement;
    expect(normalised(report)).toContain("สมหญิง รักดี");
    expect(normalised(report)).toContain("ถูกแก้ไขไปแล้ว");
    expect(normalised(report)).toContain("แทนที่สำเร็จ 1 ราย");
  });

  it("ไม่ยิงค้นหาซ้ำเพิ่มเพราะหน้าแม่เรนเดอร์ใหม่", async () => {
    const fetchMock = stubFetch();
    render(<UnstableParent />);
    await replaceEverything();
    await letTheDebounceRun();

    const searches = fetchMock.mock.calls.filter((c) =>
      String(c[0]).startsWith("/api/customers/note-search")
    );
    // Exactly two, and both are wanted: the debounce search the admin asked
    // for, and the `keepReport` re-read that refreshes every row's
    // `expectedNote` after a successful write. A third would be the parent's
    // re-render leaking into this component — which is also what aborted a
    // request the admin was still waiting on.
    expect(searches).toHaveLength(2);
    expect(replaceCalls(fetchMock)).toHaveLength(1);
  });

  it("พิมพ์คำใหม่ยังล้างรายงานเดิมตามเดิม", async () => {
    // The fix must not turn into "the report never clears". A report describes
    // the rows of the search that produced it; a NEW search has to drop it, or
    // it reads as a report about whatever is on screen now.
    stubFetch();
    render(<UnstableParent />);
    await replaceEverything();
    await letTheDebounceRun();
    expect(screen.queryByText("ผลการแทนที่")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("คำที่ต้องการค้นในบันทึกลูกค้า"), {
      target: { value: "ใบเสนอราคา" },
    });
    await waitFor(() => expect(screen.queryByText("ผลการแทนที่")).not.toBeInTheDocument());
  });
});

// The replacement goes through sanitizePlainText, which keeps `&`, `<` and `>`
// as typed and only REMOVES a real HTML tag (lib/htmlTags.ts), so only that
// case — or a typed character reference — can make the stored note differ
// from the preview, and only those warn.
const STORED_AS_TYPED = [
  "A&B จำกัด", "5 < 10", "x > y", "a<1", "< ก", "",
  // "<" + a letter that is not a real tag: a model, a size, an unfinished tag.
  "PS<B-200", "รุ่น PS<B-200>", "Size <M>", "เกรด <A> หรือ <B>", "a<b c", "5<a", "<b>ตัวหนา",
  "a</b", "<!-- x -->", "<?x",
];
const TAG_REMOVED = [
  "<b>ตัวหนา</b>", "ดู <img src=x>", "</b>", "บรรทัด<br>ใหม่", "<img src=x onerror=alert(1)",
  '<a href="x">ลิงก์</a>',
];

describe("replacementNeedsWarning", () => {
  it("does not warn for text that is stored exactly as typed", () => {
    for (const r of STORED_AS_TYPED) {
      expect(replacementNeedsWarning(r), r).toBe(false);
    }
  });

  it("warns for a real tag, which the server removes", () => {
    for (const r of TAG_REMOVED) {
      expect(replacementNeedsWarning(r), r).toBe(true);
    }
  });
});

describe("replacementNeedsWarning — agrees with what the server stores", () => {
  it("warns for a typed character reference, which is stored as the character", () => {
    for (const r of ["&amp;", "A &lt; B", "&#60;", "&#x3c;", "&nbsp;"]) {
      expect(replacementNeedsWarning(r), r).toBe(true);
    }
  });

  it("whenever it does NOT warn, the server stores exactly what was typed", async () => {
    const { sanitizePlainText } = await import("@/app/lib/sanitizeHtml");
    for (const r of STORED_AS_TYPED) {
      expect(sanitizePlainText(r), r).toBe(r);
    }
    // The entity check is deliberately cautious ("R&D;" looks like one): it
    // may warn for text that is in fact kept, never the other way round.
    for (const r of ["R&D; lab", "a & b; c", "ราคา <= 5", "เวอร์เนีย ดิจิตอล", "&", "&;", "& amp;", "100% & up"]) {
      if (!replacementNeedsWarning(r)) expect(sanitizePlainText(r), r).toBe(r);
    }
  });

  it("and whenever it DOES warn, the stored text really differs", async () => {
    const { sanitizePlainText } = await import("@/app/lib/sanitizeHtml");
    for (const r of [...TAG_REMOVED, "&amp;", "A &lt; B", "&#60;"]) {
      expect(replacementNeedsWarning(r), r).toBe(true);
      expect(sanitizePlainText(r), r).not.toBe(r);
    }
  });
});
