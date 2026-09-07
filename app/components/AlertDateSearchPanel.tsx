"use client";
import { useCallback, useMemo, useState } from "react";
import DatePicker from "./DatePicker";
import ConfirmDialog from "./ConfirmDialog";
import SearchableDropdown from "./SearchableDropdown";
import type { SearchableDropdownOption } from "./SearchableDropdown";
import {
  BULK_RESCHEDULE_MAX_ITEMS,
  BULK_RESCHEDULE_MAX_SHIFT_DAYS,
  DATE_SEARCH_MAX_RANGE_DAYS,
  DATE_SEARCH_ROW_CAP,
  computeTargetDate,
  isRowMovable,
  selectAllPlan,
  summariseShift,
  validateItemCount,
  validateSearchRange,
  validateShiftDays,
} from "../lib/alertDateSearch";
import type {
  AlertDateSearchResult,
  DatedAlertKind,
  DatedAlertRow,
  RescheduleMode,
  RescheduleReport,
} from "../lib/alertDateSearch";
import {
  addDaysToDateString,
  bangkokDateString,
  daysBetweenDateStrings,
  formatDisplayDate,
  isValidDateString,
  toLocalDateString,
} from "../lib/dateFormat";

/**
 * ค้นหาแจ้งเตือนตามวันที่ — the date search + bulk reschedule block on
 * /crm/alerts.
 *
 * WHAT IT IS NOT: it is not a replacement for anything already on that page.
 * The automatic feed and its tab strip are untouched above it, the manual task
 * board is untouched below it, and nothing here gives a task card a snooze
 * button. This block only ever reads `/api/admin/alerts/search` and writes
 * through `/api/admin/alerts/reschedule`.
 *
 * THE THREE RULES THAT SHAPE THIS FILE
 *
 * 1. THE MOVABILITY RULE IS NOT REIMPLEMENTED HERE. Every row already arrives
 *    with `movable` / `immovableCode` / `immovableReason` computed on the
 *    server by `evaluateMovability`, and the two places this file still has to
 *    ask the question itself (เลือกทั้งหมด, and the count beside it) call the
 *    exported `isRowMovable` / `selectAllPlan` rather than testing `kind` or
 *    `status` by hand. A greyed checkbox is a courtesy; the route enforces the
 *    same rule against the status it reads from the database. If the two ever
 *    disagreed, the admin would tick a box and be refused with no explanation.
 *
 * 2. NO DATE ARITHMETIC IS HAND-ROLLED. `addDaysToDateString`,
 *    `daysBetweenDateStrings`, `bangkokDateString`, `computeTargetDate` and
 *    `summariseShift` do all of it. This app runs on Vercel in UTC while the
 *    business lives in Bangkok, and `new Date()` maths on these `YYYY-MM-DD`
 *    strings has produced dated bugs in this project before.
 *
 * 3. THE VIEW PREFERENCE COVERS THE SEARCH RESULTS ONLY. See
 *    `ALERT_SEARCH_VIEW_STORAGE_KEY` below.
 */

// ── The remembered view ──────────────────────────────────────────────────────

export type AlertSearchView = "table" | "cards";

/** Per-viewer, per-browser, exactly like the language preference in
 *  `app/i18n/LanguageContext.tsx` — this is a display habit, not data, so it
 *  has no business in the database. */
export const ALERT_SEARCH_VIEW_STORAGE_KEY = "crm-alert-search-view";

/**
 * THE RESOLUTION OF THE OWNER'S TWO HALF-ANSWERS.
 *
 * He asked for both "ให้ default สลับดูเป็นตารางก่อน" and "จำไว้ว่าครั้งก่อนดู
 * แบบไหน", and those two cannot both win once he has deliberately gone back to
 * cards. The reading this file implements:
 *
 *   • TABLE IS THE INITIAL DEFAULT — what a search opens in before he has ever
 *     expressed a preference, and what it falls back to when the stored
 *     preference cannot be read (a private window, cleared storage, a browser
 *     that throws on `localStorage`).
 *   • ONCE HE HAS CHOSEN, HIS CHOICE WINS on every later search. Re-imposing
 *     the table on someone who went back to cards on purpose is how a control
 *     teaches people to stop touching it.
 *
 * SCOPE: this remembers the layout of the SEARCH RESULTS and nothing else. The
 * automatic alert feed above and the task board below are different surfaces
 * with their own long-standing card layout; a preference expressed here does
 * not reach either of them.
 *
 * Never throws. A read that fails is not an error worth showing anybody — it
 * is a browser with storage switched off, and the honest response is the
 * default view.
 */
export function readStoredSearchView(): AlertSearchView {
  try {
    return window.localStorage.getItem(ALERT_SEARCH_VIEW_STORAGE_KEY) === "cards"
      ? "cards"
      : "table";
  } catch {
    return "table";
  }
}

/** Best-effort. A browser that refuses to store the preference still gets to
 *  use the toggle for this session. */
export function writeStoredSearchView(view: AlertSearchView): void {
  try {
    window.localStorage.setItem(ALERT_SEARCH_VIEW_STORAGE_KEY, view);
  } catch {
    /* storage unavailable — the toggle still works, it just won't be remembered */
  }
}

// ── Category presentation ────────────────────────────────────────────────────

interface KindMeta {
  label: string;
  icon: string;
  /** Chip colours, matching the tone each category already uses in the feed. */
  chip: string;
  /** Display order when two rows share a date. */
  order: number;
}

