"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ConfirmDialog from "./ConfirmDialog";
import {
  NOTE_MATCH_SAMPLE_CAP,
  NOTE_REPLACEMENT_MAX_LENGTH,
  NOTE_SEARCH_TERM_MAX_LENGTH,
  NoteScanBudgetError,
  applyReplace,
  buildMatcher,
  createScanBudget,
  noteLengthRefusal,
  validateReplacement,
} from "../lib/noteSearch";
import type { NoteMatch, NoteMatcher } from "../lib/noteSearch";

/**
 * ค้นหา–แทนที่ในบันทึกลูกค้า — the search block on /customers.
 *
 * WHAT IT IS NOT: it is not the customer list's existing search. The box at the
 * top of that tab searches ชื่อลูกค้า / ชื่อบริษัท, it filters the list that is
 * already on screen, and this change does not touch it — different control,
 * different columns, different data. This block only ever reads
 * `/api/customers/note-search` and writes through `/api/customers/note-replace`.
 *
 * THE FOUR RULES THAT SHAPE THIS FILE
 *
 * 1. THE RULES ABOUT WHAT MAY BE SEARCHED ARE NOT REIMPLEMENTED HERE.
 *    `buildMatcher` from `app/lib/noteSearch.ts` — the same function both API
 *    routes call — decides whether a term may run at all, and it is the reason
 *    `.*` never reaches a query. That module deliberately imports nothing, so
 *    the browser runs the identical code the server does and the screen can
 *    never state one rule while the server enforces another.
 *
 * 2. NO "ทั้งคำ" TOGGLE, and that is a decision rather than an omission.
 *    JavaScript's `\b` is defined on the edges of `[A-Za-z0-9_]`; Thai has no
 *    spaces between words and no Thai character is in that set, so
 *    `\bเวอร์เนีย\b` can never match. A button whose answer is always "ไม่พบ"
 *    is worse than no button. There are exactly two toggles: `Aa` and `.*`.
 *
 * 3. EVERY SNIPPET IS RENDERED AS TEXT. A customer note is a years-long call
 *    log typed by hand; it may well contain `<`, `>` or something that reads as
 *    a tag. `dangerouslySetInnerHTML` appears NOWHERE in this file. Highlighting
 *    is done by slicing the snippet at the offsets the server already computed
 *    (`snippetMatchStart` / `snippetMatchEnd`) and putting the middle piece in a
 *    `<mark>` — three React text children, escaped by React like any other text.
 *
 * 4. NOTHING IS WRITTEN WITHOUT A PREVIEW OF THE REAL BEFORE → AFTER. The
 *    confirm dialog shows actual old and new text for the first few customers,
 *    not a count, and that new text is computed with `applyReplace` — THE SAME
 *    function the store runs inside the transaction, so the preview cannot
 *    disagree with the result. Pressing ค้นหา issues a GET and can write
 *    nothing; the POST exists on one code path and it starts at the dialog.
 */

// ── The wire shapes ──────────────────────────────────────────────────────────
//
// Mirrors of what `app/lib/customerNoteSearchStore.ts` returns, declared here
// rather than imported: that module is `server-only`, and this file is a client
// component. Same reason `app/lib/taskBoard.ts` exists. `NoteMatch` itself IS
// imported, from the pure `noteSearch.ts`, because the snippet offsets are the
// part a mismatch would actually break.

export interface CustomerNoteSearchRow {
  customerId: string;
  customerName: string;
  companyName: string;
  /** The note as the server read it. Preview material AND the concurrency
   *  token — it goes back as `expectedNote` so a customer whose note moved on
   *  is refused instead of overwritten. */
  note: string;
  matchCount: number;
  countCapped: boolean;
  matches: NoteMatch[];
}

export interface CustomerNoteSearchResponse {
  /** Echoed by the route AFTER sanitising, so the matcher built here is the one
   *  the server actually used — and the one it will use to replace. */
  term: string;
  matchCase: boolean;
  useRegex: boolean;
  rows: CustomerNoteSearchRow[];
  total: number;
  /** Matching customers NOT in `rows`. Never hidden from the admin. */
  hidden: number;
  cap: number;
  totalMatches: number;
  /** Notes too long to scan safely, therefore NOT searched — reported, because
   *  an unsearched customer must not look like one with no matches. */
  skippedOversize: number;
}

export type CustomerNoteReplaceStatus = "replaced" | "unchanged" | "refused";

export interface CustomerNoteReplaceResult {
  customerId: string;
  customerName: string;
  status: CustomerNoteReplaceStatus;
  matchCount: number;
  resultLength: number;
  code: string | null;
  reason: string;
}

