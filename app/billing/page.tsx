"use client";
import { useState, useEffect, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../context/AuthContext";
import Toast from "../components/Toast";
import SearchableDropdown from "../components/SearchableDropdown";
import { useLeaveGuard, LeaveGuardModal } from "../components/LeaveGuard";
import { computeQuoteTotals } from "../lib/quotationTotals";
import {
  BILLING_LABELS,
  BILLING_PREFIX,
  billingDocNoPrefixes,
  nextBillingDocNo,
} from "../lib/billingNumber";
import type { BillingDocType } from "../lib/billingNumber";
import {
  toLocalDateString,
  addDaysToDateString,
  formatDisplayDate,
  isValidDateString,
} from "../lib/dateFormat";
import { DEFAULT_CREDIT_TERM_DAYS } from "../lib/alertThresholds";
import { PAYMENT_METHODS, DEFAULT_PAYMENT_METHOD } from "../lib/paymentMethods";

// ── Billing Document Builder ────────────────────────────────────────────────
// Admin-only tool to create Invoice / Billing Note / Receipt.
// Can optionally link to a saved Quotation to auto-fill all data.
// Uses the same QuoteState shape and PDF generation as the quotation builder.

const COMPANY = {
  name: "บริษัท โปรฟิน แล็บสเกล จำกัด",
  nameEn: "PROFIN LAB SCALE CO., LTD.",
  address:
    "93 ซอยงามวงศ์วาน 6 แยก 19 ถนนงามวงศ์วาน\nตำบลบางเขน อำเภอเมืองนนทบุรี จ.นนทบุรี 11000",
};

interface QuoteItem {
  id: string;
  name: string;
  description: string;
  imageUrl: string;
  qty: number;
  unit: string;
  unitPrice: number;
  // ── ส่วนลดรายรายการ ──────────────────────────────────────────────────────
  // Copied from the linked quotation, and OPTIONAL for the same reason it is
  // optional there: a billing document is one JSON blob, so every invoice /
  // ใบวางบิล / receipt saved before per-line discounts existed simply has no
  // such key on its lines. Missing ⇒ no discount (computeLineTotal), which is
  // exactly how those documents have always computed and printed.
  discount?: number;
  discountType?: "amount" | "percent";
}

interface BillingState {
  id: string;
  docType: BillingDocType;
  docNo: string;
  docDate: string;
  linkedQuotationId: string | null;
  linkedQuotationDocNo: string;
  sellerName: string;
  sellerPhone: string;
  sellerEmail: string;
  companyPhone: string;
  companyEmail: string;
  companyTaxId: string;
  customerContact: string;
  customerCompany: string;
  customerTaxId: string;
  customerAddress: string;
  customerPhone: string;
  customerEmail: string;
  items: QuoteItem[];
  discount: number;
  discountType: "amount" | "percent";
  vatEnabled: boolean;
  note: string;
  // ── ครบกำหนดชำระ ─────────────────────────────────────────────────────────
  // Whatever is in this box at save time is what goes into the `dueDate`
  // column. "Was it overridden?" is DERIVED for display (dueDate !== docDate +
  // the current term), never stored — the same reasoning that stops
  // setLineDiscountAmount stamping `discount: 0` onto a line nobody edited.
  dueDate: string;
  /** The invoice this ใบเสร็จรับเงิน settles. Receipt-only. */
  settlesDocId: string;
  // Receipt-specific
  paymentMethod: string;
  paymentDate: string;
  paymentRef: string;
}

interface QuotationOption {
  id: string;
  docNo: string;
  customer: string;
  total: number;
}

const fmt = (n: number) =>
  n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface LedgerEntry {
  /** The document that owns the number (`quotationId` in the shared ledger). */
  id: string;
  docNo: string;
}

/**
 * Every number the shared `used_docnos` ledger already owns under `bases` —
 * however old, because the query behind `?base=` is NOT date-windowed.
 *
 * This is the lookup a MINT has to use. `/api/billing/docnos` returns only the
 * last 7 days, which is right for warning about a duplicate and wrong for
 * issuing one: a billing number embeds the date as DDMMYY, and that is the same
 * six digits as the legacy YYMMDD shape of a different day a year earlier
 * (25 Jun 2026 → "250626" ← 26 Jun 2025). Numbers issued under that prefix last
 * year are invisible in a 7-day window but the ledger still owns them forever,
 * so minting from the window walks straight into a duplicate-key refusal the
 * admin can only escape by inventing a number by hand.
 *
 * It goes through the quotations route because there is ONE ledger for both
 * quotations and billing documents (app/lib/quotationStore.ts, listDocNosByBase)
 * — the route is prefix-agnostic and answers for INV/BN/RC exactly as for QT.
 * The server stays the authority; the client only asks it a narrower question.
 * Each base matches at most one day's numbers, so the answers are tiny.
 */
async function fetchLedgerByBases(bases: readonly string[]): Promise<LedgerEntry[]> {
  const lists = await Promise.all(
    bases.map(async (base) => {
      try {
        const res = await fetch(
          `/api/quotations/docnos?base=${encodeURIComponent(base)}`
        );
        if (!res.ok) return [];
        const list = await res.json();
        return Array.isArray(list) ? list : [];
      } catch {
        return [];
      }
    })
  );
  return lists
    .flat()
    .filter((x: { docNo?: unknown }) => typeof x?.docNo === "string")
    .map((x: { docNo: string; quotationId?: unknown }) => ({
      id: String(x.quotationId ?? ""),
      docNo: x.docNo,
    }));
}

const emptyState = (): BillingState => {
  const now = new Date();
  const iso = toLocalDateString(now);
  return {
    id: crypto.randomUUID(),
    docType: "invoice",
    docNo: "",
    docDate: iso,
    linkedQuotationId: null,
    linkedQuotationDocNo: "",
    sellerName: "",
    sellerPhone: "",
    sellerEmail: "",
    companyPhone: "",
    companyEmail: "",
    companyTaxId: "",
    customerContact: "",
    customerCompany: "",
    customerTaxId: "",
    customerAddress: "",
    customerPhone: "",
    customerEmail: "",
    items: [],
    discount: 0,
    discountType: "amount",
    vatEnabled: true,
    note: "",
    dueDate: "",
    settlesDocId: "",
    paymentMethod: DEFAULT_PAYMENT_METHOD,
    paymentDate: iso,
    paymentRef: "",
  };
};

const thaiDate = (iso: string) => {
  if (!iso) return "-";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const months = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  return `${d} ${months[m - 1]} ${y + 543}`;
};

const DOC_TYPE_OPTIONS: { value: BillingDocType; label: string }[] = [
  { value: "invoice", label: "🧾 ใบแจ้งหนี้ / ใบกำกับภาษี (Invoice / Tax Invoice)" },
  { value: "billing_note", label: "📋 ใบวางบิล (Billing Note)" },
  { value: "receipt", label: "🧾 ใบเสร็จรับเงิน (Receipt)" },
];

export default function BillingPage() {
  const router = useRouter();
  const { isLoggedIn, isLoading } = useAuth();
  const [b, setB] = useState<BillingState>(emptyState);
  const [quotations, setQuotations] = useState<QuotationOption[]>([]);
  const [existingDocs, setExistingDocs] = useState<LedgerEntry[]>([]);
  // Every number the ledger owns under THIS day's prefixes, at any age — the
  // set a new number is minted against (see fetchLedgerByBases).
  const [prefixDocs, setPrefixDocs] = useState<LedgerEntry[]>([]);
  const [generating, setGenerating] = useState(false);

  const [saving, setSaving] = useState(false);
  const [loadingQuotation, setLoadingQuotation] = useState(false);
  const [isViewOnly, setIsViewOnly] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  // A brand-new doc (not reopened) — eligible to auto-advance its docNo.
  const isFreshRef = useRef(true);
  const lastAutoDocNoRef = useRef<string>("");

  // ── ลูกหนี้ค้างชำระ ─────────────────────────────────────────────────────
  /** The configured default credit term. Falls back to the shared constant so
   *  the box is usable before the settings row exists or if the fetch fails. */
  const [creditTermDays, setCreditTermDays] = useState<number>(DEFAULT_CREDIT_TERM_DAYS);
  /** Invoices that still owe money — the ใบเสร็จรับเงิน's "ชำระให้ใบแจ้งหนี้"
   *  dropdown. Naming one is what turns issuing a receipt into recording the
   *  payment, in a single transaction on the server. */
  const [openInvoices, setOpenInvoices] = useState<
    { id: string; docNo: string; customerName: string; outstanding: number }[]
  >([]);
  /** The document this save REPLACES, when we arrived through "แก้ไข (New
   *  Ver.)". Without it the original keeps its debt and the invoice is billed
   *  twice. */
  const supersedesIdRef = useRef<string | null>(null);
  /**
   * Is "ครบกำหนดชำระ" still following `docDate + term`? (State, not a ref: the
   * box's displayed value is derived from it during render.)
   *
   * True only for a brand-new document nobody has typed a due date into — so
   * changing วันที่ moves the box with it. It flips to false the moment the
   * admin edits the field, and it starts false for ANY reopened document:
   * a saved due date is a term already agreed with that customer on that
   * invoice, not a live formula, so neither a later change to the global credit
   * term nor a change of วันที่ may silently move it. It is also what stops an
   * old invoice with no due date being auto-stamped with one merely because the
   * owner opened it and downloaded its PDF (which POSTs the document first).
   */
  const [dueDateAuto, setDueDateAuto] = useState(true);

  // ── Unsaved-changes guard ──
  const { isDirty, setSnapshot, guardedNavigate, showModal, confirmLeave, cancelLeave, setShowModal } = useLeaveGuard(b);

  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace("/login");
  }, [isLoggedIn, isLoading, router]);

  // Load quotation list for linking
  useEffect(() => {
    if (!isLoggedIn) return;
    fetch("/api/quotations")
      .then((r) => (r.ok ? r.json() : []))
      .then((list) =>
        setQuotations(
          Array.isArray(list)
            ? list.map((q: any) => ({
                id: q.id,
                docNo: q.docNo,
                customer: q.customer,
                total: q.total,
              }))
            : []
        )
      )
      .catch(() => {});

    // Reserved document numbers (ledger, NOT the live /api/billing list) — for
    // the duplicate warning. Survives deletion (separate `used_docnos` table),
    // same pattern as the quotation builder: without this, deleting a document
    // made its number look "free" again to the suggester while the ledger still
    // held the reservation, so the very next auto-suggested number would 409
    // forever.
    // This is the last 7 days only, which is enough to warn on but NOT enough
    // to mint from — `prefixDocs` below covers that.
    fetch("/api/settings/credit-term")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && Number.isFinite(Number(d.days))) setCreditTermDays(Number(d.days));
      })
      .catch(() => {});

    fetch("/api/billing/open-invoices")
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => setOpenInvoices(Array.isArray(list) ? list : []))
      .catch(() => {});

    fetch("/api/billing/docnos")
      .then((r) => (r.ok ? r.json() : []))
      .then((list) =>
        setExistingDocs(
          Array.isArray(list)
            ? list.map((x: { quotationId: string; docNo: string }) => ({
                id: x.quotationId,
                docNo: x.docNo,
              }))
            : []
        )
      )
      .catch(() => {});
  }, [isLoggedIn]);

  // Check if reopening from ?id=...
  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const reopenId = searchParams.get("id");
    const isView = searchParams.get("view") === "1";
    const initialType = searchParams.get("type") as BillingDocType | null;

    if (isView) setIsViewOnly(true);

    if (initialType && ["invoice", "billing_note", "receipt"].includes(initialType) && !reopenId) {
      setB(prev => ({ ...prev, docType: initialType }));
    }

    if (reopenId) {
      setIsEditing(true);
      isFreshRef.current = false; // reopening — don't overwrite docNo
      fetch(`/api/billing/${reopenId}`)
        .then((r) => (r.ok ? r.json() : null))
        .then(async (doc) => {
          if (doc?.data) {
            const isClone = new URLSearchParams(window.location.search).get("action") === "clone";
            let newDocNo = doc.docNo || "";
            let newId = doc.id;
            
            if (isClone) {
              const baseDocNo = newDocNo.replace(/(?:-V|v)\d+$/i, "");

              // Ask the LEDGER for this base, not the live /api/billing list:
              // the ledger is never purged, so it still owns every version
              // number ever issued — including ones whose document has since
              // been deleted, which the live list no longer shows. Reading the
              // live list handed back a "v1" the ledger already owned and the
              // save bounced off the PRIMARY KEY. (Same fix, same reason, as
              // nextVersionDocNo in the quotation builder.)
              let maxV = 0;
              const versions = await fetchLedgerByBases([baseDocNo]);
              if (versions.length === 0) {
                // Ledger unreachable or genuinely empty — fall back to bumping
                // this document's own version rather than reusing v1.
                const vMatch = newDocNo.match(/(?:-V|v)(\d+)$/i);
                if (vMatch) maxV = parseInt(vMatch[1], 10) || 0;
              }
              for (const v of versions) {
                const match = v.docNo.match(/(?:-V|v)(\d+)$/i);
                if (!match) continue;
                const n = parseInt(match[1], 10);
                if (!Number.isNaN(n) && n > maxV) maxV = n;
              }

              newDocNo = `${baseDocNo}v${maxV + 1}`;
              
              // safe fallback for crypto.randomUUID
              newId = typeof crypto !== 'undefined' && crypto.randomUUID 
                ? crypto.randomUUID() 
                : Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

              // Remember the row this new version REPLACES. The server stamps
              // `supersededById` on it inside the same transaction, which is
              // what stops the ledger billing the same debt twice — the old
              // row is never deleted or flagged by this flow otherwise.
              supersedesIdRef.current = doc.id;
            }

            setB({
              ...emptyState(),
              ...doc.data,
              id: newId,
              docType: doc.docType,
              docNo: newDocNo,
              linkedQuotationId: doc.linkedQuotationId,
              // The stored column wins over whatever the blob happens to carry:
              // the ledger's "ตั้งวันครบกำหนด" writes the column directly, so
              // the blob's copy can legitimately be older.
              dueDate: doc.dueDate ?? "",
              settlesDocId: doc.settlesDocId ?? "",
              paymentMethod: doc.paymentMethod ?? DEFAULT_PAYMENT_METHOD,
              paymentDate: doc.paymentDate ?? "",
              paymentRef: doc.paymentRef ?? "",
            });
            setDueDateAuto(false);
            // Snapshot after hydration
            setTimeout(() => setSnapshot(), 0);
          }
        })
        .catch(() => {});
    }
  }, []);

  // The ledger's own view of THIS day's prefixes, both shapes, at any age.
  // Kept out of the render path on purpose: the form shows a provisional number
  // immediately from whatever is already loaded and the effect below advances
  // it the moment this lands, so the admin never waits on a round-trip.
  useEffect(() => {
    if (!isLoggedIn || !b.docDate) return;
    let cancelled = false;
    fetchLedgerByBases(billingDocNoPrefixes(b.docType, b.docDate)).then((rows) => {
      if (!cancelled) setPrefixDocs(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [isLoggedIn, b.docType, b.docDate]);

  // docNo → the id of the document that owns it, across BOTH ledger reads.
  // Numbers under other days'/types' prefixes are harmless here: the allocator
  // ignores them, and the duplicate check only ever looks one number up.
  const knownDocNos = useMemo(() => {
    const owners = new Map<string, string>();
    for (const d of [...existingDocs, ...prefixDocs]) {
      if (d.docNo) owners.set(d.docNo, d.id);
    }
    return owners;
  }, [existingDocs, prefixDocs]);

  // Auto-generate docNo when type or date changes — ONLY for fresh (new) documents.
  // Reopened docs keep their saved docNo.
  useEffect(() => {
    if (!isFreshRef.current || !b.docDate) return;
    const next = nextBillingDocNo(b.docType, b.docDate, [...knownDocNos.keys()]);
    setB((prev) => {
      // Allow update if the current docNo is empty (initial) or matches the last auto-generated one
      if (prev.docNo === "" || prev.docNo === lastAutoDocNoRef.current) {
        lastAutoDocNoRef.current = next;
        return next === prev.docNo ? prev : { ...prev, docNo: next };
      }
      return prev; // user manually edited it
    });
  }, [b.docType, b.docDate, knownDocNos]);

  function showToast(message: string, type: "success" | "error") {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }

  const set = <K extends keyof BillingState>(key: K, value: BillingState[K]) =>
    setB((prev) => ({ ...prev, [key]: value }));

  // ── ครบกำหนดชำระ ──────────────────────────────────────────────────────────
  // DERIVED AT RENDER, not synced into state by an effect: while the document
  // is still following the formula, the box simply SHOWS วันที่ + the credit
  // term, so changing วันที่ moves it with no extra render and no chance of the
  // two drifting. It is materialised into `dueDate` only when the admin types
  // over it (which ends the formula) or when the document is saved.
  //
  // A consequence worth having: an untouched due date never dirties the
  // unsaved-changes fingerprint, so merely opening a document does not make it
  // look edited.
  const formulaDueDate =
    b.docDate && isValidDateString(addDaysToDateString(b.docDate, creditTermDays))
      ? addDaysToDateString(b.docDate, creditTermDays)
      : "";
  const effectiveDueDate = dueDateAuto ? formulaDueDate : b.dueDate;

  // Link to a quotation → auto-fill all data
  async function linkQuotation(quotationId: string) {
    if (!quotationId) {
      setB((prev) => ({ ...prev, linkedQuotationId: null, linkedQuotationDocNo: "" }));
      return;
    }
    setLoadingQuotation(true);
    try {
      const res = await fetch(`/api/quotations/${quotationId}`);
      if (!res.ok) throw new Error();
      const rec = await res.json();
      const data = rec.data || {};
      setB((prev) => ({
        ...prev,
        linkedQuotationId: quotationId,
        linkedQuotationDocNo: rec.docNo || "",
        sellerName: data.sellerName || prev.sellerName,
        sellerPhone: data.sellerPhone || prev.sellerPhone,
        sellerEmail: data.sellerEmail || prev.sellerEmail,
        companyPhone: data.companyPhone || prev.companyPhone,
        companyEmail: data.companyEmail || prev.companyEmail,
        companyTaxId: data.companyTaxId || prev.companyTaxId,
        customerContact: data.customerContact || prev.customerContact,
        customerCompany: data.customerCompany || prev.customerCompany,
        customerTaxId: data.customerTaxId || prev.customerTaxId,
        customerAddress: data.customerAddress || prev.customerAddress,
        customerPhone: data.customerPhone || prev.customerPhone,
        customerEmail: data.customerEmail || prev.customerEmail,
        items: Array.isArray(data.items)
          ? data.items.map((it: any) => {
              const line: QuoteItem = {
                id: crypto.randomUUID(),
                name: it.name || "",
                description: it.description || "",
                imageUrl: it.imageUrl || "",
                qty: it.qty || 1,
                unit: it.unit || "เครื่อง",
                unitPrice: it.unitPrice || 0,
              };
              // Carry the quotation's PER-LINE discount across. Without this the
              // invoice bills the gross price of every discounted line — i.e.
              // more than the customer was quoted. The keys are written only
              // when the quoted line really carries a discount, so importing a
              // quotation saved before the feature produces the same keyless
              // lines (and the same printed sheet) it always did.
              const lineDiscount = Math.max(Number(it.discount) || 0, 0);
              if (lineDiscount > 0) {
                line.discount = lineDiscount;
                if (it.discountType === "percent") line.discountType = "percent";
              }
              return line;
            })
          : prev.items,
        discount: data.discount ?? prev.discount,
        discountType: data.discountType || prev.discountType,
        vatEnabled: data.vatEnabled ?? prev.vatEnabled,
        note: data.note || prev.note,
      }));
      showToast(`นำเข้าข้อมูลจากใบเสนอราคา ${rec.docNo} แล้ว`, "success");
    } catch {
      showToast("ไม่สามารถโหลดข้อมูลใบเสนอราคาได้", "error");
    } finally {
      setLoadingQuotation(false);
    }
  }

  // Totals. `lines` is per-item, in the same order as b.items. Order of
  // operations (quotationTotals.ts): each line is discounted first, then the
  // document-level discount comes off the sum of the discounted lines, then VAT.
  const {
    subtotal,
    lines,
    lineDiscountTotal,
    afterLineDiscounts,
    discountValue,
    afterDiscount,
    vat,
    grandTotal,
  } = computeQuoteTotals(b);

  // Does any imported line actually carry a discount? Gates the whole printed
  // layout: false — every billing document saved before per-line discounts
  // existed, and every one imported from a quotation without them — prints the
  // identical six-column table and single "รวมเป็นเงิน" row it always did.
  const hasLineDiscounts = lineDiscountTotal > 0;

  // Duplicate docNo check — against everything either ledger read has seen.
  const trimmedDocNo = b.docNo.trim();
  const docNoDup =
    trimmedDocNo !== "" && (knownDocNos.get(trimmedDocNo) ?? b.id) !== b.id;

  function postBillingDocument(state: BillingState) {
    // Resolve the formula ONCE, here, so the column, the stored blob and the
    // printed sheet all carry the same due date — the box on screen shows this
    // exact value while the formula is still active.
    // A receipt is evidence money ARRIVED — it has no due date of its own, and
    // storing a meaningless one would put a date in a column every ageing query
    // reads.
    const resolvedDueDate =
      state.docType === "receipt"
        ? ""
        : (dueDateAuto
            ? state.docDate
              ? addDaysToDateString(state.docDate, creditTermDays)
              : ""
            : state.dueDate) || "";
    const dueDate = isValidDateString(resolvedDueDate) ? resolvedDueDate : null;

    return fetch("/api/billing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: state.id,
        docType: state.docType,
        docNo: state.docNo,
        linkedQuotationId: state.linkedQuotationId,
        data: { ...state, dueDate: dueDate ?? "" },
        paymentMethod: state.paymentMethod,
        paymentDate: state.paymentDate,
        paymentRef: state.paymentRef,
        // ครบกำหนดชำระ. NULL means no term was ever agreed, and NULL IS NEVER
        // OVERDUE — that is what keeps documents saved before this feature out
        // of the alert feed until a human opts them in from the ledger.
        dueDate,
        // A receipt that names the invoice it settles records the payment in
        // the same transaction, so issuing a receipt stays one action.
        settlesDocId: state.docType === "receipt" ? state.settlesDocId || null : null,
        // Stamps `supersededById` on the row this new version replaces.
        supersedesId: supersedesIdRef.current,
      }),
    });
  }

  /**
   * The ledger refused this number (409). Re-read it — the whole prefix, not
   * the 7-day window — and move on to the next free one.
   *
   * The INSERT into `used_docnos` remains the only arbiter: two admins minting
   * in the same second still both compute the same number and exactly one of
   * them wins the PRIMARY KEY. This is what happens to the loser, and to
   * anyone who walked into a number issued in another year. Advancing is the
   * whole point — a refusal the admin can only clear by inventing a number by
   * hand is not an outcome this form is allowed to reach.
   *
   * Returns the saved state on success, or null if nothing better was found.
   */
  async function retryWithNextFreeDocNo(
    state: BillingState
  ): Promise<{ state: BillingState; res: Response } | null> {
    const rows = await fetchLedgerByBases(
      billingDocNoPrefixes(state.docType, state.docDate)
    );
    setPrefixDocs(rows);
    const free = nextBillingDocNo(state.docType, state.docDate, [
      ...knownDocNos.keys(),
      ...rows.map((r) => r.docNo),
    ]);
    if (!free || free === state.docNo) return null;
    const advanced = { ...state, docNo: free };
    setB(advanced);
    lastAutoDocNoRef.current = free;
    return { state: advanced, res: await postBillingDocument(advanced) };
  }

  // Save billing document
  async function handleSave() {
    if (docNoDup) {
      showToast("เลขที่เอกสารซ้ำ กรุณาเปลี่ยน", "error");
      return;
    }
    setSaving(true);
    try {
      let state = b;
      let res = await postBillingDocument(state);
      let advancedTo = "";
      if (res.status === 409) {
        const retry = await retryWithNextFreeDocNo(state);
        if (retry) {
          state = retry.state;
          res = retry.res;
          advancedTo = state.docNo;
        }
      }
      if (res.status === 409) {
        const data = await res.json().catch(() => null);
        showToast(data?.error ?? "เลขที่เอกสารซ้ำ", "error");
        return;
      }
      if (!res.ok) throw new Error();
      setSnapshot(); // Mark as saved
      showToast(
        advancedTo
          ? `บันทึกสำเร็จ — เลขที่เดิมถูกใช้แล้ว ระบบเปลี่ยนเป็น ${advancedTo} ให้อัตโนมัติ`
          : "บันทึกสำเร็จ",
        "success"
      );
      router.push(`/billing/saved?tab=${state.docType}`);
    } catch {
      showToast("บันทึกไม่สำเร็จ กรุณาลองใหม่", "error");
    } finally {
      setSaving(false);
    }
  }

  // Generate PDF
  async function handleDownload() {
    if (generating) return;
    if (docNoDup) {
      showToast("เลขที่เอกสารซ้ำ กรุณาเปลี่ยน", "error");
      return;
    }
    setGenerating(true);
    // Save first
    let advancedTo = "";
    try {
      const res = await postBillingDocument(b);
      if (res.status === 409) {
        // Same recovery as handleSave — never rasterise a number the ledger
        // just refused, or the customer gets a PDF for a document that was
        // never saved under that number.
        const retry = await retryWithNextFreeDocNo(b);
        if (retry?.res.ok) advancedTo = retry.state.docNo;
      }
    } catch { /* best-effort */ }

    // Let React repaint the sheet with the new number before html2canvas reads
    // it out of the DOM.
    if (advancedTo) await new Promise((r) => setTimeout(r, 60));

    try {
      const sheet = document.getElementById("billing-sheet");
      if (!sheet) throw new Error("Sheet not found");

      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import("html2canvas-pro"),
        import("jspdf"),
      ]);

      const canvas = await html2canvas(sheet, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
      });

      const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const imgData = canvas.toDataURL("image/jpeg", 0.95);
      pdf.addImage(imgData, "JPEG", 0, 0, pageW, pageH);

      const prefix = BILLING_PREFIX[b.docType];
      // `b` is the pre-advance state in this closure, so name the file after
      // the number that was actually reserved.
      const savedDocNo = advancedTo || b.docNo;
      pdf.save(`${prefix}-${(savedDocNo || "document").replace(/[^\w.-]/g, "_")}.pdf`);
      showToast(
        advancedTo
          ? `ดาวน์โหลด PDF สำเร็จ — เลขที่เดิมถูกใช้แล้ว ระบบเปลี่ยนเป็น ${advancedTo} ให้อัตโนมัติ`
          : "ดาวน์โหลด PDF สำเร็จ",
        "success"
      );
    } catch {
      showToast("สร้าง PDF ไม่สำเร็จ กรุณาลองใหม่", "error");
    } finally {
      setGenerating(false);
    }
  }



  if (isLoading || !isLoggedIn) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin h-8 w-8 border-4 border-orange-400 border-t-transparent rounded-full" />
      </div>
    );
  }

  const label = BILLING_LABELS[b.docType];

  return (
    <div className="min-h-screen bg-gray-100 quote-form">
      {toast && <Toast message={toast.message} type={toast.type} />}

      <style>{`
        .quote-form input[type="number"]::-webkit-inner-spin-button,
        .quote-form input[type="number"]::-webkit-outer-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
        .quote-form input[type="number"] {
          -moz-appearance: textfield;
          appearance: textfield;
        }
        @media print {
          .no-print { display: none !important; }
        }
      `}</style>

      {/* ── Toolbar ── */}
      <div className="no-print sticky top-0 z-20 bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-[1400px] mx-auto px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-gray-900">
              📄 สร้าง{label?.th || "เอกสาร"}
            </h1>
            <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded bg-orange-100 text-orange-700 border border-orange-200">
              {b.docType.replace("_", " ")}
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {!isEditing && (
              <button onClick={() => { if (isDirty) { guardedNavigate("/billing/saved"); } else { router.back(); } }} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-semibold hover:bg-gray-50 transition">
                ← กลับ
              </button>
            )}
            {isEditing && (
              <button onClick={() => guardedNavigate("/adminpanel")} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-semibold hover:bg-gray-50 transition">
                🏠 ระบบจัดการ
              </button>
            )}
            <button onClick={() => guardedNavigate("/billing/saved")} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-semibold hover:bg-gray-50 transition">
              📋 เอกสารที่บันทึกไว้
            </button>

            {!isViewOnly && (
              <button
                onClick={handleSave}
                disabled={saving || docNoDup}
                className="px-5 py-2 rounded-lg border border-green-500 text-green-600 text-sm font-bold hover:bg-green-50 transition disabled:opacity-50"
              >
                {saving ? "กำลังบันทึก..." : "💾 บันทึก"}
              </button>
            )}
            {isViewOnly && (
              <Link
                href={`/billing?id=${encodeURIComponent(b.id)}&action=clone`}
                className="px-5 py-2 rounded-lg border border-blue-500 text-blue-600 text-sm font-bold hover:bg-blue-50 transition"
              >
                ✏️ แก้ไข (New Ver.)
              </Link>
            )}

            {isViewOnly && (
              <button
                onClick={handleDownload}
                disabled={generating || docNoDup}
                className="px-5 py-2 rounded-lg bg-orange-500 text-white text-sm font-bold hover:bg-orange-600 transition shadow-sm disabled:opacity-50"
              >
                {generating ? "กำลังสร้าง..." : "⬇️ ดาวน์โหลด PDF"}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className={`max-w-[1400px] mx-auto px-4 py-6 flex gap-6 flex-col lg:flex-row ${isViewOnly ? "justify-center" : ""}`}>
        {/* ── Left: Form ── */}
        {!isViewOnly && (
        <div className="no-print w-full lg:w-[440px] shrink-0 space-y-4">
          {/* Link to Quotation */}
          <div className="bg-white rounded-xl shadow-sm p-4 space-y-3">
            <h2 className="font-bold text-gray-800">🔗 เชื่อมกับใบเสนอราคา</h2>
            <SearchableDropdown
              value={b.linkedQuotationId ?? ""}
              onChange={(val) => linkQuotation(val)}
              options={[
                { value: "", label: "-- ไม่เชื่อม --" },
                ...quotations.map((q) => ({
                  value: q.id,
                  label: `${q.docNo} — ${q.customer} (${fmt(q.total)})`,
                })),
              ]}
              placeholder="ค้นหาใบเสนอราคา..."
            />
            {loadingQuotation && (
              <p className="text-sm text-orange-600 animate-pulse">กำลังโหลดข้อมูล...</p>
            )}
            {b.linkedQuotationDocNo && (
              <p className="text-xs text-green-600">✅ เชื่อมกับ: {b.linkedQuotationDocNo}</p>
            )}
          </div>

          {/* Document Info */}
          <div className="bg-white rounded-xl shadow-sm p-4 space-y-3">
            <h2 className="font-bold text-gray-800">📋 ข้อมูลเอกสาร</h2>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">เลขที่เอกสาร</label>
              <input
                value={b.docNo}
                onChange={(e) => set("docNo", e.target.value)}
                className={`w-full px-3 py-2 border rounded-lg text-sm ${
                  docNoDup ? "border-red-400 bg-red-50" : "border-gray-300"
                }`}
              />
              {docNoDup && (
                <p className="text-xs text-red-500 mt-1">⚠️ เลขที่ซ้ำ</p>
              )}
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">วันที่</label>
              <input
                type="date"
                value={b.docDate}
                onChange={(e) => set("docDate", e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>

            {/* ── ครบกำหนดชำระ ──────────────────────────────────────────────
                Only on the documents that can carry a debt. A receipt is
                evidence money ARRIVED; it never has a due date of its own. */}
            {b.docType !== "receipt" && (
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">
                  ครบกำหนดชำระ
                </label>
                <input
                  type="date"
                  value={effectiveDueDate}
                  onChange={(e) => {
                    // Any keystroke here ends the formula for this document —
                    // from now on วันที่ moves on its own.
                    setDueDateAuto(false);
                    set("dueDate", e.target.value);
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <p className="text-[11px] text-gray-400">
                    ค่าเริ่มต้น: เครดิต {creditTermDays} วัน
                    {effectiveDueDate ? ` (${formatDisplayDate(effectiveDueDate)})` : ""}
                  </p>
                  {/* Derived for display, never stored — the same reasoning
                      that stops a line being stamped with `discount: 0`. */}
                  {effectiveDueDate &&
                    b.docDate &&
                    effectiveDueDate !== formulaDueDate && (
                      <span className="text-[10px] font-bold text-orange-600 bg-orange-100 px-2 py-0.5 rounded-full">
                        แก้ไขเอง
                      </span>
                    )}
                </div>
                {/* Backdated terms are real, so this warns rather than blocks. */}
                {effectiveDueDate && b.docDate && effectiveDueDate < b.docDate && (
                  <p className="text-[11px] text-amber-600 mt-1">
                    ⚠️ วันครบกำหนดอยู่ก่อนวันที่เอกสาร
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Customer Info */}
          <div className="bg-white rounded-xl shadow-sm p-4 space-y-3">
            <h2 className="font-bold text-gray-800">👤 ข้อมูลลูกค้า</h2>
            {[
              { key: "customerCompany" as const, label: "บริษัท/ชื่อลูกค้า" },
              { key: "customerTaxId" as const, label: "เลขประจำตัวผู้เสียภาษี" },
              { key: "customerContact" as const, label: "ผู้ติดต่อ" },
              { key: "customerAddress" as const, label: "ที่อยู่" },
              { key: "customerPhone" as const, label: "โทรศัพท์" },
              { key: "customerEmail" as const, label: "อีเมล" },
            ].map((f) => (
              <div key={f.key}>
                <label className="block text-xs font-semibold text-gray-500 mb-1">{f.label}</label>
                {f.key === "customerAddress" ? (
                  <textarea
                    value={b[f.key]}
                    onChange={(e) => set(f.key, e.target.value)}
                    rows={2}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                ) : (
                  <input
                    value={b[f.key]}
                    onChange={(e) => set(f.key, e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                )}
              </div>
            ))}
          </div>

          {/* Seller Info */}
          <div className="bg-white rounded-xl shadow-sm p-4 space-y-3">
            <h2 className="font-bold text-gray-800">🏢 ข้อมูลผู้ขาย</h2>
            {[
              { key: "companyPhone" as const, label: "เบอร์โทรบริษัท" },
              { key: "companyEmail" as const, label: "อีเมลบริษัท" },
              { key: "companyTaxId" as const, label: "เลขประจำตัวผู้เสียภาษี" },
              { key: "sellerName" as const, label: "ชื่อพนักงานขาย" },
              { key: "sellerPhone" as const, label: "เบอร์พนักงานขาย" },
            ].map((f) => (
              <div key={f.key}>
                <label className="block text-xs font-semibold text-gray-500 mb-1">{f.label}</label>
                <input
                  value={b[f.key]}
                  onChange={(e) => set(f.key, e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </div>
            ))}
          </div>

          {/* Payment Info (Receipt only) */}
          {b.docType === "receipt" && (
            <div className="bg-white rounded-xl shadow-sm p-4 space-y-3">
              <h2 className="font-bold text-gray-800">💳 ข้อมูลการชำระเงิน</h2>

              {/* ── ชำระให้ใบแจ้งหนี้ ────────────────────────────────────────
                  An ใบเสร็จรับเงิน DISCHARGES debt; it never creates it. Naming
                  the invoice it settles is what makes issuing the receipt also
                  record the payment — the server writes both in ONE
                  transaction. Leaving it blank settles nothing, and the ledger
                  says so rather than guessing which invoice this belonged to. */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">
                  ชำระให้ใบแจ้งหนี้
                </label>
                <SearchableDropdown
                  value={b.settlesDocId}
                  onChange={(val) => set("settlesDocId", val)}
                  options={[
                    { value: "", label: "-- ยังไม่ผูกกับใบแจ้งหนี้ --" },
                    ...openInvoices.map((inv) => ({
                      value: inv.id,
                      label: `${inv.docNo} — ${inv.customerName} (ค้าง ${fmt(inv.outstanding)})`,
                    })),
                  ]}
                  placeholder="ค้นหาใบแจ้งหนี้..."
                />
                {!b.settlesDocId && (
                  <p className="text-[11px] text-amber-600 mt-1">
                    ใบเสร็จนี้ยังไม่ได้ผูกกับใบแจ้งหนี้ — ยอดค้างของลูกค้าจะยังไม่ลดลง
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">ช่องทางชำระเงิน</label>
                <SearchableDropdown
                  value={b.paymentMethod}
                  onChange={(val) => set("paymentMethod", val)}
                  options={PAYMENT_METHODS.map((m) => ({ value: m, label: m }))}
                  placeholder="เลือกช่องทาง..."
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">วันที่ชำระเงิน</label>
                <input
                  type="date"
                  value={b.paymentDate}
                  onChange={(e) => set("paymentDate", e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">เลขอ้างอิง</label>
                <input
                  value={b.paymentRef}
                  onChange={(e) => set("paymentRef", e.target.value)}
                  placeholder="เลขที่โอน / เลขที่เช็ค"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </div>
            </div>
          )}

          {/* Note */}
          <div className="bg-white rounded-xl shadow-sm p-4 space-y-3">
            <h2 className="font-bold text-gray-800">📝 หมายเหตุ</h2>
            <textarea
              value={b.note}
              onChange={(e) => set("note", e.target.value)}
              rows={3}
              placeholder="หมายเหตุเพิ่มเติม..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>
        </div>
        )}

        {/* ── Right: A4 Preview ── */}
        <div className={`flex-1 flex ${isViewOnly ? "justify-center" : "justify-start"} overflow-x-auto`}>
          <div
            id="billing-sheet"
            className="bg-white shadow-lg border border-gray-200 rounded-sm mx-auto text-gray-900"
            style={{
              width: "210mm",
              minHeight: "297mm",
              padding: "12mm 14mm",
              fontSize: "13px",
              lineHeight: "1.55",
            }}
          >
            {/* ── Accent color strip at top ── */}
            <div
              className="rounded-t-sm"
              style={{
                height: "4px",
                marginTop: "-12mm",
                marginLeft: "-14mm",
                marginRight: "-14mm",
                marginBottom: "10mm",
                background: b.docType === "invoice"
                  ? "linear-gradient(90deg, #1e40af, #3b82f6)"
                  : b.docType === "billing_note"
                    ? "linear-gradient(90deg, #6b21a8, #a855f7)"
                    : "linear-gradient(90deg, #15803d, #22c55e)",
              }}
            />

            {/* ── Header ── */}
            <div className="flex justify-between items-start gap-4 pb-3" style={{ borderBottom: "2.5px solid #1f2937" }}>
              <div className="flex items-start gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/images/profin-logo-3.png"
                  alt="Profin Lab Scale"
                  className="shrink-0 object-contain"
                  style={{ width: "11mm", height: "auto" }}
                />
                <div>
                  <div className="text-lg font-bold">{COMPANY.name}</div>
                  <div className="text-xs text-gray-600">{COMPANY.nameEn}</div>
                  <div className="text-xs mt-1 max-w-[95mm] whitespace-pre-line">{COMPANY.address}</div>
                  <div className="text-xs mt-0.5">
                    {b.companyPhone && <>โทร {b.companyPhone} </>}
                    {b.companyEmail && <>อีเมล {b.companyEmail}</>}
                  </div>
                  {b.companyTaxId && (
                    <div className="text-xs">เลขประจำตัวผู้เสียภาษี {b.companyTaxId}</div>
                  )}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div
                  className="text-2xl font-bold tracking-wide"
                  style={{
                    color: b.docType === "invoice"
                      ? "#1e40af"
                      : b.docType === "billing_note"
                        ? "#6b21a8"
                        : "#15803d",
                  }}
                >
                  {label.th}
                </div>
                <div className="text-sm text-gray-500 tracking-widest">{label.en}</div>
              </div>
            </div>

            {/* ── Doc info + Customer ── */}
            <div id="billing-customer-info" className="flex justify-between gap-6 mt-3 text-[12.5px]">
              <div className="flex-1">
                <div className="font-bold text-gray-700 mb-1">เรียน (To)</div>
                <div className="font-semibold">{b.customerContact || "-"}</div>
                {b.customerCompany && <div>{b.customerCompany}</div>}
                {b.customerAddress && <div className="whitespace-pre-line text-gray-700">{b.customerAddress}</div>}
                {b.customerPhone && <div className="text-gray-700">โทร {b.customerPhone}</div>}
                {b.customerEmail && <div className="text-gray-700 break-all">อีเมล {b.customerEmail}</div>}
                {b.customerTaxId && <div className="text-gray-700">เลขประจำตัวผู้เสียภาษี: {b.customerTaxId}</div>}
              </div>
              <table className="shrink-0 self-start text-[12.5px]">
                <tbody>
                  <tr>
                    <td className="pr-3 py-0.5 font-bold text-gray-700 text-right">เลขที่ (No.)</td>
                    <td className="py-0.5 text-right font-semibold">{b.docNo || "-"}</td>
                  </tr>
                  <tr>
                    <td className="pr-3 py-0.5 font-bold text-gray-700 text-right">วันที่ (Date)</td>
                    <td className="py-0.5 text-right">{thaiDate(b.docDate)}</td>
                  </tr>
                  {b.linkedQuotationDocNo && (
                    <tr>
                      <td className="pr-3 py-0.5 font-bold text-gray-700 text-right">อ้างอิง (Ref.)</td>
                      <td className="py-0.5 text-right">{b.linkedQuotationDocNo}</td>
                    </tr>
                  )}
                  {b.sellerName && (
                    <tr>
                      <td className="pr-3 py-0.5 font-bold text-gray-700 align-top text-right pt-1.5">พนักงานขาย</td>
                      <td className="py-0.5 text-right pt-1.5">
                        <div className="text-gray-900">{b.sellerName}</div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* ── Items Table ── */}
            <table id="billing-table" className="w-full mt-4 border-collapse text-[12.5px]">
              <thead>
                <tr className="text-white" style={{ backgroundColor: b.docType === "invoice" ? "#1e40af" : b.docType === "billing_note" ? "#6b21a8" : "#15803d" }}>
                  <th className="border border-gray-800 px-2 py-1.5 w-[8mm] border-r-white/20">ลำดับ</th>
                  <th className="border border-gray-800 px-2 py-1.5 text-left border-r-white/20">รายการ</th>
                  <th className="border border-gray-800 px-2 py-1.5 w-[14mm] border-r-white/20">จำนวน</th>
                  <th className="border border-gray-800 px-2 py-1.5 w-[14mm] border-r-white/20">หน่วย</th>
                  <th className="border border-gray-800 px-2 py-1.5 w-[24mm] border-r-white/20">ราคา/หน่วย</th>
                  {/* The discount column exists ONLY when a line actually
                      carries one, so a document with no per-line discounts
                      prints the identical six-column table it always did. */}
                  {hasLineDiscounts && (
                    <th className="border border-gray-800 px-2 py-1.5 w-[22mm] border-r-white/20">ส่วนลด</th>
                  )}
                  <th className="border border-gray-800 px-2 py-1.5 w-[26mm]">จำนวนเงิน</th>
                </tr>
              </thead>
              <tbody id="billing-tbody">
                {b.items.length === 0 ? (
                  <tr>
                    <td colSpan={hasLineDiscounts ? 7 : 6} className="border border-gray-300 px-3 py-8 text-center text-gray-400">
                      — ยังไม่มีรายการ — เชื่อมกับใบเสนอราคาเพื่อนำเข้า
                    </td>
                  </tr>
                ) : (
                  b.items.map((item, idx) => (
                    <tr key={item.id} className="align-top">
                      <td className="border border-gray-300 px-2 py-1.5 text-center">{idx + 1}</td>
                      <td className="border border-gray-300 px-2 py-1.5">
                        <div className="font-bold text-gray-800">{item.name || "-"}</div>
                        {item.description && (
                          <div className="mt-0.5 text-gray-600 whitespace-pre-line leading-snug text-[11.5px]">{item.description}</div>
                        )}
                      </td>
                      <td className="border border-gray-300 px-2 py-1.5 text-center">{item.qty}</td>
                      <td className="border border-gray-300 px-2 py-1.5 text-center">{item.unit}</td>
                      <td className="border border-gray-300 px-2 py-1.5 text-right">{fmt(item.unitPrice)}</td>
                      {hasLineDiscounts && (
                        <td className="border border-gray-300 px-2 py-1.5 text-right">
                          {(lines[idx]?.discountValue ?? 0) > 0 ? (
                            <>
                              -{fmt(lines[idx].discountValue)}
                              {item.discountType === "percent" && (
                                <div className="text-[11px] text-gray-500">({item.discount}%)</div>
                              )}
                            </>
                          ) : (
                            "-"
                          )}
                        </td>
                      )}
                      {/* With no line discounts this is the exact expression the
                          sheet has always printed; with them it prints the net,
                          which is what the totals below add up to. */}
                      <td className="border border-gray-300 px-2 py-1.5 text-right">
                        {fmt(hasLineDiscounts ? lines[idx].netAmount : item.qty * item.unitPrice)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            {/* ── Totals + Note / Payment ── */}
            <div id="billing-footer" className="flex justify-between gap-6 mt-3">
              <div className="flex-1 text-[12px]">
                {b.docType === "receipt" && (
                  <div className="mb-4 space-y-0.5 text-gray-700">
                    <div className="font-bold text-gray-800">การชำระเงิน / Payment</div>
                    <div><span className="font-semibold">ช่องทาง:</span> {b.paymentMethod || "-"}</div>
                    <div><span className="font-semibold">วันที่ชำระ:</span> {b.paymentDate ? thaiDate(b.paymentDate) : "-"}</div>
                    {b.paymentRef && <div><span className="font-semibold">เลขอ้างอิง:</span> {b.paymentRef}</div>}
                  </div>
                )}
                {b.note && (
                  <div className="mt-3 space-y-0.5 text-gray-700">
                    <div className="font-bold text-gray-800">หมายเหตุ</div>
                    <div className="whitespace-pre-line">{b.note}</div>
                  </div>
                )}
              </div>

              <table className="shrink-0 self-start w-[70mm] text-[12.5px]">
                <tbody>
                  {/* Without line discounts: the single "รวมเป็นเงิน" row the
                      sheet has always had. With them: the gross first, the line
                      discounts taken off, and "รวมเป็นเงิน" left equal to the
                      SUM OF THE PRINTED LINE AMOUNTS — so the customer can still
                      add the column up and land on it. */}
                  {hasLineDiscounts ? (
                    <>
                      <tr>
                        <td className="py-1 pr-2">รวมราคาก่อนหักส่วนลด</td>
                        <td className="py-1 text-right">{fmt(subtotal)}</td>
                      </tr>
                      <tr>
                        <td className="py-1 pr-2">ส่วนลดรายรายการ</td>
                        <td className="py-1 text-right">-{fmt(lineDiscountTotal)}</td>
                      </tr>
                      <tr>
                        <td className="py-1 pr-2">รวมเป็นเงิน</td>
                        <td className="py-1 text-right">{fmt(afterLineDiscounts)}</td>
                      </tr>
                    </>
                  ) : (
                    <tr>
                      <td className="py-1 pr-2">รวมเป็นเงิน</td>
                      <td className="py-1 text-right">{fmt(subtotal)}</td>
                    </tr>
                  )}
                  {discountValue > 0 && (
                    <>
                      <tr>
                        <td className="py-1 pr-2">
                          {hasLineDiscounts ? "ส่วนลดท้ายใบ" : "ส่วนลด"}
                          {b.discountType === "percent" ? ` ${b.discount}%` : ""}
                        </td>
                        <td className="py-1 text-right">-{fmt(discountValue)}</td>
                      </tr>
                      <tr>
                        <td className="py-1 pr-2">ยอดหลังหักส่วนลด</td>
                        <td className="py-1 text-right">{fmt(afterDiscount)}</td>
                      </tr>
                    </>
                  )}
                  {b.vatEnabled && (
                    <tr>
                      <td className="py-1 pr-2">ภาษีมูลค่าเพิ่ม 7%</td>
                      <td className="py-1 text-right">{fmt(vat)}</td>
                    </tr>
                  )}
                  <tr className="font-bold text-[14px] border-t-2 border-gray-800">
                    <td className="py-1.5 pr-2">จำนวนเงินรวมทั้งสิ้น</td>
                    <td className="py-1.5 text-right">{fmt(grandTotal)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* ── Signatures ── */}
            <div id="billing-signatures" className="grid grid-cols-3 gap-6 mt-10 text-center text-[12px]">
              {[
                { title: b.docType === "invoice" ? "ผู้ออกเอกสาร (Authorized Signature)" : b.docType === "billing_note" ? "ผู้วางบิล (Biller)" : "ผู้รับเงิน (Collector)", name: b.sellerName },
                null,
                { title: b.docType === "invoice" ? "ผู้รับเอกสาร (Received By)" : b.docType === "billing_note" ? "ผู้รับบิล (Received By)" : "ผู้จ่ายเงิน (Payer)", name: "" },
              ].map((s, idx) => 
                s ? (
                  <div key={s.title}>
                    <div className="border-b border-gray-400 h-12 mb-2" />
                    <div className="min-h-[18px] mt-2 text-gray-800">{s.name || "(....................................)"}</div>
                    <div className="font-bold mt-2">{s.title}</div>
                    <div className="text-gray-500 mt-2">วันที่ ______ / ______ / ______</div>
                  </div>
                ) : (
                  <div key={`empty-${idx}`} />
                )
              )}
            </div>
          </div>
        </div>
      </div>

      <LeaveGuardModal
        show={showModal}
        onSave={async () => { setShowModal(false); await handleSave(); }}
        onDiscard={confirmLeave}
        onCancel={cancelLeave}
        saving={saving}
        saveDisabled={docNoDup}
        documentLabel={label?.th || "เอกสาร"}
      />
    </div>
  );
}