const KIND_META: Record<DatedAlertKind, KindMeta> = {
  schedule: { label: "กำหนดการ", icon: "🔧", chip: "bg-blue-50 text-blue-700 border-blue-200", order: 0 },
  customer_call: { label: "นัดโทรลูกค้า", icon: "📞", chip: "bg-violet-50 text-violet-700 border-violet-200", order: 1 },
  task: { label: "สิ่งที่ต้องทำ", icon: "📝", chip: "bg-indigo-50 text-indigo-700 border-indigo-200", order: 2 },
  warranty: { label: "ประกันใกล้หมด", icon: "🛡️", chip: "bg-orange-50 text-orange-700 border-orange-200", order: 3 },
  calibration: { label: "ใกล้ถึงกำหนดสอบเทียบ", icon: "🎯", chip: "bg-cyan-50 text-cyan-700 border-cyan-200", order: 4 },
  receivable: { label: "ลูกหนี้ค้างชำระ", icon: "💰", chip: "bg-amber-50 text-amber-700 border-amber-200", order: 5 },
};

/** The row's own `status` verbatim, in Thai. Unknown values fall through
 *  untranslated rather than being hidden — an unfamiliar status is information,
 *  not a bug to paper over. */
const STATUS_LABELS: Record<string, string> = {
  pending: "รอดำเนินการ",
  completed: "ปิดงานแล้ว",
  cancelled: "ยกเลิกแล้ว",
  done: "เสร็จแล้ว",
  unpaid: "ยังค้างชำระ",
  paid: "ชำระครบแล้ว",
  Active: "อยู่ในประกัน",
  Expired: "หมดประกันแล้ว",
};

/**
 * Colour per status, so the column can be read by scanning rather than by
 * reading every chip — which is the whole reason the owner asked for a table.
 * The grouping is by WHAT THE ADMIN HAS TO DO, not by the word itself:
 *   amber  = waiting on him
 *   rose   = money owed, or a warranty already gone
 *   emerald= settled, nothing to do
 *   slate  = closed without being done, and dimmer than the rest on purpose
 * Colour is never the only carrier — the Thai label is always present — so this
 * stays readable to anyone who cannot separate these hues.
 */
const STATUS_CHIP: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800",
  unpaid: "bg-rose-100 text-rose-700",
  Expired: "bg-rose-100 text-rose-700",
  Active: "bg-sky-100 text-sky-700",
  done: "bg-emerald-100 text-emerald-700",
  completed: "bg-emerald-100 text-emerald-700",
  paid: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-slate-200 text-slate-500",
};

/** Unknown statuses keep the old neutral chip rather than being force-fitted
 *  into a colour that would imply a meaning nobody decided. */
const STATUS_CHIP_FALLBACK = "bg-gray-100 text-gray-600";

/** `productName` can carry markup (the feed renders it with
 *  `dangerouslySetInnerHTML`). This block renders every string as TEXT, so the
 *  tags are stripped for display rather than executed. */
function plain(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Ids are unique per TABLE, not across tables, so a task and an appointment
 *  can share one. Selection is keyed by kind AND id or ticking a task could
 *  silently tick an appointment. */
function rowKey(row: { kind: string; id: string }): string {
  return `${row.kind}:${row.id}`;
}

/** "YYYY-MM-DD" → a LOCAL Date for the picker. `new Date("2026-09-05")` is UTC
 *  midnight, which the picker draws as the 4th anywhere west of Greenwich. */
function parseDateValue(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? "").trim());
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

// ── Props ────────────────────────────────────────────────────────────────────

interface AlertDateSearchPanelProps {
  /** The page's shared toast. */
  onToast: (message: string, type: "success" | "error") => void;
  /** Called after at least one row actually moved, so the automatic feed above
   *  reloads — a moved appointment may enter or leave its window. */
  onRescheduled: () => void;
  onUnauthorized: () => void;
  /** Closes the block. Supplied by the page so the ONE header this block has
   *  carries the close control — the page used to draw its own title, summary
   *  and toggle directly above this identical header, which read as the same
   *  section rendered twice. Optional so the panel still stands alone in tests. */
  onClose?: () => void;
  /** Asia/Bangkok "today", injectable so tests do not depend on the clock. */
  today?: string;
}

type SearchMode = "single" | "range";