export interface CustomerNoteReplaceReport {
  replacedCount: number;
  unchangedCount: number;
  refusedCount: number;
  results: CustomerNoteReplaceResult[];
}

// ── Preview sizing ───────────────────────────────────────────────────────────

/** Customers whose real before → after is spelled out in the confirm dialog.
 *  The dialog is a narrow modal with no scrollbar of its own, so this is the
 *  number that fits on a laptop screen while still being "several". The rest
 *  are counted, and the count is stated. */
export const PREVIEW_CUSTOMER_LIMIT = 3;

/** Characters of each before / after excerpt. A note runs to 2000 characters;
 *  quoting all of it twice per customer would push the confirm buttons off the
 *  screen, which is a worse failure than an ellipsis. */
export const PREVIEW_EXCERPT_LIMIT = 120;

/** Snippets shown per row in the results table. The server sends up to
 *  `NOTE_MATCH_SAMPLE_CAP`; the table shows the first two and says how many
 *  more there are, because a table cell that grows to five paragraphs stops
 *  being a table. */
export const ROW_SNIPPET_LIMIT = 2;

// ── The before → after excerpt ───────────────────────────────────────────────

/**
 * The one stretch of a note that a replace would actually change, quoted from
 * BOTH real strings.
 *
 * It is derived, never guessed: the common prefix and the common suffix of the
 * old and new note are measured, the difference is what is left in the middle,
 * and that middle is widened to whole lines so the excerpt reads as a line of
 * the call log rather than as a fragment. Nothing here re-runs the matcher or
 * re-implements the replacement — `next` is `applyReplace`'s own output, so
 * whatever this quotes is literally what will be stored.
 *
 * Returns null when the note is unchanged; the caller says so in words instead
 * of showing an arrow between two identical lines.
 */