export default function AlertDateSearchPanel({
  onClose,
  onToast,
  onRescheduled,
  onUnauthorized,
  today: todayProp,
}: AlertDateSearchPanelProps) {
  const today = todayProp ?? bangkokDateString(new Date());

  // ── The date control ──────────────────────────────────────────────────────
  const [searchMode, setSearchMode] = useState<SearchMode>("single");
  const [fromDate, setFromDate] = useState<string>(today);
  const [toDate, setToDate] = useState<string>(today);
  const [formError, setFormError] = useState<string | null>(null);

  // ── Results ───────────────────────────────────────────────────────────────
  const [result, setResult] = useState<AlertDateSearchResult | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [filterKind, setFilterKind] = useState<DatedAlertKind | "all">("all");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // The stored preference is read ONCE, in the lazy initialiser, and falls back
  // to the table when it cannot be read at all. Reading it here rather than in
  // an effect costs no hydration mismatch: nothing view-dependent exists until
  // a search has returned, which cannot happen before the page is hydrated — the
  // toggle and the results are both inside the `hasSearched` branch below.
  const [view, setView] = useState<AlertSearchView>(readStoredSearchView);

  // ── Selection + bulk ──────────────────────────────────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkMode, setBulkMode] = useState<RescheduleMode>("set");
  const [targetDate, setTargetDate] = useState<string>("");
  const [shiftDaysInput, setShiftDaysInput] = useState<string>("7");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [report, setReport] = useState<RescheduleReport | null>(null);

  const shiftDays = Number(shiftDaysInput);

  // ── Search ────────────────────────────────────────────────────────────────

  const runSearch = useCallback(
    async (from: string, to: string, options?: { keepReport?: boolean }) => {
      // The SAME validator the route runs. The screen can therefore never state
      // one rule while the server enforces another, and a bad range issues no
      // request at all.
      const rangeError = validateSearchRange(from, to);
      if (rangeError) {
        setFormError(rangeError);
        return;
      }
      setFormError(null);
      setIsSearching(true);
      try {
        const res = await fetch(
          `/api/admin/alerts/search?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
        );
        if (res.status === 401) {
          onUnauthorized();
          return;
        }
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(
            (data && typeof data.error === "string" && data.error) ||
              "ค้นหาแจ้งเตือนตามวันที่ไม่สำเร็จ"
          );
        }
        setResult(data as AlertDateSearchResult);
        setSearchError(null);
        setSelected(new Set());
        if (!options?.keepReport) setReport(null);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "ค้นหาแจ้งเตือนตามวันที่ไม่สำเร็จ";
        setSearchError(message);
        onToast(message, "error");
      } finally {
        setIsSearching(false);
      }
    },
    [onToast, onUnauthorized]
  );

  const handleSubmitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    if (isSearching) return;
    // A single-day search is `from === to`. One code path, never widened.
    runSearch(fromDate, searchMode === "single" ? fromDate : toDate);
  };

  /** The quick ranges. They exist to make the point that this search reaches
   *  BACKWARDS as freely as forwards — the feed can show neither. */
  const applyPreset = (from: string, to: string, mode: SearchMode) => {
    setSearchMode(mode);
    setFromDate(from);
    setToDate(to);
    runSearch(from, to);
  };

  // ── Rows ──────────────────────────────────────────────────────────────────

  const buckets = useMemo(
    () =>
      result
        ? ([
            ["schedule", result.schedules],
            ["customer_call", result.customerCalls],
            ["task", result.tasks],
            ["warranty", result.warranties],
            ["calibration", result.calibrations],
            ["receivable", result.receivables],
          ] as const)
        : [],
    [result]
  );

  const rows = useMemo(
    () => buckets.flatMap(([, bucket]) => bucket.rows ?? []),
    [buckets]
  );

  /** Rows over the per-category cap, so "และอีก N รายการ" can be said out loud
   *  instead of a backlog silently disappearing. */
  const hiddenByCap = useMemo(
    () =>
      buckets
        .map(([kind, bucket]) => ({
          kind: kind as DatedAlertKind,
          hidden: Math.max(0, (bucket.total ?? 0) - (bucket.rows?.length ?? 0)),
        }))
        .filter((entry) => entry.hidden > 0),
    [buckets]
  );

  const visibleRows = useMemo(() => {
    const scoped = filterKind === "all" ? rows : rows.filter((row) => row.kind === filterKind);
    const direction = sortDir === "asc" ? 1 : -1;
    // Lexical comparison is exact: every matchedDate is zero-padded YYYY-MM-DD.
    return [...scoped].sort((a, b) => {
      if (a.matchedDate !== b.matchedDate) {
        return (a.matchedDate < b.matchedDate ? -1 : 1) * direction;
      }
      return KIND_META[a.kind].order - KIND_META[b.kind].order;
    });
  }, [rows, filterKind, sortDir]);

  const selectedRows = useMemo(
    () => rows.filter((row) => selected.has(rowKey(row))),
    [rows, selected]
  );

  /** What "เลือกทั้งหมด" WILL do, computed before it does it, so the button can
   *  say so out loud. `visibleRows` is already the filter's scope in display
   *  order, so the plan's cap keeps the rows he can actually see rather than an
   *  arbitrary subset — hence "all" as the filter argument here. */
  const plan = useMemo(() => selectAllPlan(visibleRows, "all"), [visibleRows]);

  const handleSelectAll = () => {
    // The rule comes from `isRowMovable`, never from a `kind === "warranty"`
    // test written a second time in this file.
    const chosen = visibleRows.filter((row) => isRowMovable(row)).slice(0, plan.selectedCount);
    setSelected(new Set(chosen.map(rowKey)));
    if (plan.cappedOut > 0) {
      onToast(
        `เลือกได้ครั้งละไม่เกิน ${BULK_RESCHEDULE_MAX_ITEMS} รายการ จึงเลือกให้ ${plan.selectedCount} รายการ ` +
          `ยังเหลืออีก ${plan.cappedOut} รายการที่เลื่อนได้แต่ยังไม่ได้เลือก`,
        "error"
      );
    }
  };

  const toggleRow = (row: DatedAlertRow) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const key = rowKey(row);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const changeView = (next: AlertSearchView) => {
    setView(next);
    writeStoredSearchView(next);
  };

  // ── The move ──────────────────────────────────────────────────────────────

  const targetFor = useCallback(
    (row: DatedAlertRow): string | null =>
      computeTargetDate(bulkMode, row, { targetDate, shiftDays }),
    [bulkMode, targetDate, shiftDays]
  );

  const shiftSummary = useMemo(
    () =>
      bulkMode === "shift" && Number.isInteger(shiftDays) && shiftDays !== 0
        ? summariseShift(selectedRows, shiftDays, today)
        : null,
    [bulkMode, shiftDays, selectedRows, today]
  );

  /** Everything the confirm dialog has to say BEFORE anything is written. A
   *  count alone is not consent: this edits real appointments, so the first few
   *  rows are shown as before → after, in full. */
  const confirmMessage = useMemo(() => {
    const byKind = new Map<DatedAlertKind, number>();
    for (const row of selectedRows) byKind.set(row.kind, (byKind.get(row.kind) ?? 0) + 1);
    const breakdown = [...byKind.entries()]
      .map(([kind, count]) => `${KIND_META[kind].label} ${count}`)
      .join(" · ");

    const lines: string[] = [
      bulkMode === "set"
        ? `กำลังจะตั้งวันของ ${selectedRows.length} รายการ ให้เป็นวันที่ ${formatDisplayDate(targetDate)}`
        : `กำลังจะเลื่อนวันของ ${selectedRows.length} รายการ ไป ${shiftDays > 0 ? "+" : ""}${shiftDays} วัน (ระยะห่างระหว่างรายการเท่าเดิม)`,
    ];
    if (breakdown) lines.push(`(${breakdown})`);
    lines.push("");

    const preview = selectedRows.slice(0, 5);
    lines.push(`ตัวอย่าง ${preview.length} รายการแรก:`);
    for (const row of preview) {
      const to = targetFor(row);
      const label = plain(row.title) || KIND_META[row.kind].label;
      const who = plain(row.customerName) || plain(row.companyName);
      lines.push(
        `• ${label}${who ? ` — ${who}` : ""}: ${formatDisplayDate(row.matchedDate)} → ${
          to ? formatDisplayDate(to) : "คำนวณวันปลายทางไม่ได้"
        }`
      );
    }
    if (selectedRows.length > preview.length) {
      lines.push(`…และอีก ${selectedRows.length - preview.length} รายการ`);
    }

    if (shiftSummary && shiftSummary.count > 0) {
      lines.push("");
      lines.push(
        `ผลลัพธ์จะอยู่ระหว่าง ${formatDisplayDate(shiftSummary.earliest ?? "")} ถึง ${formatDisplayDate(shiftSummary.latest ?? "")}`
      );
      if (shiftSummary.beforeTodayCount > 0) {
        lines.push(`มี ${shiftSummary.beforeTodayCount} รายการที่จะย้อนไปก่อนวันนี้`);
      }
      if (shiftSummary.invalidCount > 0) {
        lines.push(`มี ${shiftSummary.invalidCount} รายการที่คำนวณวันปลายทางไม่ได้ และจะไม่ถูกแก้`);
      }
    }
    if (bulkMode === "set" && isValidDateString(targetDate) && targetDate < today) {
      lines.push("");
      lines.push("วันที่ปลายทางอยู่ก่อนวันนี้ — ตั้งใจย้อนหลังหรือไม่?");
    }

    lines.push("");
    lines.push("นี่คือการแก้วันจริงของนัดหมาย/งาน ไม่ใช่การซ่อนแจ้งเตือนชั่วคราว");
    return lines.join("\n");
  }, [selectedRows, bulkMode, targetDate, shiftDays, shiftSummary, targetFor, today]);

  const openConfirm = () => {
    const countError = validateItemCount(selectedRows.length);
    if (countError) {
      onToast(countError, "error");
      return;
    }
    if (bulkMode === "set") {
      if (!isValidDateString(targetDate)) {
        onToast("กรุณาเลือกวันที่ปลายทางก่อน", "error");
        return;
      }
    } else {
      const shiftError = validateShiftDays(shiftDaysInput.trim() === "" ? NaN : shiftDays);
      if (shiftError) {
        onToast(shiftError, "error");
        return;
      }
    }
    setConfirmOpen(true);
  };

  const submitReschedule = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/admin/alerts/reschedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: bulkMode,
          ...(bulkMode === "set" ? { targetDate } : { shiftDays }),
          // `expectedDate` is the date THIS SCREEN saw. It is what makes a
          // stale screen refuse instead of moving a row twice.
          items: selectedRows.map((row) => ({
            kind: row.kind,
            id: row.id,
            expectedDate: row.matchedDate,
          })),
        }),
      });
      if (res.status === 401) {
        onUnauthorized();
        return;
      }
      const data = await res.json().catch(() => null);

      // The route answers 400 with the SAME body shape when EVERY item was
      // refused. That case must show the reasons, not a generic failure — so
      // the report is detected by its shape, not by the status code.
      if (data && Array.isArray((data as RescheduleReport).results)) {
        const nextReport = data as RescheduleReport;
        setReport(nextReport);
        setConfirmOpen(false);

        const parts: string[] = [];
        if (nextReport.movedCount > 0) {
          parts.push(`เลื่อนวันสำเร็จ ${nextReport.movedCount} รายการ`);
        }
        if (nextReport.unchangedCount > 0) {
          parts.push(`${nextReport.unchangedCount} รายการอยู่วันนั้นอยู่แล้ว จึงไม่ต้องแก้`);
        }
        if (nextReport.refusedCount > 0) {
          parts.push(`ทำไม่ได้ ${nextReport.refusedCount} รายการ (ดูเหตุผลด้านล่าง)`);
        }
        if (parts.length === 0) parts.push("ไม่มีรายการใดถูกเปลี่ยน");
        // A batch where nothing NEEDED moving is a true, unremarkable outcome —
        // not a red toast. Only an actual refusal with nothing moved is.
        onToast(
          parts.join(" · "),
          nextReport.refusedCount > 0 && nextReport.movedCount === 0 ? "error" : "success"
        );

        if (nextReport.movedCount > 0) {
          onRescheduled();
          // Re-read rather than patching state: the truth about these dates now
          // lives in the database, and a report is not a substitute for it.
          if (result) await runSearch(result.from, result.to, { keepReport: true });
        }
        setSelected(new Set());
        return;
      }

      const message =
        (data && typeof data.error === "string" && data.error) ||
        "เลื่อนวันที่ของรายการที่เลือกไม่สำเร็จ";
      onToast(message, "error");
    } catch (err) {
      console.error(err);
      onToast(
        err instanceof Error ? err.message : "เลื่อนวันที่ของรายการที่เลือกไม่สำเร็จ",
        "error"
      );
    } finally {
      setIsSubmitting(false);
      setConfirmOpen(false);
    }
  };

  // ── Derived display bits ──────────────────────────────────────────────────

  const rangeSpan =
    isValidDateString(fromDate) && isValidDateString(toDate) && fromDate <= toDate
      ? (daysBetweenDateStrings(fromDate, toDate) ?? 0) + 1
      : null;

  const filterOptions: SearchableDropdownOption[] = useMemo(() => {
    const counts = new Map<DatedAlertKind, number>();
    for (const row of rows) counts.set(row.kind, (counts.get(row.kind) ?? 0) + 1);
    return [
      { value: "all", label: `ทุกหมวด (${rows.length})` },
      ...(Object.keys(KIND_META) as DatedAlertKind[]).map((kind) => ({
        value: kind,
        label: `${KIND_META[kind].icon} ${KIND_META[kind].label} (${counts.get(kind) ?? 0})`,
      })),
    ];
  }, [rows]);

  /** A refused/unchanged item, paired with the row it refers to so the reason
   *  can name the appointment rather than an id. */
  const reportProblems = useMemo(() => {
    if (!report) return [];
    return report.results
      .filter((item) => item.status !== "moved")
      .map((item) => ({
        item,
        row: rows.find((row) => row.kind === item.kind && row.id === item.id) ?? null,
      }));
  }, [report, rows]);

  const hasSearched = result !== null;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <section
      aria-labelledby="alert-date-search-heading"
      className="mb-8 bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden"
    >
      {/* ── The control ────────────────────────────────────────────────── */}
      <div className="px-4 sm:px-6 py-5 border-b border-gray-100">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <h2
              id="alert-date-search-heading"
              className="text-lg font-bold text-gray-900 flex items-center gap-2"
            >
              <span aria-hidden="true">🔎</span> ค้นหาแจ้งเตือนตามวันที่
            </h2>
            <p className="text-sm text-gray-500 mt-0.5">
              เลือกวันเดียวหรือช่วงวันก็ได้ ดูได้ทั้ง <strong className="font-semibold text-gray-700">อดีตและอนาคต</strong>{" "}
              (หน้าฟีดด้านล่างเห็นเฉพาะช่วงที่ใกล้ถึงเท่านั้น) แล้วติ๊กเลือกเพื่อเลื่อนวันพร้อมกันได้
            </p>
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 transition-all shadow-sm"
            >
              ซ่อนการค้นหา
            </button>
          )}
        </div>

        {/* Which mode he is in, said in three ways at once: the pressed button,
            the number of date fields on screen, and the caption underneath. A
            range control that silently behaves as a single day is worse than
            either of them. */}
        <div
          className="inline-flex rounded-xl border border-gray-200 bg-gray-50 p-1 mb-4"
          role="group"
          aria-label="รูปแบบการค้นหา"
        >
          <button
            type="button"
            onClick={() => setSearchMode("single")}
            aria-pressed={searchMode === "single"}
            className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${
              searchMode === "single"
                ? "bg-white text-gray-900 shadow-sm border border-gray-200"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            📅 วันเดียว
          </button>
          <button
            type="button"
            onClick={() => {
              setSearchMode("range");
              // Never leave the second field empty behind a range label: an
              // empty "ถึง" would look like a range and behave like nothing.
              if (!isValidDateString(toDate) || toDate < fromDate) setToDate(fromDate);
            }}
            aria-pressed={searchMode === "range"}
            className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${
              searchMode === "range"
                ? "bg-white text-gray-900 shadow-sm border border-gray-200"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            🗓️ ช่วงวัน
          </button>
        </div>

        <form onSubmit={handleSubmitSearch} className="flex flex-wrap items-end gap-3">
          <div className="w-full sm:w-52">
            <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wider">
              {searchMode === "single" ? "วันที่ต้องการดู" : "ตั้งแต่วันที่"}
            </label>
            <DatePicker
              selected={parseDateValue(fromDate)}
              onChange={(date) => setFromDate(date ? toLocalDateString(date) : "")}
              placeholderText={searchMode === "single" ? "เลือกวันที่" : "วันที่เริ่มต้น"}
            />
          </div>

          {searchMode === "range" && (
            <div className="w-full sm:w-52">
              <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wider">
                ถึงวันที่
              </label>
              <DatePicker
                selected={parseDateValue(toDate)}
                onChange={(date) => setToDate(date ? toLocalDateString(date) : "")}
                placeholderText="วันที่สิ้นสุด"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={isSearching}
            className="px-6 py-2.5 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 transition-all text-sm shadow-sm disabled:opacity-50"
          >
            {isSearching ? "กำลังค้นหา..." : "ค้นหา"}
          </button>
        </form>

        <p className="mt-2.5 text-xs font-semibold text-gray-600">
          {searchMode === "single" ? (
            <>
              โหมด: <span className="text-gray-900">ค้นหาวันเดียว</span> — ดูเฉพาะวันที่{" "}
              {formatDisplayDate(fromDate) || "ที่เลือก"}
            </>
          ) : (
            <>
              โหมด: <span className="text-gray-900">ค้นหาเป็นช่วงวัน</span> —{" "}
              {formatDisplayDate(fromDate) || "?"} ถึง {formatDisplayDate(toDate) || "?"}
              {rangeSpan !== null && ` (รวม ${rangeSpan} วัน)`}
              {` · ค้นหาได้ครั้งละไม่เกิน ${DATE_SEARCH_MAX_RANGE_DAYS} วัน`}
            </>
          )}
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          <span className="text-xs text-gray-400 self-center">ทางลัด:</span>
          <PresetButton label="วันนี้" onClick={() => applyPreset(today, today, "single")} />
          <PresetButton
            label="เมื่อวาน"
            onClick={() => {
              const day = addDaysToDateString(today, -1);
              applyPreset(day, day, "single");
            }}
          />
          <PresetButton
            label="7 วันข้างหน้า"
            onClick={() => applyPreset(today, addDaysToDateString(today, 7), "range")}
          />
          <PresetButton
            label="30 วันที่ผ่านมา"
            onClick={() => applyPreset(addDaysToDateString(today, -30), today, "range")}
          />
        </div>

        {formError && (
          <p role="alert" className="mt-3 text-sm font-semibold text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">
            ⚠️ {formError}
          </p>
        )}
        {searchError && (
          <p role="alert" className="mt-3 text-sm font-semibold text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">
            ⚠️ {searchError}
          </p>
        )}
      </div>

      {/* ── Results ────────────────────────────────────────────────────── */}
      {hasSearched && (
        <div className="px-4 sm:px-6 py-5">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-gray-900">
                {result!.from === result!.to
                  ? `ผลการค้นหาวันที่ ${formatDisplayDate(result!.from)}`
                  : `ผลการค้นหาช่วง ${formatDisplayDate(result!.from)} – ${formatDisplayDate(result!.to)}`}
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">
                พบทั้งหมด {rows.length} รายการ
                {filterKind !== "all" && ` · กรองเหลือ ${visibleRows.length} รายการ`}
                {` · เลื่อนวันได้ ${plan.eligibleCount} รายการ`}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="w-52">
                {/* PROJECT RULE — every dropdown is SearchableDropdown, never a
                    native <select>. Six fixed categories, so the search box
                    would be dead weight. */}
                <SearchableDropdown
                  searchable={false}
                  value={filterKind}
                  onChange={(value) => setFilterKind(value as DatedAlertKind | "all")}
                  options={filterOptions}
                  buttonClassName="h-[40px] px-3 rounded-xl border-gray-200 text-sm"
                />
              </div>
              <div
                className="inline-flex rounded-xl border border-gray-200 bg-gray-50 p-1"
                role="group"
                aria-label="รูปแบบการแสดงผล"
              >
                <button
                  type="button"
                  onClick={() => changeView("table")}
                  aria-pressed={view === "table"}
                  className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                    view === "table"
                      ? "bg-white text-gray-900 shadow-sm border border-gray-200"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  📋 ตาราง
                </button>
                <button
                  type="button"
                  onClick={() => changeView("cards")}
                  aria-pressed={view === "cards"}
                  className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                    view === "cards"
                      ? "bg-white text-gray-900 shadow-sm border border-gray-200"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  🗂️ การ์ด
                </button>
              </div>
            </div>
          </div>

          <p className="text-[11px] text-gray-400 mb-4">
            ระบบจำรูปแบบที่เลือกไว้ให้ การค้นหาครั้งต่อไปจะเปิดแบบเดิม (จำเฉพาะ “ผลการค้นหา” เท่านั้น
            ไม่กระทบการ์ดแจ้งเตือนอัตโนมัติหรือกระดานงานด้านล่าง)
          </p>

          {/* Selection controls */}
          {visibleRows.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <button
                type="button"
                onClick={handleSelectAll}
                className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 transition-all shadow-sm"
              >
                ☑️ เลือกทั้งหมด
              </button>
              {selected.size > 0 && (
                <button
                  type="button"
                  onClick={() => setSelected(new Set())}
                  className="px-4 py-2 bg-white border border-gray-200 text-gray-700 text-sm font-semibold rounded-xl hover:bg-gray-50 transition-all"
                >
                  ล้างการเลือก
                </button>
              )}
              <span className="text-xs text-gray-500">
                จะเลือกให้ {plan.selectedCount} จาก {plan.scopeCount} รายการที่เห็นอยู่
                {plan.scopeCount - plan.eligibleCount > 0 &&
                  ` (อีก ${plan.scopeCount - plan.eligibleCount} รายการเลื่อนวันไม่ได้ จึงข้ามให้)`}
                {plan.cappedOut > 0 && ` · เกินโควตา ${plan.cappedOut} รายการ`}
              </span>
            </div>
          )}

          {visibleRows.length === 0 ? (
            <div className="border border-dashed border-gray-200 rounded-2xl p-10 text-center">
              <div className="text-4xl mb-3 opacity-50">📭</div>
              <p className="font-bold text-gray-700">
                {rows.length === 0
                  ? "ไม่มีรายการในวันที่ค้นหา"
                  : "ไม่มีรายการในหมวดที่กรองไว้"}
              </p>
              <p className="text-sm text-gray-500 mt-1">
                “ข้อมูลไม่ครบ” และ “เอกสารค้าง” ไม่มีวันครบกำหนดของตัวเอง จึงไม่อยู่ในผลการค้นหาตามวันที่
              </p>
            </div>
          ) : view === "table" ? (
            <ResultsTable
              rows={visibleRows}
              selected={selected}
              onToggle={toggleRow}
              sortDir={sortDir}
              onToggleSort={() => setSortDir((dir) => (dir === "asc" ? "desc" : "asc"))}
              today={today}
            />
          ) : (
            <ResultsCards rows={visibleRows} selected={selected} onToggle={toggleRow} today={today} />
          )}

          {hiddenByCap.length > 0 && (
            <div className="mt-4 space-y-1">
              {hiddenByCap.map((entry) => (
                <p key={entry.kind} className="text-center text-sm text-gray-500">
                  และอีก {entry.hidden} รายการในหมวด {KIND_META[entry.kind].label} (แสดงผลสูงสุด{" "}
                  {DATE_SEARCH_ROW_CAP} รายการต่อหมวด)
                </p>
              ))}
            </div>
          )}

          {/* ── What happened last time ──────────────────────────────── */}
          {report && reportProblems.length > 0 && (
            <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4">
              <div className="flex items-start justify-between gap-3">
                <h4 className="text-sm font-bold text-amber-900">
                  ผลการเลื่อนวันครั้งล่าสุด — มี {reportProblems.length} รายการที่ไม่ได้ถูกแก้
                </h4>
                <button
                  type="button"
                  onClick={() => setReport(null)}
                  className="text-xs font-semibold text-amber-800 hover:underline shrink-0"
                >
                  ปิด
                </button>
              </div>
              <p className="text-xs text-amber-800 mt-1">
                สำเร็จ {report.movedCount} รายการ · ไม่มีอะไรต้องเปลี่ยน {report.unchangedCount} รายการ ·
                ทำไม่ได้ {report.refusedCount} รายการ
              </p>
              <ul className="mt-3 space-y-2">
                {reportProblems.map(({ item, row }) => (
                  <li
                    key={`${item.kind}:${item.id}`}
                    className="rounded-xl bg-white border border-amber-100 px-3 py-2"
                  >
                    <p className="text-xs font-bold text-gray-900 wrap-break-word">
                      {KIND_META[item.kind as DatedAlertKind]?.label ?? item.kind}
                      {row ? ` — ${plain(row.title) || row.id}` : ` — ${item.id}`}
                      {row?.customerName ? ` (${plain(row.customerName)})` : ""}
                    </p>
                    <p className="text-xs text-gray-700 mt-0.5 wrap-break-word">
                      {item.status === "unchanged"
                        ? item.reason || "วันที่เดิมตรงกับวันปลายทางอยู่แล้ว จึงไม่ได้แก้อะไร"
                        : item.reason}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* ── The bulk bar ─────────────────────────────────────────── */}
          {selected.size > 0 && (
            <div className="sticky bottom-4 mt-5 z-20 rounded-2xl border border-indigo-950/20 bg-indigo-900 text-white shadow-xl px-4 py-4">
              <div className="flex flex-wrap items-end gap-3">
                <div className="mr-auto">
                  <p className="text-sm font-bold">เลือกไว้ {selected.size} รายการ</p>
                  <p className="text-xs text-gray-300 mt-0.5">
                    เลื่อนวันได้ครั้งละไม่เกิน {BULK_RESCHEDULE_MAX_ITEMS} รายการ
                  </p>
                </div>

                <div
                  className="inline-flex rounded-xl bg-white/10 p-1"
                  role="group"
                  aria-label="วิธีเลื่อนวัน"
                >
                  <button
                    type="button"
                    onClick={() => setBulkMode("set")}
                    aria-pressed={bulkMode === "set"}
                    className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                      bulkMode === "set" ? "bg-white text-indigo-900" : "text-indigo-100 hover:text-white"
                    }`}
                  >
                    ตั้งเป็นวันที่เดียวกัน
                  </button>
                  <button
                    type="button"
                    onClick={() => setBulkMode("shift")}
                    aria-pressed={bulkMode === "shift"}
                    className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                      bulkMode === "shift" ? "bg-white text-indigo-900" : "text-indigo-100 hover:text-white"
                    }`}
                  >
                    เลื่อน ±N วัน
                  </button>
                </div>

                {bulkMode === "set" ? (
                  <div className="w-full sm:w-48">
                    <label className="block text-[11px] font-semibold text-gray-300 mb-1">
                      วันที่ปลายทาง
                    </label>
                    <DatePicker
                      selected={parseDateValue(targetDate)}
                      onChange={(date) => setTargetDate(date ? toLocalDateString(date) : "")}
                      placeholderText="เลือกวันที่ปลายทาง"
                      // Sits on the dark bar, so it takes the same treatment as
                      // the จำนวนวัน input beside it: solid white rather than the
                      // default grey, and a focus ring light enough to be seen
                      // against gray-900 (indigo/20 disappears on it).
                      className="!bg-white focus:!ring-white/40 focus:!border-white"
                    />
                  </div>
                ) : (
                  <div className="w-full sm:w-44">
                    <label
                      htmlFor="alert-shift-days"
                      className="block text-[11px] font-semibold text-gray-300 mb-1"
                    >
                      เลื่อนกี่วัน (ติดลบ = ย้อนหลัง)
                    </label>
                    <input
                      id="alert-shift-days"
                      type="number"
                      inputMode="numeric"
                      value={shiftDaysInput}
                      min={-BULK_RESCHEDULE_MAX_SHIFT_DAYS}
                      max={BULK_RESCHEDULE_MAX_SHIFT_DAYS}
                      onChange={(event) => setShiftDaysInput(event.target.value)}
                      className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-white/40"
                    />
                  </div>
                )}

                <button
                  type="button"
                  onClick={openConfirm}
                  disabled={isSubmitting}
                  className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white font-semibold rounded-xl text-sm shadow-sm disabled:opacity-50"
                >
                  ตรวจสอบและเลื่อนวัน
                </button>
              </div>

              {shiftSummary && shiftSummary.count > 0 && (
                <p className="mt-3 text-xs text-gray-200">
                  จะได้วันใหม่ระหว่าง {formatDisplayDate(shiftSummary.earliest ?? "")} ถึง{" "}
                  {formatDisplayDate(shiftSummary.latest ?? "")}
                  {shiftSummary.beforeTodayCount > 0 &&
                    ` · มี ${shiftSummary.beforeTodayCount} รายการที่ย้อนไปก่อนวันนี้`}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {confirmOpen && (
        <ConfirmDialog
          title="ยืนยันการเลื่อนวัน"
          message={confirmMessage}
          confirmText={`เลื่อนวัน ${selectedRows.length} รายการ`}
          loadingText="กำลังเลื่อนวัน..."
          cancelText="ยกเลิก"
          loading={isSubmitting}
          onConfirm={submitReschedule}
          onCancel={() => setConfirmOpen(false)}
        />
      )}
    </section>
  );
}

// ── Small pieces ─────────────────────────────────────────────────────────────

function PresetButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-3 py-1 rounded-full border border-gray-200 bg-white text-xs font-semibold text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-all"
    >
      {label}
    </button>
  );
}

function StatusBadge({ row }: { row: DatedAlertRow }) {
  const label = STATUS_LABELS[row.status] ?? row.status ?? "—";
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap ${
        STATUS_CHIP[row.status] ?? STATUS_CHIP_FALLBACK
      }`}
    >
      {label}
    </span>
  );
}

function DateCell({ row, today }: { row: DatedAlertRow; today: string }) {
  return (
    <span className="whitespace-nowrap">
      <span className="font-semibold text-gray-900">{formatDisplayDate(row.matchedDate)}</span>
      {row.overdue && (
        <span className="ml-1.5 text-[11px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full">
          เลยกำหนด
        </span>
      )}
      {!row.overdue && row.matchedDate === today && (
        <span className="ml-1.5 text-[11px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-full">
          วันนี้
        </span>
      )}
    </span>
  );
}

/**
 * The reason a row cannot be moved, ALWAYS RENDERED as text next to its
 * disabled checkbox — never as a `title` tooltip. Half the people who use this
 * screen use it on a phone, and a tooltip they cannot hover is not an
 * explanation, it is a locked door with no sign on it.
 */
function ImmovableReason({ row }: { row: DatedAlertRow }) {
  if (row.movable || !row.immovableReason) return null;
  return (
    <p className="mt-1 text-[11px] leading-snug text-amber-900 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1 wrap-break-word">
      🔒 {row.immovableReason}
    </p>
  );
}

function RowCheckbox({
  row,
  checked,
  onToggle,
}: {
  row: DatedAlertRow;
  checked: boolean;
  onToggle: (row: DatedAlertRow) => void;
}) {
  return (
    <input
      type="checkbox"
      checked={checked}
      disabled={!row.movable}
      onChange={() => onToggle(row)}
      aria-label={
        row.movable
          ? `เลือก ${plain(row.title) || KIND_META[row.kind].label} วันที่ ${formatDisplayDate(row.matchedDate)}`
          : `เลื่อนวันไม่ได้: ${row.immovableReason ?? ""}`
      }
      className="w-4 h-4 rounded border-gray-300 text-gray-900 focus:ring-gray-500 disabled:opacity-40 disabled:cursor-not-allowed"
    />
  );
}