export function buildChangeExcerpt(
  note: string,
  next: string
): { before: string; after: string } | null {
  if (note === next) return null;

  const shortest = Math.min(note.length, next.length);
  let prefix = 0;
  while (prefix < shortest && note[prefix] === next[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < shortest - prefix &&
    note[note.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix++;
  }

  // Widen backwards to the start of the line. `prefix === 0` is special-cased:
  // `lastIndexOf(x, -1)` searches at index 0 rather than giving up, which on a
  // note that opens with a newline would put the start AFTER the change.
  const lineStart = prefix === 0 ? 0 : note.lastIndexOf("\n", prefix - 1) + 1;

  // Widen forwards to the end of the line. The common suffix is identical in
  // both strings, so the offset of its first newline is valid in both.
  const tailStart = note.length - suffix;
  const newlineInTail = note.indexOf("\n", tailStart);
  const tailExtra = (newlineInTail === -1 ? note.length : newlineInTail) - tailStart;

  const beforeEnd = tailStart + tailExtra;
  const afterEnd = next.length - suffix + tailExtra;

  return {
    before: clampExcerpt(note.slice(lineStart, beforeEnd), lineStart > 0, beforeEnd < note.length),
    after: clampExcerpt(next.slice(lineStart, afterEnd), lineStart > 0, afterEnd < next.length),
  };
}

/** One line, bounded, with a visible "…" wherever something was cut. A silent
 *  trim in a confirmation dialog is a lie told at the worst possible moment.
 *  A newline inside the excerpt (only reachable when a regular expression
 *  matched across lines) is shown as ⏎ so the เดิม/ใหม่ pair stays legible. */
function clampExcerpt(text: string, cutFront: boolean, cutBack: boolean): string {
  let body = text;
  let trailing = cutBack;
  if (body.length > PREVIEW_EXCERPT_LIMIT) {
    body = body.slice(0, PREVIEW_EXCERPT_LIMIT);
    trailing = true;
  }
  body = body.replace(/\n/g, " ⏎ ");
  return `${cutFront ? "…" : ""}${body}${trailing ? "…" : ""}`;
}

// ── The preview pass ─────────────────────────────────────────────────────────

/** One customer's before → after, as the confirm dialog will state it. */
export interface CustomerNotePreviewItem {
  row: CustomerNoteSearchRow;
  /** `applyReplace`'s own output — null when that customer is refused. */
  next: string | null;
  excerpt: { before: string; after: string } | null;
  /** The Thai reason this customer will be refused for length, or null. */
  lengthRefusal: string | null;
}

/**
 * The real before → after for every customer about to be replaced, computed
 * with `applyReplace` — the same function the server runs inside the
 * transaction, so the dialog cannot promise something different from what gets
 * stored.
 *
 * ONE SHARED TIME BUDGET FOR THE WHOLE PASS, and this is the reason this is a
 * function rather than a loop inline: it runs `applyReplace` up to 100 times IN
 * THE BROWSER, on the one thread that also draws the screen, at the exact
 * moment an admin has asked to confirm a bulk edit. A pattern that is merely
 * expensive — too ordinary-looking for `buildMatcher` to refuse — becomes a
 * frozen tab when it is multiplied by a hundred notes. The shared budget is
 * what notices that; every note carries the customer's NAME as its label, so
 * the abort says which customer it stopped on instead of "failed".
 *
 * THROWS `NoteScanBudgetError`. It is called from an event handler, never from
 * render, precisely so the throw can become a toast in Thai rather than a blank
 * screen where the customer list used to be.
 */
export function buildPreview(
  rows: CustomerNoteSearchRow[],
  matcher: NoteMatcher,
  replacement: string
): CustomerNotePreviewItem[] {
  const budget = createScanBudget();
  return rows.map((row) => {
    const label = row.customerName || row.companyName || row.customerId;
    const next = applyReplace(row.note, matcher, replacement, { budget, label });
    return {
      row,
      next,
      excerpt: next === null ? null : buildChangeExcerpt(row.note, next),
      // Measured here as well as on the server, so the dialog can say which
      // customer is about to be refused BEFORE anything is attempted.
      lengthRefusal: next === null ? null : noteLengthRefusal(next),
    };
  });
}

/** `sanitizePlainText` runs on the server before the replacement is written, and
 *  it strips tags and escapes `<`, `>` and `&`. That would make the stored text
 *  differ from what this screen previewed, so the difference is announced
 *  rather than discovered afterwards. */
function replacementNeedsWarning(replacement: string): boolean {
  return /[<>&]/.test(replacement);
}

// ── Props ────────────────────────────────────────────────────────────────────

interface CustomerNoteSearchPanelProps {
  /** The page's shared toast. */
  onToast: (message: string, type: "success" | "error") => void;
  /** The way into a customer: the page opens its detail view. */
  onOpenCustomer: (customerId: string) => void;
  /** Called after at least one note actually changed, so the page re-reads the
   *  customer list rather than trusting a report. */
  onReplaced: () => void;
  onUnauthorized: () => void;
  /** Closes the block. Optional so the panel still stands alone in tests. */
  onClose?: () => void;
}

export default function CustomerNoteSearchPanel({
  onToast,
  onOpenCustomer,
  onReplaced,
  onUnauthorized,
  onClose,
}: CustomerNoteSearchPanelProps) {
  // ── The search control ────────────────────────────────────────────────────
  const [term, setTerm] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // ── Results ───────────────────────────────────────────────────────────────
  const [result, setResult] = useState<CustomerNoteSearchResponse | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  // ── Replace ───────────────────────────────────────────────────────────────
  const [replacement, setReplacement] = useState("");
  const [pendingRows, setPendingRows] = useState<CustomerNoteSearchRow[]>([]);
  /** The before → after for `pendingRows`, computed once when the dialog is
   *  asked for. Always set and cleared together with `pendingRows`. */
  const [preview, setPreview] = useState<CustomerNotePreviewItem[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [report, setReport] = useState<CustomerNoteReplaceReport | null>(null);

  // ── Search ────────────────────────────────────────────────────────────────

  const runSearch = useCallback(
    async (
      searchTerm: string,
      wantCase: boolean,
      wantRegex: boolean,
      options?: { keepReport?: boolean }
    ) => {
      // The SAME validator both routes run. A refused pattern issues NO request
      // at all — and an empty term never falls through to an empty result set,
      // which would read as "this word appears in nobody's notes" instead of
      // "you have not searched yet".
      const built = buildMatcher({
        term: searchTerm,
        matchCase: wantCase,
        useRegex: wantRegex,
      });
      if (!built.ok) {
        setFormError(built.reason);
        return;
      }
      setFormError(null);
      setIsSearching(true);
      try {
        const params = new URLSearchParams({ term: searchTerm });
        if (wantCase) params.set("matchCase", "1");
        if (wantRegex) params.set("useRegex", "1");
        // GET. There is no write on this path, in this component or behind it.
        const res = await fetch(`/api/customers/note-search?${params.toString()}`);
        if (res.status === 401) {
          onUnauthorized();
          return;
        }
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(
            (data && typeof data.error === "string" && data.error) ||
              "ค้นหาคำในบันทึกลูกค้าไม่สำเร็จ"
          );
        }
        setResult(data as CustomerNoteSearchResponse);
        // A report from an earlier replace describes notes this search has just
        // re-read, so a NEW search clears it rather than letting it be read as a
        // report about the rows now on screen. The one exception is the re-read
        // that a replace itself triggers: that report is the only place the
        // refused customers are named, and throwing it away to refresh the table
        // would leave the admin believing everything went through.
        if (!options?.keepReport) setReport(null);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "ค้นหาคำในบันทึกลูกค้าไม่สำเร็จ";
        setFormError(message);
        setResult(null);
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
    runSearch(term, matchCase, useRegex);
  };

  // ── Auto-search with 200ms debounce ──────────────────────────────────────
  //
  // Fires the search automatically after the user stops typing for 200ms,
  // so pressing the button is no longer required. The timer is cancelled on
  // every keystroke and on unmount, and skipped when the term is empty or
  // whitespace-only (an empty search is refused by buildMatcher anyway).
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (term.trim() === "") return;
    debounceRef.current = setTimeout(() => {
      runSearch(term, matchCase, useRegex);
    }, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [term, matchCase, useRegex, runSearch]);

  // ── The matcher behind the results ────────────────────────────────────────
  //
  // Built from what the ROUTE echoed back, not from what is currently in the
  // box: the admin may have typed on since, and the preview has to describe the
  // rows on screen. It is also the term sent back with the replace, so the
  // server matches with exactly what was previewed.
  const matcher: NoteMatcher | null = useMemo(() => {
    if (!result) return null;
    const built = buildMatcher({
      term: result.term,
      matchCase: result.matchCase,
      useRegex: result.useRegex,
    });
    return built.ok ? built.matcher : null;
  }, [result]);

  const rows = result?.rows ?? [];

  // ── The preview, computed with the store's own function ───────────────────
  //
  // COMPUTED IN THE EVENT HANDLER (`askToReplace`), NOT IN RENDER, and held
  // here as state. `applyReplace` can now abort a pass that is taking absurdly
  // long, and it aborts by throwing; a throw out of a `useMemo` unmounts the
  // customers page and leaves a blank screen, which is a worse answer to "this
  // search is slow" than the freeze it replaced. In a handler the same throw
  // becomes a Thai toast naming the customer, and the dialog simply never
  // opens — nothing is written, and the admin can narrow his search and retry.
  //
  // It is not recomputed while the dialog is open: the dialog is modal, so the
  // คำแทนที่ box behind it cannot change until it is dismissed.

  const pendingOccurrences = pendingRows.reduce((sum, row) => sum + row.matchCount, 0);

  const confirmMessage = useMemo(() => {
    if (pendingRows.length === 0) return "";
    const lines: string[] = [
      `กำลังจะแก้ “บันทึกลูกค้า” ของ ${pendingRows.length} ราย รวม ${pendingOccurrences} จุด`,
      `คำค้น: “${result?.term ?? ""}”`,
      replacement === ""
        ? "คำแทนที่: (เว้นว่าง) — นี่คือการ ลบ คำค้นออกจากบันทึก ไม่ใช่การแทนที่ด้วยคำอื่น"
        : `แทนที่ด้วย: “${replacement}”`,
      "",
      "⚠️ นี่คือบันทึกการติดต่อจริงของลูกค้า ระบบเก็บประวัติค่าเดิมไว้ก่อนเขียนทับเสมอ แต่กรุณาอ่านตัวอย่างของจริงด้านล่างก่อนกดยืนยัน",
      "",
      `ตัวอย่างของจริง ${Math.min(PREVIEW_CUSTOMER_LIMIT, preview.length)} รายแรก:`,
    ];

    for (const item of preview.slice(0, PREVIEW_CUSTOMER_LIMIT)) {
      const who = item.row.customerName || item.row.customerId;
      const where = item.row.companyName ? ` (${item.row.companyName})` : "";
      lines.push(`• ${who}${where}`);
      if (item.next === null) {
        lines.push("   ระบบไม่ยอมแทนที่ให้ในรายนี้ เพราะคำค้นจับคู่ในลักษณะที่ไม่ปลอดภัย");
      } else if (!item.excerpt) {
        lines.push("   ไม่มีอะไรเปลี่ยนในบันทึกของรายนี้");
      } else {
        lines.push(`   เดิม: ${item.excerpt.before}`);
        lines.push(`   ใหม่: ${item.excerpt.after}`);
      }
      if (item.lengthRefusal) {
        lines.push(`   ⚠️ รายนี้จะถูกปฏิเสธ: ${item.lengthRefusal}`);
      }
    }

    if (pendingRows.length > PREVIEW_CUSTOMER_LIMIT) {
      lines.push(`…และอีก ${pendingRows.length - PREVIEW_CUSTOMER_LIMIT} ราย ที่ไม่ได้แสดงตัวอย่าง`);
    }

    if (replacementNeedsWarning(replacement)) {
      lines.push("");
      lines.push(
        "หมายเหตุ: คำแทนที่มีอักขระ < > หรือ & ซึ่งระบบจะแปลงหรือตัดออกก่อนบันทึก ผลจริงอาจต่างจากตัวอย่างนี้เล็กน้อย"
      );
    }

    return lines.join("\n");
  }, [pendingRows, preview, pendingOccurrences, replacement, result]);

  // ── Asking for a replace ──────────────────────────────────────────────────

  /** Opens the dialog. It does not write; nothing in this component writes
   *  except `submitReplace`, and the only caller of that is the dialog. */
  const askToReplace = (targets: CustomerNoteSearchRow[]) => {
    if (targets.length === 0) return;
    if (!matcher) {
      onToast("คำค้นของผลลัพธ์นี้ใช้แทนที่ไม่ได้ กรุณาค้นหาใหม่อีกครั้ง", "error");
      return;
    }
    const replacementError = validateReplacement(replacement);
    if (replacementError) {
      onToast(replacementError, "error");
      return;
    }

    // The whole preview pass, here, before the dialog exists. If it runs out of
    // its time budget the admin is told which customer's note it stalled on and
    // NOTHING opens — a confirm dialog that cannot show what it is about to do
    // has no business asking for a confirmation.
    let items: CustomerNotePreviewItem[];
    try {
      items = buildPreview(targets, matcher, replacement);
    } catch (error) {
      if (error instanceof NoteScanBudgetError) {
        onToast(error.message, "error");
        return;
      }
      throw error;
    }

    setPreview(items);
    setPendingRows(targets);
  };

  const submitReplace = async () => {
    if (isSubmitting || pendingRows.length === 0 || !result) return;
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/customers/note-replace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // The term the ROUTE echoed, so the server matches with exactly what
          // was previewed rather than with whatever the box holds now.
          term: result.term,
          matchCase: result.matchCase,
          useRegex: result.useRegex,
          replacement,
          // `expectedNote` is the note THIS SCREEN saw. It is what makes a stale
          // screen refuse a customer instead of swallowing somebody's edit.
          items: pendingRows.map((row) => ({
            customerId: row.customerId,
            expectedNote: row.note,
          })),
        }),
      });
      if (res.status === 401) {
        onUnauthorized();
        return;
      }
      const data = await res.json().catch(() => null);

      // The route answers 400 with the SAME body shape when EVERY customer was
      // refused. That case has to show the reasons per customer, not a generic
      // failure — so the report is detected by its shape, not by the status.
      if (data && Array.isArray((data as CustomerNoteReplaceReport).results)) {
        const nextReport = data as CustomerNoteReplaceReport;
        setReport(nextReport);
        setPendingRows([]);
        setPreview([]);

        const parts: string[] = [];
        if (nextReport.replacedCount > 0) {
          parts.push(`แทนที่สำเร็จ ${nextReport.replacedCount} ราย`);
        }
        if (nextReport.unchangedCount > 0) {
          parts.push(`${nextReport.unchangedCount} รายไม่มีอะไรต้องเปลี่ยน`);
        }
        if (nextReport.refusedCount > 0) {
          parts.push(`ทำไม่ได้ ${nextReport.refusedCount} ราย (ดูเหตุผลด้านล่าง)`);
        }
        if (parts.length === 0) parts.push("ไม่มีบันทึกของรายใดถูกเปลี่ยน");
        onToast(
          parts.join(" · "),
          nextReport.refusedCount > 0 && nextReport.replacedCount === 0 ? "error" : "success"
        );

        if (nextReport.replacedCount > 0) {
          onReplaced();
          // Re-read rather than patching state: the truth about these notes now
          // lives in the database, and a report is not a substitute for it. It
          // also refreshes every row's `expectedNote`, so a second replace is
          // not refused as stale by the write that just succeeded.
          await runSearch(result.term, result.matchCase, result.useRegex, {
            keepReport: true,
          });
        }
        return;
      }

      const message =
        (data && typeof data.error === "string" && data.error) ||
        "แทนที่คำในบันทึกลูกค้าไม่สำเร็จ";
      onToast(message, "error");
    } catch (err) {
      console.error(err);
      onToast(
        err instanceof Error ? err.message : "แทนที่คำในบันทึกลูกค้าไม่สำเร็จ",
        "error"
      );
    } finally {
      setIsSubmitting(false);
      setPendingRows([]);
      setPreview([]);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const hasSearched = result !== null;

  return (
    <section
      className="mb-6 rounded-2xl border border-gray-200 bg-white shadow-sm"
      aria-label="ค้นหาคำในบันทึกลูกค้า"
    >

      <div className="px-6 py-5">
        <form onSubmit={handleSubmitSearch} className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            maxLength={NOTE_SEARCH_TERM_MAX_LENGTH}
            aria-label="คำที่ต้องการค้นในบันทึกลูกค้า"
            placeholder="พิมพ์คำที่ต้องการหาในบันทึกลูกค้า เช่น เวอร์เนีย"
            className="flex-1 min-w-[16rem] bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 focus:bg-white focus:ring-2 focus:ring-orange-500 outline-none transition-all"
          />
        </form>

        {useRegex && (
          <p className="mt-3 text-xs text-gray-600 bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3">
            <span className="font-bold text-indigo-700">โหมด .* คืออะไร:</span>{" "}
            ปกติระบบจะหา “คำที่พิมพ์” ตรงๆ ตัวอักษรต่อตัวอักษร เปิดโหมดนี้แล้ว
            ตัวอักษรบางตัวจะกลายเป็นสัญลักษณ์แทน “รูปแบบ” เช่น <b>.</b> แปลว่าอักษรอะไรก็ได้ 1 ตัว
            <b> +</b> แปลว่าตัวก่อนหน้าซ้ำได้หลายครั้ง <b> ^</b> แปลว่าต้นบรรทัด — ถ้าไม่ได้ตั้งใจใช้แบบนี้
            ให้ปิดปุ่มนี้แล้วค้นด้วยคำธรรมดา ระบบจะไม่ยอมให้ใช้รูปแบบที่ตรงกับ “ทุกอย่าง” เช่น{" "}
            <code className="px-1 bg-white rounded border border-indigo-100">.*</code> เพราะกดแทนที่ทีเดียว
            จะเขียนทับบันทึกของลูกค้าทุกราย
          </p>
        )}

        {formError && (
          <p
            role="alert"
            className="mt-3 text-sm text-red-700 bg-red-50 border border-red-100 rounded-xl px-4 py-3 whitespace-pre-wrap"
          >
            {formError}
          </p>
        )}
      </div>

      {hasSearched && result && (
        <div className="px-6 pb-6">
          {/* ── The count, and what is NOT on the screen ──────────────────── */}
          <div className="mb-4 text-sm text-gray-700">
            {result.total === 0 ? (
              <p className="text-gray-500">
                ไม่พบคำว่า “{result.term}” ในบันทึกของลูกค้ารายใดเลย
              </p>
            ) : (
              <p>
                พบใน <b>{result.total}</b> ราย รวม <b>{result.totalMatches}</b> จุด
                {result.hidden > 0 && (
                  <span className="ml-1 text-amber-700 font-semibold">
                    · แสดงได้ {rows.length} ราย ยังมีอีก {result.hidden} ราย ที่ไม่ได้แสดง
                    (และปุ่ม “แทนที่ทั้งหมด” จะแก้เฉพาะ {rows.length} รายที่เห็นบนจอนี้) —
                    กรุณาระบุคำค้นให้แคบลงแล้วค้นอีกครั้ง
                  </span>
                )}
              </p>
            )}
            {result.skippedOversize > 0 && (
              <p className="mt-1 text-amber-700">
                มีบันทึกของ {result.skippedOversize} ราย ที่ยาวเกินกว่าจะค้นได้อย่างปลอดภัย ระบบจึง{" "}
                <b>ไม่ได้ค้น</b> รายเหล่านั้น (ไม่ใช่ว่าไม่เจอ) กรุณาเปิดดูเองเป็นรายๆ
              </p>
            )}
          </div>

          {rows.length > 0 && (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-gray-50/50 text-gray-500 text-xs uppercase tracking-wider">
                      <th className="px-4 py-3 font-semibold rounded-l-xl whitespace-nowrap">ชื่อลูกค้า</th>
                      <th className="px-4 py-3 font-semibold whitespace-nowrap">บริษัท</th>
                      <th className="px-4 py-3 font-semibold whitespace-nowrap">จำนวนที่เจอ</th>
                      <th className="px-4 py-3 font-semibold">ข้อความรอบๆ คำที่เจอ</th>
                      <th className="px-4 py-3 font-semibold text-right rounded-r-xl whitespace-nowrap">
                        จัดการ
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {rows.map((row) => (
                      <tr key={row.customerId} className="align-top hover:bg-gray-50/50 transition-colors">
                        <td className="px-4 py-4 font-semibold text-gray-900 whitespace-nowrap">
                          {row.customerName || "(ไม่มีชื่อ)"}
                        </td>
                        <td className="px-4 py-4 text-gray-700 whitespace-nowrap">
                          {row.companyName || "-"}
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 text-xs font-bold">
                            {row.matchCount}
                            {row.countCapped ? "+" : ""} ครั้ง
                          </span>
                        </td>
                        <td className="px-4 py-4 text-sm text-gray-700 min-w-[22rem]">
                          {row.matches.slice(0, ROW_SNIPPET_LIMIT).map((match, index) => (
                            <Snippet key={`${row.customerId}-${match.start}-${index}`} match={match} />
                          ))}
                          {row.matches.length > ROW_SNIPPET_LIMIT && (
                            <p className="mt-1 text-xs text-gray-400">
                              …และอีก {row.matchCount - ROW_SNIPPET_LIMIT} จุดในบันทึกของรายนี้
                              {row.matchCount > NOTE_MATCH_SAMPLE_CAP &&
                                " (ระบบแสดงตัวอย่างได้สูงสุด " + NOTE_MATCH_SAMPLE_CAP + " จุด)"}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-4 text-right whitespace-nowrap space-x-3">
                          <button
                            type="button"
                            onClick={() => onOpenCustomer(row.customerId)}
                            className="text-gray-500 hover:text-gray-900 font-medium text-sm transition-colors"
                          >
                            เปิดดูลูกค้า
                          </button>
                          <button
                            type="button"
                            onClick={() => askToReplace([row])}
                            className="text-blue-600 hover:text-blue-800 font-semibold text-sm transition-colors"
                          >
                            แทนที่รายนี้
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* ── The replacement ──────────────────────────────────────── */}
              <div className="mt-5 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4">
                <div className="flex flex-wrap items-center gap-3">
                  <label
                    htmlFor="customer-note-replacement"
                    className="text-sm font-semibold text-gray-700"
                  >
                    แทนที่ด้วย
                  </label>
                  <input
                    id="customer-note-replacement"
                    type="text"
                    value={replacement}
                    onChange={(e) => setReplacement(e.target.value)}
                    maxLength={NOTE_REPLACEMENT_MAX_LENGTH}
                    placeholder="พิมพ์คำใหม่ (เว้นว่างไว้ = ลบคำนี้ออก)"
                    className="flex-1 min-w-[16rem] bg-white border border-gray-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-orange-500 outline-none transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => askToReplace(rows)}
                    className="px-5 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white font-semibold transition"
                  >
                    แทนที่ทั้งหมด ({rows.length} ราย)
                  </button>
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  {replacement === ""
                    ? "ยังไม่ได้ใส่คำแทนที่ — กดแทนที่ตอนนี้คือการ ลบ คำที่ค้นเจอออกจากบันทึก"
                    : `ทุกจุดที่เจอจะกลายเป็น “${replacement}” ตัวขึ้นบรรทัดในบันทึกไม่ถูกแตะ`}
                  {" "}ระบบจะแสดงตัวอย่างของจริงให้ยืนยันก่อนเสมอ และเก็บประวัติค่าเดิมไว้ทุกครั้ง
                </p>
                {replacementNeedsWarning(replacement) && (
                  <p className="mt-1 text-xs text-amber-700">
                    คำแทนที่มีอักขระ &lt; &gt; หรือ &amp; ระบบจะแปลงหรือตัดออกก่อนบันทึก
                    ผลจริงอาจต่างจากตัวอย่างเล็กน้อย
                  </p>
                )}
              </div>
            </>
          )}

        </div>
      )}

      {/* ── The report ─────────────────────────────────────────────────────
          OUTSIDE the results block on purpose. It is the only place the
          refused customers are named, so it must survive a re-read that then
          fails — losing it would leave "ทำไม่ได้ 3 ราย" as the last thing the
          admin was told, with no way to learn which three. */}
      {report && (
        <div className="px-6 pb-6">
          <ReplaceReport report={report} />
        </div>
      )}

      {pendingRows.length > 0 && (
        <ConfirmDialog
          title="ยืนยันการแทนที่ในบันทึกลูกค้า"
          message={confirmMessage}
          confirmText={`แทนที่ ${pendingRows.length} ราย`}
          loadingText="กำลังแทนที่..."
          cancelText="ยกเลิก"
          loading={isSubmitting}
          onConfirm={submitReplace}
          onCancel={() => {
            setPendingRows([]);
            setPreview([]);
          }}
        />
      )}
    </section>
  );
}

// ── Small pieces ─────────────────────────────────────────────────────────────

function ToggleButton({
  label,
  title,
  pressed,
  onClick,
}: {
  label: string;
  title: string;
  pressed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      aria-label={title}
      title={title}
      className={`px-3 py-2.5 rounded-xl border font-mono text-sm font-bold transition-all ${
        pressed
          ? "bg-orange-500 border-orange-500 text-white shadow-sm"
          : "bg-white border-gray-200 text-gray-500 hover:bg-gray-50"
      }`}
    >
      {label}
    </button>
  );
}

/**
 * One context window, as TEXT.
 *
 * The three pieces are React text children, so React escapes them: a note
 * containing `<script>alert(1)</script>` shows up on screen as those very
 * characters and never becomes an element. The offsets come from the server
 * (`snippetMatchStart` / `snippetMatchEnd`), so the highlight lands on the
 * occurrence that was actually found rather than on the first one a fresh
 * search of the snippet would stumble over.
 */
function Snippet({ match }: { match: NoteMatch }) {
  const before = match.snippet.slice(0, match.snippetMatchStart);
  const hit = match.snippet.slice(match.snippetMatchStart, match.snippetMatchEnd);
  const after = match.snippet.slice(match.snippetMatchEnd);
  return (
    <p className="mb-1 last:mb-0 whitespace-pre-wrap break-words leading-relaxed">
      {match.prefixTruncated && <span className="text-gray-400">…</span>}
      {before}
      <mark className="bg-yellow-200 text-gray-900 font-bold rounded px-0.5">{hit}</mark>
      {after}
      {match.suffixTruncated && <span className="text-gray-400">…</span>}
    </p>
  );
}

const STATUS_META: Record<
  CustomerNoteReplaceStatus,
  { label: string; chip: string }
> = {
  replaced: { label: "แทนที่แล้ว", chip: "bg-green-100 text-green-700" },
  unchanged: { label: "ไม่มีอะไรเปลี่ยน", chip: "bg-gray-100 text-gray-600" },
  refused: { label: "ทำไม่ได้", chip: "bg-red-100 text-red-700" },
};

/**
 * What actually happened, per customer.
 *
 * A refused customer is NAMED and carries its own Thai reason. "ทำไม่ได้ 3 ราย"
 * on its own tells an admin that something is wrong and nothing about which
 * three customers or what to do next — and these are years of call history, so
 * "go and check all of them" is not an acceptable answer.
 */
function ReplaceReport({ report }: { report: CustomerNoteReplaceReport }) {
  const refused = report.results.filter((r) => r.status === "refused");
  return (
    <div className="mt-5 rounded-2xl border border-gray-200 bg-white px-4 py-4">
      <h4 className="text-sm font-bold text-gray-900">ผลการแทนที่</h4>
      <p className="mt-1 text-sm text-gray-600">
        แทนที่สำเร็จ {report.replacedCount} ราย · ไม่มีอะไรเปลี่ยน {report.unchangedCount} ราย ·
        ทำไม่ได้ {report.refusedCount} ราย
      </p>
      {refused.length > 0 && (
        <p className="mt-1 text-xs text-gray-500">
          รายที่ทำไม่ได้แสดงเหตุผลไว้ครบทุกราย ไม่ได้รวบเป็นตัวเลข
        </p>
      )}
      <ul className="mt-3 space-y-2">
        {report.results.map((item) => (
          <li
            key={`${item.customerId}-${item.status}`}
            className="flex flex-wrap items-start gap-2 text-sm"
          >
            <span
              className={`shrink-0 px-2 py-0.5 rounded-full text-[11px] font-bold ${
                STATUS_META[item.status]?.chip ?? "bg-gray-100 text-gray-600"
              }`}
            >
              {STATUS_META[item.status]?.label ?? item.status}
            </span>
            <span className="font-semibold text-gray-900">
              {item.customerName || item.customerId || "(ไม่ทราบชื่อ)"}
            </span>
            {item.reason && <span className="text-gray-600 basis-full">{item.reason}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