function RowIdentity({ row }: { row: DatedAlertRow }) {
  const who = plain(row.customerName) || plain(row.companyName);
  const subtitle = plain(row.subtitle);
  return (
    <>
      <p className="font-semibold text-gray-900 wrap-break-word">
        {plain(row.title) || KIND_META[row.kind].label}
      </p>
      {who && <p className="text-xs text-gray-600 wrap-break-word">{who}</p>}
      {subtitle && <p className="text-xs text-gray-400 line-clamp-1 wrap-break-word">{subtitle}</p>}
      {row.kind === "task" && (
        <span className="inline-block mt-1 text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded">
          บันทึกเอง
        </span>
      )}
      {row.snoozedUntil && (
        <span className="inline-block mt-1 ml-1 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-100 px-1.5 py-0.5 rounded">
          เลื่อนแจ้งเตือนไว้
        </span>
      )}
      <ImmovableReason row={row} />
    </>
  );
}

function KindChip({ kind }: { kind: DatedAlertKind }) {
  const meta = KIND_META[kind];
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold border whitespace-nowrap ${meta.chip}`}
    >
      <span aria-hidden="true">{meta.icon}</span> {meta.label}
    </span>
  );
}

/** Dense, sortable by date, five columns — it fits a laptop without sideways
 *  scrolling. The `overflow-x-auto` wrapper is for phones, and it keeps the
 *  PAGE from ever scrolling sideways. */
function ResultsTable({
  rows,
  selected,
  onToggle,
  sortDir,
  onToggleSort,
  today,
}: {
  rows: DatedAlertRow[];
  selected: Set<string>;
  onToggle: (row: DatedAlertRow) => void;
  sortDir: "asc" | "desc";
  onToggleSort: () => void;
  today: string;
}) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-gray-100">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-left">
          <tr>
            <th scope="col" className="w-10 px-3 py-2.5">
              <span className="sr-only">เลือก</span>
            </th>
            <th
              scope="col"
              className="px-3 py-2.5 font-semibold text-gray-600"
              aria-sort={sortDir === "asc" ? "ascending" : "descending"}
            >
              <button
                type="button"
                onClick={onToggleSort}
                className="inline-flex items-center gap-1 font-semibold text-gray-600 hover:text-gray-900"
              >
                วันที่ {sortDir === "asc" ? "▲" : "▼"}
              </button>
            </th>
            <th scope="col" className="px-3 py-2.5 font-semibold text-gray-600">
              หมวด
            </th>
            <th scope="col" className="px-3 py-2.5 font-semibold text-gray-600">
              รายการ
            </th>
            <th scope="col" className="px-3 py-2.5 font-semibold text-gray-600">
              สถานะ
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className={selected.has(rowKey(row)) ? "bg-emerald-50/60" : "hover:bg-gray-50/60"}
            >
              <td className="px-3 py-2.5 align-top">
                <RowCheckbox row={row} checked={selected.has(rowKey(row))} onToggle={onToggle} />
              </td>
              <td className="px-3 py-2.5 align-top">
                <DateCell row={row} today={today} />
              </td>
              <td className="px-3 py-2.5 align-top">
                <KindChip kind={row.kind} />
              </td>
              <td className="px-3 py-2.5 align-top max-w-md">
                <RowIdentity row={row} />
              </td>
              <td className="px-3 py-2.5 align-top">
                <StatusBadge row={row} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ResultsCards({
  rows,
  selected,
  onToggle,
  today,
}: {
  rows: DatedAlertRow[];
  selected: Set<string>;
  onToggle: (row: DatedAlertRow) => void;
  today: string;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {rows.map((row) => (
        <div
          key={rowKey(row)}
          className={`rounded-2xl border p-4 transition-all ${
            selected.has(rowKey(row))
              ? "border-emerald-300 bg-emerald-50/60"
              : "border-gray-100 bg-white hover:border-gray-200"
          }`}
        >
          <div className="flex items-start gap-3">
            <div className="pt-0.5">
              <RowCheckbox row={row} checked={selected.has(rowKey(row))} onToggle={onToggle} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 mb-1.5">
                <KindChip kind={row.kind} />
                <StatusBadge row={row} />
              </div>
              <div className="mb-1.5">
                <DateCell row={row} today={today} />
              </div>
              <RowIdentity row={row} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
