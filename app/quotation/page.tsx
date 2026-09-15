"use client";
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../context/AuthContext";
import Toast from "../components/Toast";
import {
  DOCNO_START,
  pad2,
  nextDocNo,
  quotationDocNoPrefix,
  quotationDocNoPrefixes,
} from "../lib/quotationNumber";
import { toLocalDateString } from "../lib/dateFormat";
import {
  computeQuoteTotals,
  setLineDiscountAmount,
  setLineDiscountType,
} from "../lib/quotationTotals";
import { stripHtml } from "../lib/stripHtml";
import { selectPartyFromSystem, applyTypedPartyName } from "../lib/quotationToSale";
import SearchableDropdown from "../components/SearchableDropdown";
import FormattedNumberInput from "../components/FormattedNumberInput";
import ConfirmDialog from "../components/ConfirmDialog";
import ImageDeleteConfirmDialog, { type OrphanedImage } from "../components/ImageDeleteConfirmDialog";

// ── ใบเสนอราคา (Quotation builder) ──────────────────────────────────────────
// Admin-only tool: fill the form on the left, see a live A4 sheet on the right,
// then "ดาวน์โหลด PDF" prints ONLY the sheet via the browser's Save-as-PDF —
// vector output with perfect Thai text and zero server-side PDF dependencies
// (deliberate: heavy PDF/DOM libs have already broken this app on Vercel once).
// A draft autosaves to localStorage so a refresh doesn't lose work.

// Seller identity (fixed per the business):
const COMPANY = {
  name: "บริษัท โปรฟิน แล็บสเกล จำกัด",
  nameEn: "PROFIN LAB SCALE CO., LTD.",
  address:
    "93 ซอยงามวงศ์วาน 6 แยก 19 ถนนงามวงศ์วาน\nตำบลบางเขน อำเภอเมืองนนทบุรี จ.นนทบุรี 11000",
};

interface QuoteItem {
  id: string;
  productId?: string; // Links back to product for specs
  name: string; // ชื่อเครื่อง / รุ่น
  description: string; // สเปค / รายละเอียดเพิ่มเติม
  imageUrl: string;
  imageUploaded: boolean; // true = uploaded for this quote (deletable); false = from catalog
  qty: number;
  unit: string; // เครื่อง / ชุด / ตัว
  unitPrice: number;
  // ── ส่วนลดรายรายการ (task 7) ────────────────────────────────────────────
  // OPTIONAL on purpose. A quotation is one JSON blob, so every quote saved
  // before per-line discounts existed simply has NO such key — that is
  // `undefined`, which `computeLineTotal` reads as "no discount" and passes the
  // line amount through untouched. The keys are therefore never written unless
  // the user actually types a discount, so reopening an old quote leaves its
  // blob (and its unsaved-changes fingerprint) byte-for-byte unchanged.
  discount?: number;
  /** How to read `discount` — mirrors the document-level field. */
  discountType?: "amount" | "percent";
}

interface QuoteState {
  id: string; // stable key for the saved-quotation record
  docNo: string;
  docDate: string; // yyyy-mm-dd (input[type=date])
  validDays: number; // ยืนราคา (วัน)
  sellerId?: string;
  sellerName: string;
  sellerPhone: string;
  sellerEmail: string;
  companyPhone: string;
  companyEmail: string;
  companyTaxId: string;
  customerContact: string;
  customerCompany: string;
  // Soft links back to the rows in `customers` / `companies` the two names were
  // picked from (task 14.1). OPTIONAL on purpose: the whole document is stored
  // as one JSON blob in `quotations.data`, so every quotation saved before this
  // existed simply has no such key — that is `undefined`, never an error, and
  // the sale form falls back to matching by name (task 14.4). An id is only
  // ever written together with the name it belongs to, and is cleared the
  // moment the name is typed over, so the two can never disagree.
  customerId?: string;
  companyId?: string;
  customerAddress: string;
  customerPhone: string;
  customerEmail: string;
  items: QuoteItem[];
  discount: number;
  discountType: "amount" | "percent";
  vatEnabled: boolean;
  paymentTerms?: string;
  deliveryTerms?: string;
  warrantyTerms?: string;
  conditions: { id: string; label: string; value: string }[];
  note: string;
}

interface ProductItem {
  id: string;
  title_th: string;
  title_en: string;
  image: string;
}

const DRAFT_KEY = "quotation-draft-v1";

function newItem(): QuoteItem {
  return {
    id: crypto.randomUUID(),
    name: "",
    description: "",
    imageUrl: "",
    imageUploaded: false,
    qty: 1,
    unit: "เครื่อง",
    unitPrice: 0,
  };
}

// crypto.randomUUID isn't available on every browser/context this admin tool is
// opened from (old iOS Safari, plain-http LAN access), so fall back rather than
// throw halfway through building a document.
function randomId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).substring(2, 15) +
        Math.random().toString(36).substring(2, 15);
}

// Strip a trailing version marker: "QT050926-23v2" / "…-V2" → "QT050926-23".
// Format-agnostic on purpose — it must keep working for the legacy YYMMDD
// numbers that are already out with customers (see quotationNumber.ts).
const baseOfDocNo = (docNo: string) => docNo.replace(/(?:-V|v)\d+$/i, "");

/** Does this number already carry a version suffix ("…-23v2")? */
const hasVersionSuffix = (docNo: string) => /(?:-V|v)\d+$/i.test(docNo.trim());

/**
 * The owner we file a number under when the SERVER has just refused it: we know
 * `used_docnos` owns it, we do not know which quotation owns it, and "not this
 * document" is the whole of what the duplicate guard needs.
 */
const TAKEN_BY_ANOTHER = "__taken__";

const emptyState = (): QuoteState => ({
  id: "",
  docNo: "",
  docDate: "",
  validDays: 30,
  sellerName: "",
  sellerPhone: "",
  sellerEmail: "",
  companyPhone: "",
  companyEmail: "",
  companyTaxId: "",
  customerContact: "",
  customerCompany: "",
  customerAddress: "",
  customerPhone: "",
  customerEmail: "",
  items: [],
  discount: 0,
  discountType: "amount",
  vatEnabled: true,
  conditions: [
    { id: crypto.randomUUID(), label: "เงื่อนไขชำระเงิน", value: "ชำระเงิน 100% ก่อนส่งมอบสินค้า" },
    { id: crypto.randomUUID(), label: "กำหนดส่งมอบ", value: "30-45 วัน หลังยืนยันการสั่งซื้อ" },
    { id: crypto.randomUUID(), label: "การรับประกัน", value: "รับประกันสินค้า 1 ปี" },
  ],
  note: "",
});

const fmt = (n: number) =>
  n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function migrateQuoteState(state: any): QuoteState {
  if (!state.conditions || !Array.isArray(state.conditions)) {
    const conditions = [];
    if (state.paymentTerms) conditions.push({ id: crypto.randomUUID(), label: "เงื่อนไขชำระเงิน", value: state.paymentTerms });
    if (state.deliveryTerms) conditions.push({ id: crypto.randomUUID(), label: "กำหนดส่งมอบ", value: state.deliveryTerms });
    if (state.warrantyTerms) conditions.push({ id: crypto.randomUUID(), label: "การรับประกัน", value: state.warrantyTerms });
    state.conditions = conditions.length > 0 ? conditions : emptyState().conditions;
  }
  return state as QuoteState;
}

// A number field that keeps the user's RAW text (so partial values like "0.5"
// aren't clobbered by controlled-input reconciliation) and shows a placeholder
// when empty instead of a pre-filled 0. Emits a clamped (>= 0) number.
function NumberInput({
  value,
  onChange,
  className,
  placeholder,
}: {
  value: number;
  onChange: (value: number) => void;
  className?: string;
  placeholder?: string;
}) {
  const [text, setText] = useState(value === 0 ? "" : String(value));
  useEffect(() => {
    // Resync when the value changes from outside (reset / reopen / autofill).
    if ((Number(text) || 0) !== value) setText(value === 0 ? "" : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      type="text"
      inputMode="decimal"
      className={className}
      placeholder={placeholder}
      value={text}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw !== "" && !/^\d*\.?\d*$/.test(raw)) return; // digits + one dot
        setText(raw);
        onChange(Math.max(0, Number(raw) || 0));
      }}
    />
  );
}

const thaiDate = (iso: string) => {
  if (!iso) return "-";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const months = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  return `${d} ${months[m - 1]} ${y + 543}`;
};

function formatAddress(comp: any) {
  const parts = [];
  if (comp.addressNo) parts.push(comp.addressNo);
  if (comp.moo) parts.push(`ม.${comp.moo}`);
  if (comp.soi) parts.push(`ซ.${comp.soi}`);
  if (comp.road) parts.push(`ถ.${comp.road}`);
  if (comp.subDistrict) parts.push(`ต.${comp.subDistrict}`);
  if (comp.district) parts.push(`อ.${comp.district}`);
  if (comp.province) parts.push(`จ.${comp.province}`);
  if (comp.postalCode) parts.push(comp.postalCode);
  return parts.join(' ');
}

function formatPhone(phone: string) {
  if (!phone) return phone;
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 9) {
    return `${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5)}`;
  }
  return phone;
}

export default function QuotationPage() {
  const router = useRouter();
  const { isLoggedIn, isLoading } = useAuth();
  const [q, setQ] = useState<QuoteState>(emptyState);
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [dbCompanies, setDbCompanies] = useState<any[]>([]);
  const [dbCustomers, setDbCustomers] = useState<any[]>([]);
  const [dbSalespeople, setDbSalespeople] = useState<any[]>([]);
  const [dbProductSpecs, setDbProductSpecs] = useState<any[]>([]);
  // ── The TWO reserved-number ledgers, and what each is allowed to do ───────
  // `existingDocs` — GET /api/quotations/docnos with NO base: the last ~7 days
  // across every prefix. It exists to WARN that a hand-typed number is one of
  // this week's. It may NEVER mint one (see `dayLedger`).
  const [existingDocs, setExistingDocs] = useState<{ id: string; docNo: string }[]>([]);
  // `dayLedger` — GET …?base=<each of the day's TWO prefixes>: every number
  // EVER issued under them, unwindowed. This is the only list a new number may
  // be minted from. A day's current DDMMYY prefix is another day's legacy
  // YYMMDD prefix a year earlier (25 Oct 2026 → "QT251026-" ← 26 Oct 2025), and
  // those 2025 numbers sit outside the 7-day window while used_docnos owns them
  // forever — minting from the window hands back a number the PRIMARY KEY then
  // refuses, and pressing บันทึก again handed back the very same number.
  // Tagged with the date it was read FOR, so yesterday's answer can never be
  // mistaken for today's.
  const [dayLedger, setDayLedger] = useState<
    { forDate: string; docs: { id: string; docNo: string }[]; failed: boolean } | null
  >(null);
  // Bumped by the "ลองใหม่" button under the number field: reading the day's
  // ledger is the ONLY thing that lets the page issue a number (see the mint
  // effect), so a failed read has to be retryable without reloading the page.
  const [docNoLedgerAttempt, setDocNoLedgerAttempt] = useState(0);
  const [uploadingItemId, setUploadingItemId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false); // building the PDF

  const [savePrompt, setSavePrompt] = useState(false); // "keep 30d or delete now?" after download
  const [deletingQuote, setDeletingQuote] = useState(false);
  const [orphanedImages, setOrphanedImages] = useState<OrphanedImage[]>([]);
  const [savingQuote, setSavingQuote] = useState(false); // "เซฟ" (save without printing)
  const [showResetConfirm, setShowResetConfirm] = useState(false); // reset form modal
  const [isViewOnly, setIsViewOnly] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  // Set while the open document is an UNSAVED new version of a saved quotation
  // (clone mode). Carries the source so the toolbar can name it — a clone is a
  // draft of a document that does not exist in the DB yet, and the admin must
  // never be left guessing which quotation he is looking at (task 6).
  const [cloneSource, setCloneSource] = useState<{ id: string; docNo: string } | null>(null);
  const [startingNewVersion, setStartingNewVersion] = useState(false);
  const [showEditOriginalConfirm, setShowEditOriginalConfirm] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false); // unsaved-changes modal
  const [pendingNav, setPendingNav] = useState<string | null>(null); // URL to navigate after confirm
  const imageInputRef = useRef<HTMLInputElement>(null);
  const uploadTargetRef = useRef<string | null>(null);
  const hydratedRef = useRef(false);
  const lastAutoDocNoRef = useRef<string | null>(null);
  // Snapshot of the state at the time of last save/load — used to detect dirty state.
  const savedSnapshotRef = useRef<string>("");
  // A brand-new quote (not a reopened/restored one) — eligible to auto-advance
  // its running number once the reserved-numbers ledger loads.
  const isFreshRef = useRef(false);

  // Redirect if not logged in (same client gate as the other admin pages)
  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace("/login");
  }, [isLoggedIn, isLoading, router]);

  // Adopt a state as "the document currently open": it becomes the state AND
  // the clean snapshot, so isDirty only fires on edits made from here on.
  function adoptState(next: QuoteState) {
    setQ(next);
    const { id: _id, ...rest } = next;
    savedSnapshotRef.current = JSON.stringify(rest);
  }

  const seedFresh = useCallback(() => {
    const iso = toLocalDateString(new Date());
    isFreshRef.current = true;
    setCloneSource(null);
    // A brand-new number is minted in the CURRENT shape (QT + DDMMYY + -NN).
    // The auto-advance effect below then walks it past the day's used numbers,
    // in BOTH shapes — see quotationDocNoPrefixes().
    const newDocNo = `${quotationDocNoPrefix(iso)}${pad2(DOCNO_START)}`;
    lastAutoDocNoRef.current = newDocNo;
    setQ({
      ...emptyState(),
      id: randomId(),
      docDate: iso,
      docNo: newDocNo,
      items: [newItem()],
    });
  }, []);

  /**
   * The docNo the NEXT version of `docNo` should carry — "QT050926-23" →
   * "QT050926-23v1", then v2, … Reads the ledger directly rather than the
   * `existingDocs` state so it can't race the fetch that fills it.
   * Never parses the date out of the number, so legacy YYMMDD numbers version
   * exactly like current DDMMYY ones.
   *
   * Asks for THIS BASE's numbers (`?base=`), not the recent-numbers window that
   * `existingDocs` holds: quotations live for two years, so the document being
   * versioned is normally months old and its v1 is long outside that window.
   * Reading the window instead would keep handing back "v1" for every new
   * version, and the save would bounce off the ledger's PRIMARY KEY with a
   * duplicate-number error the admin has no way to clear.
   */
  async function nextVersionDocNo(docNo: string): Promise<string> {
    const base = baseOfDocNo(docNo);
    let maxV = 0;
    try {
      const res = await fetch(
        `/api/quotations/docnos?base=${encodeURIComponent(base)}`
      );
      const list = await res.json();
      const docs: { docNo?: string }[] = Array.isArray(list) ? list : [];
      for (const d of docs) {
        if (!d?.docNo || !d.docNo.startsWith(base)) continue;
        const match = d.docNo.match(/(?:-V|v)(\d+)$/i);
        if (match) {
          const v = parseInt(match[1], 10);
          if (!Number.isNaN(v) && v > maxV) maxV = v;
        }
      }
    } catch {
      // Ledger unreachable — fall back to bumping this document's own version.
      const vMatch = docNo.match(/(?:-V|v)(\d+)$/i);
      if (vMatch) maxV = parseInt(vMatch[1], 10) || 0;
    }
    return `${base}v${maxV + 1}`;
  }

  // Hydrate: reopen a saved quotation (?id=…), else restore the draft, else seed
  // a fresh one. In an effect (not render) — Date.now()/localStorage during
  // render violate purity rules.
  //
  // ⚠️ This runs ONCE, on mount. Next.js keeps this component mounted when only
  // the query string changes, so a link from /quotation?id=X&view=1 to
  // /quotation?id=X&action=clone re-renders without ever re-running it — which
  // is exactly why the "แก้ไข (New Ver.)" button used to do nothing (task 6).
  // Mode changes made from inside the page therefore happen IN PLACE
  // (startNewVersion / loadOriginalForEdit) and only sync the URL afterwards.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const reopenId = params.get("id");
    const isView = params.get("view") === "1";
    if (isView) setIsViewOnly(true);

    if (reopenId) {
      setIsEditing(true);
      fetch(`/api/quotations/${encodeURIComponent(reopenId)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then(async (rec) => {
          if (rec?.data && Array.isArray(rec.data.items)) {
            const isClone = params.get("action") === "clone";
            const migrated = migrateQuoteState({
              ...emptyState(),
              ...rec.data,
              id: rec.id || reopenId,
            });

            if (isClone) {
              // Remember WHICH document this draft is a new version of, so the
              // toolbar can say so and offer editing that one instead (task 6).
              setCloneSource({ id: rec.id || reopenId, docNo: migrated.docNo });
              migrated.docNo = await nextVersionDocNo(migrated.docNo);
              migrated.id = randomId();
            }

            adoptState(migrated);
          } else {
            showToast("ไม่พบใบเสนอราคานี้ — เริ่มใบใหม่แทน", "error");
            seedFresh();
          }
        })
        .catch(() => seedFresh())
        .finally(() => {
          hydratedRef.current = true;
        });
      return;
    }

    seedFresh();
    hydratedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Set the snapshot once the fresh state is seeded.
  useEffect(() => {
    if (hydratedRef.current && savedSnapshotRef.current === "" && q.id) {
      const { id: _id, ...rest } = q;
      savedSnapshotRef.current = JSON.stringify(rest);
    }
  }, [q]);



  // Product list for the "เลือกจากสินค้า" autofill
  useEffect(() => {
    if (!isLoggedIn) return;
    fetch("/api/products")
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => setProducts(Array.isArray(list) ? list : []))
      .catch(() => {});
      
    fetch("/api/companies")
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => setDbCompanies(Array.isArray(list) ? list : []))
      .catch(() => {});

    fetch("/api/customers")
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => setDbCustomers(Array.isArray(list) ? list : []))
      .catch(() => {});

    fetch("/api/salespeople")
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => setDbSalespeople(Array.isArray(list) ? list : []))
      .catch(() => {});

    fetch("/api/product-specs")
      .then((r) => (r.ok ? r.json() : null))
      .then((res) => setDbProductSpecs(Array.isArray(res?.data) ? res.data : []))
      .catch(() => {});
  }, [isLoggedIn]);

  // Reserved quotation numbers from the last ~7 days — for the duplicate
  // warning only. Survives deletion (separate ledger). NOT a mint source: see
  // `dayLedger` above and the ⚠️ in app/lib/quotationNumber.ts.
  useEffect(() => {
    if (!isLoggedIn) return;
    fetch("/api/quotations/docnos")
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

  /**
   * Every number `used_docnos` has EVER issued under `isoDate`'s two prefixes.
   * Both prefixes go in one request (`?base=…&base=…`) so the answer is one
   * consistent snapshot rather than two that can disagree.
   *
   * A failure comes back as `failed: true` with NO docNos, never as "the day is
   * empty" — the caller must be able to tell "I could not read the ledger" from
   * "the ledger holds nothing", because minting on the first reading is exactly
   * the bug this replaced.
   */
  const loadDayDocNos = useCallback(async (isoDate: string) => {
    const qs = quotationDocNoPrefixes(isoDate)
      .map((p) => `base=${encodeURIComponent(p)}`)
      .join("&");
    try {
      const res = await fetch(`/api/quotations/docnos?${qs}`);
      if (!res.ok) throw new Error(`docnos responded ${res.status}`);
      const list = await res.json();
      if (!Array.isArray(list)) throw new Error("docnos did not return a list");
      return {
        forDate: isoDate,
        docs: list.map((x: { quotationId: string; docNo: string }) => ({
          id: String(x.quotationId ?? ""),
          docNo: String(x.docNo ?? ""),
        })),
        failed: false,
      };
    } catch (err) {
      console.error("[quotation] failed to load the day's docNo ledger", err);
      return { forDate: isoDate, docs: [], failed: true };
    }
  }, []);

  useEffect(() => {
    if (!isLoggedIn || !q.docDate) return;
    let cancelled = false;
    loadDayDocNos(q.docDate).then((led) => {
      if (!cancelled) setDayLedger(led);
    });
    return () => {
      cancelled = true;
    };
  }, [isLoggedIn, q.docDate, loadDayDocNos, docNoLedgerAttempt]);

  // The day ledger ONLY when it was read for the date currently on the
  // document; a ledger fetched for another date is not an answer about this one.
  const dayLedgerIsForThisDate =
    dayLedger !== null && dayLedger.forDate === q.docDate;
  const dayDocs = dayLedgerIsForThisDate ? dayLedger.docs : null;
  /** The read for this date came back, and it FAILED — `docs` is `[]` because
   *  nobody could ask, NOT because the day is empty. */
  const docNoLedgerFailed = dayLedgerIsForThisDate && dayLedger.failed;
  /**
   * The unwindowed ledger for this date has been read AND answered.
   *
   * `dayDocs !== null` alone is not that test: a failed read resolves to
   * `{docs: [], failed: true}`, so it is non-null too, and taking it for
   * "ready" is taking "I could not ask" for "the day is empty" — which let the
   * mint fall straight through onto the 7-day window, the one source that
   * cannot see last year's numbers under this very prefix. The failure was
   * already tracked correctly right above; it just was not part of this test.
   */
  const docNoLedgerReady = dayDocs !== null && !docNoLedgerFailed;

  // ONE list behind BOTH the mint and the duplicate warning. They used to read
  // different sources, so the admin could be warned about one number and
  // blocked on saving a different one.
  const knownDocNos = useMemo(() => {
    const byDocNo = new Map<string, { id: string; docNo: string }>();
    // The unwindowed day ledger first: it is authoritative for these prefixes.
    for (const d of dayDocs ?? []) byDocNo.set(d.docNo, d);
    for (const d of existingDocs) if (!byDocNo.has(d.docNo)) byDocNo.set(d.docNo, d);
    return Array.from(byDocNo.values());
  }, [dayDocs, existingDocs]);

  // Once the ledger is loaded or date changes, bump a fresh quote's docNo
  // to the next free trailing number.
  //
  // ── What happens when the ledger cannot be read ───────────────────────────
  // NOTHING IS ISSUED. Not from the 7-day window, not from an empty list. A
  // failed read hands back `{docs: [], failed: true}`, and running the
  // allocator over that would allocate off `knownDocNos`, i.e. the window —
  // the one list that cannot contain last year's numbers under this very
  // prefix (QT251026- is also 26 Oct 2025's legacy prefix), and therefore the
  // exact source that handed back QT251026-22 while used_docnos had owned it
  // since 2025. "I could not ask" is not "the day is empty", so the page says
  // nothing about what is free.
  //
  // The one thing it still does on a failed read is keep the number on the DAY
  // the document is dated: if the admin moved the date while the ledger was
  // unreadable, the number is re-seeded to that day's OPENING number
  // (DOCNO_START — the business's convention for a day's first number, not a
  // claim that it is free) instead of being left carrying another date. A
  // number that already carries one of this day's prefixes is left EXACTLY as
  // it is, so a number the 409 path has just advanced onto is never dragged
  // back to -22 by a later failed read.
  //
  // The admin is told, in Thai, under the field, that the check did not run,
  // and can retry it there; used_docnos' PRIMARY KEY and the 409 path remain
  // the enforcement.
  useEffect(() => {
    if (!isFreshRef.current || !q.docDate) return;
    if (!docNoLedgerReady && !docNoLedgerFailed) return; // still reading — wait
    // BOTH shapes of the day's numbers are scanned, so the running number keeps
    // climbing across the DDMMYY switchover instead of restarting at 22 next to
    // a legacy QT<YYMMDD>-NN that is already out with a customer (task 5a).
    const prefixes = quotationDocNoPrefixes(q.docDate);
    const prefix = prefixes[0];
    const opening = `${prefix}${pad2(DOCNO_START)}`;
    setQ((prev) => {
      // Only ever touch a number this effect put there (or the untouched
      // opening one); anything else the admin typed himself.
      if (prev.docNo !== opening && prev.docNo !== lastAutoDocNoRef.current) {
        return prev;
      }
      if (!docNoLedgerReady) {
        // Failed read: re-seat onto this day, never re-number within it.
        if (prefixes.some((p) => prev.docNo.startsWith(p))) return prev;
        lastAutoDocNoRef.current = opening;
        return opening === prev.docNo ? prev : { ...prev, docNo: opening };
      }
      const next = nextDocNo(prefixes, knownDocNos.map((u) => u.docNo));
      lastAutoDocNoRef.current = next;
      return next === prev.docNo ? prev : { ...prev, docNo: next };
    });
  }, [q.docDate, knownDocNos, docNoLedgerReady, docNoLedgerFailed]);

  // ── Unsaved-changes guard ──
  // Serialize only the user-editable fields (skip volatile ids/timestamps).
  const stateFingerprint = useCallback((s: QuoteState) => {
    const { id, ...rest } = s;
    return JSON.stringify(rest);
  }, []);

  const isDirty = savedSnapshotRef.current !== "" && stateFingerprint(q) !== savedSnapshotRef.current;

  // Warn on browser close / refresh when there are unsaved changes
  useEffect(() => {
    if (!isDirty || isViewOnly) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty, isViewOnly]);

  // Navigate away after user confirms "leave without saving"
  useEffect(() => {
    if (pendingNav && !showLeaveConfirm) {
      // Modal was dismissed without confirming — pendingNav cleared in cancel
    }
  }, [pendingNav, showLeaveConfirm]);

  /** Intercept in-app navigation: if dirty, show modal; else navigate. */
  function guardedNavigate(href: string) {
    if (isDirty && !isViewOnly) {
      setPendingNav(href);
      setShowLeaveConfirm(true);
    } else {
      router.push(href);
    }
  }

  function showToast(message: string, type: "success" | "error") {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }

  const set = <K extends keyof QuoteState>(key: K, value: QuoteState[K]) =>
    setQ((prev) => ({ ...prev, [key]: value }));

  // Task 14.3 — the admin typed over a name that was picked from the system.
  // `applyTypedPartyName` drops the stored id unless the text still names the
  // same row (re-typing the same name, or only its case/spacing, is not a
  // different customer), so a saved quotation can never carry an id that
  // disagrees with the name printed on it.
  const setParty = (which: "customer" | "company", typed: string) =>
    setQ((prev) => {
      if (which === "customer") {
        const next = applyTypedPartyName({ name: prev.customerContact, id: prev.customerId || "" }, typed);
        return { ...prev, customerContact: next.name, customerId: next.id };
      }
      const next = applyTypedPartyName({ name: prev.customerCompany, id: prev.companyId || "" }, typed);
      return { ...prev, customerCompany: next.name, companyId: next.id };
    });

  const setItem = (id: string, updates: Partial<QuoteItem>) =>
    setQ((prev) => ({
      ...prev,
      items: prev.items.map((it) => (it.id === id ? { ...it, ...updates } : it)),
    }));

  // ── The per-line discount setters ────────────────────────────────────────
  // NOT plain setItem() calls. `FormattedNumberInput` fires onChange on every
  // blur, so a plain setter would write `discount: 0` onto a line of a REOPENED
  // OLD QUOTATION the moment the admin clicked into the box and tabbed out —
  // adding a key the blob never had, flipping isDirty, and rewriting a saved
  // document nobody edited. The helpers drop a key that carries no information
  // instead of storing it (see quotationTotals.ts).
  const setLineDiscount = (id: string, amount: number) =>
    setQ((prev) => ({
      ...prev,
      items: prev.items.map((it) =>
        it.id === id ? setLineDiscountAmount(it, amount) : it
      ),
    }));

  const setLineType = (id: string, type: string) =>
    setQ((prev) => ({
      ...prev,
      items: prev.items.map((it) =>
        it.id === id ? setLineDiscountType(it, type) : it
      ),
    }));

  const addItem = () => setQ((prev) => ({ ...prev, items: [...prev.items, newItem()] }));
  const removeItem = (id: string) =>
    setQ((prev) => ({ ...prev, items: prev.items.filter((it) => it.id !== id) }));
  const moveItem = (id: string, dir: -1 | 1) =>
    setQ((prev) => {
      const idx = prev.items.findIndex((it) => it.id === id);
      const to = idx + dir;
      if (idx < 0 || to < 0 || to >= prev.items.length) return prev;
      const items = [...prev.items];
      [items[idx], items[to]] = [items[to], items[idx]];
      return { ...prev, items };
    });

  // Autofill an item from a catalog product. imageUploaded:false marks the
  // image as a shared catalog asset — it must NOT be deleted on quote delete.
  const applyProduct = (itemId: string, productId: string) => {
    const p = products.find((x) => x.id === productId);
    if (p) {
      setItem(itemId, {
        productId: p.id,
        name: stripHtml(p.title_th || p.title_en).replace(/🐧/g, "").trim(),
        description: "",
        imageUrl: p.image,
        imageUploaded: false,
      });
    }
  };

  // Upload a custom image for an item (reuses the existing Cloudinary route)
  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const itemId = uploadTargetRef.current;
    e.target.value = "";
    if (!file || !itemId) return;
    setUploadingItemId(itemId);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      if (!res.ok) throw new Error();
      const { url } = await res.json();
      // imageUploaded:true → this image was created for this quote and will be
      // removed from Cloudinary if the quotation is deleted/expires.
      setItem(itemId, { imageUrl: url, imageUploaded: true });
    } catch {
      showToast("อัปโหลดรูปไม่สำเร็จ", "error");
    } finally {
      setUploadingItemId(null);
      uploadTargetRef.current = null;
    }
  }

  // ── Totals ──────────────────────────────────────────────────────────────
  // `lines` is per-item and in the same order as q.items, so lines[idx] is the
  // money for q.items[idx]. Order of operations (quotationTotals.ts): each line
  // is discounted first, then the document-level discount comes off the sum of
  // the discounted lines, then VAT.
  const {
    subtotal,
    lines,
    lineDiscountTotal,
    afterLineDiscounts,
    discountValue,
    afterDiscount,
    vat,
    grandTotal,
  } = computeQuoteTotals(q);

  // Does ANY line actually carry a discount? Drives the whole printed layout:
  // false (every quotation saved before this feature, and every new one where
  // the field is left alone) renders the sheet EXACTLY as it rendered before
  // per-line discounts existed — same six columns, same totals rows.
  const hasLineDiscounts = lineDiscountTotal > 0;

  // Duplicate doc-number guard: is this docNo already used by a DIFFERENT saved
  // quotation? (Same id = editing the same one, allowed.)
  const trimmedDocNo = q.docNo.trim();
  // Read from `knownDocNos` — the SAME list the number was minted from. Reading
  // the 7-day window here while minting from somewhere else is how the admin
  // ended up with a number nothing had warned him about and the save refused.
  const docNoDup =
    trimmedDocNo !== "" &&
    knownDocNos.some((d) => d.docNo === trimmedDocNo && d.id !== q.id);

  // Render the A4 sheet to a real .pdf file and download it (no print dialog).
  // Libraries are dynamically imported so they only load on click and never run
  // on the server. html2canvas-pro (vs html2canvas) supports Tailwind v4's oklch
  // colors. The sheet is rasterized, then sliced across A4 pages if it's tall.
  async function generatePdf() {
    const originalSheet = document.getElementById("quote-sheet");
    if (!originalSheet) return;
    
    // We dynamically import libraries as they shouldn't run on the server.
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
      import("html2canvas-pro"),
      import("jspdf"),
    ]);

    // Create an offscreen container to hold the paginated sheets
    const container = document.createElement("div");
    container.style.position = "absolute";
    container.style.left = "-9999px";
    container.style.top = "0";
    container.style.width = originalSheet.style.width; 
    document.body.appendChild(container);

    const A4_HEIGHT_PX = originalSheet.offsetWidth * (297 / 210);
    // Padding logic: keep a bit of space at the bottom (e.g., 14mm)
    const paddingBottomPx = originalSheet.offsetWidth * (14 / 210);
    const PAGE_MAX_HEIGHT = A4_HEIGHT_PX - paddingBottomPx;

    const tbody = document.getElementById("quote-tbody");
    const rows = Array.from(tbody?.querySelectorAll("tr") || []);
    const rowHeights = rows.map((r) => (r as HTMLElement).offsetHeight);

    const headerHeightFirstPage = document.getElementById("quote-header")?.offsetHeight || 0;
    const customerInfoHeight = document.getElementById("quote-customer-info")?.offsetHeight || 0;
    const headerHeightSubsequentPages = headerHeightFirstPage - customerInfoHeight;

    const tableHeaderHeight = document.getElementById("quote-table")?.querySelector("thead")?.offsetHeight || 0;
    const footerHeight = document.getElementById("quote-footer")?.offsetHeight || 0;
    const signaturesHeight = document.getElementById("quote-signatures")?.offsetHeight || 0;
    const extraFooterHeight = footerHeight + signaturesHeight + 80; // 80px extra margin/padding approximation

    const pages: HTMLElement[] = [];
    
    // Helper to hide footer elements from a specific cloned page
    const hideFooter = (clone: HTMLElement) => {
      const f = clone.querySelector("#quote-footer") as HTMLElement;
      const s = clone.querySelector("#quote-signatures") as HTMLElement;
      if (f) f.style.display = "none";
      if (s) s.style.display = "none";
    };

    const hideCustomerInfo = (clone: HTMLElement) => {
      const c = clone.querySelector("#quote-customer-info") as HTMLElement;
      if (c) c.style.display = "none";
    };

    let currentClone = originalSheet.cloneNode(true) as HTMLElement;
    currentClone.style.height = "297mm";
    currentClone.style.minHeight = "297mm";
    currentClone.style.overflow = "hidden";
    currentClone.style.backgroundColor = "white";
    currentClone.id = "";
    
    let currentTbody = currentClone.querySelector("#quote-tbody") as HTMLElement;
    currentTbody.innerHTML = ""; // Clear for row-by-row insertion
    
    // 12mm top padding approximation
    const paddingTopPx = originalSheet.offsetWidth * (12 / 210);
    let currentHeight = headerHeightFirstPage + tableHeaderHeight + paddingTopPx;

    let i = 0;
    while (i < rows.length) {
      const rh = rowHeights[i];
      if (currentHeight + rh > PAGE_MAX_HEIGHT && currentTbody.children.length > 0) {
        // Break page
        hideFooter(currentClone);
        pages.push(currentClone);
        
        currentClone = originalSheet.cloneNode(true) as HTMLElement;
        currentClone.style.height = "297mm";
        currentClone.style.minHeight = "297mm";
        currentClone.style.overflow = "hidden";
        currentClone.style.backgroundColor = "white";
        currentClone.id = "";
        hideCustomerInfo(currentClone);
        currentTbody = currentClone.querySelector("#quote-tbody") as HTMLElement;
        currentTbody.innerHTML = "";
        currentHeight = headerHeightSubsequentPages + tableHeaderHeight + paddingTopPx;
      } else {
        currentTbody.appendChild(rows[i].cloneNode(true));
        currentHeight += rh;
        i++;
      }
    }

    // Check if footer fits on the last page
    if (currentHeight + extraFooterHeight > PAGE_MAX_HEIGHT && currentTbody.children.length > 0) {
      hideFooter(currentClone);
      pages.push(currentClone);
      
      currentClone = originalSheet.cloneNode(true) as HTMLElement;
      currentClone.style.height = "297mm";
      currentClone.style.minHeight = "297mm";
      currentClone.style.overflow = "hidden";
      currentClone.style.backgroundColor = "white";
      currentClone.id = "";
      hideCustomerInfo(currentClone);
      currentTbody = currentClone.querySelector("#quote-tbody") as HTMLElement;
      currentTbody.innerHTML = "";
      pages.push(currentClone);
    } else {
      pages.push(currentClone);
    }

    // Add page numbers if > 1 page
    if (pages.length > 1) {
      pages.forEach((page, idx) => {
        const topRightDiv = page.querySelector(".text-right.shrink-0");
        if (topRightDiv) {
          const pageNum = document.createElement("div");
          pageNum.className = "text-[11px] text-gray-500 mt-2 font-bold text-right";
          pageNum.innerText = `หน้า ${idx + 1}/${pages.length}`;
          topRightDiv.appendChild(pageNum);
        }
      });
    }

    for (const p of pages) container.appendChild(p);

    const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();

    for (let pIdx = 0; pIdx < pages.length; pIdx++) {
      const canvas = await html2canvas(pages[pIdx], {
        scale: 2, // sharper text/images
        useCORS: true,
        backgroundColor: "#ffffff",
      });
      const imgData = canvas.toDataURL("image/jpeg", 0.95);
      if (pIdx > 0) pdf.addPage();
      pdf.addImage(imgData, "JPEG", 0, 0, pageW, pageH);
    }

    pdf.save(`Quotation-${(q.docNo || "document").replace(/[^\w.-]/g, "_")}.pdf`);
    document.body.removeChild(container);
  }

  // ── Excel — a single styled sheet laid out like the printed document


  // ── Download → save record → generate PDF → ask keep/delete ───────────────
  async function handleDownload() {
    if (generating) return;
    if (docNoDup) {
      showToast("เลขที่ใบเสนอราคานี้ซ้ำกับใบที่บันทึกไว้ กรุณาเปลี่ยนเลขที่ก่อน", "error");
      return;
    }
    setGenerating(true);
    // Persist first so the record exists for the keep/delete prompt and the
    // 30-day auto-purge. Only images uploaded for THIS quote are deletable.
    const uploadedImages = q.items
      .filter((it) => it.imageUploaded && it.imageUrl)
      .map((it) => it.imageUrl);
    let saved = false;
    try {
      const res = await fetch("/api/quotations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: q.id, docNo: q.docNo, data: q, uploadedImages }),
      });
      if (res.status === 409) {
        // Another quotation grabbed this number since the page loaded — advance
        // onto a free one rather than leave the admin pressing the same
        // rejected number. Nothing is downloaded: the sheet still shows the old
        // number, and a PDF is the copy the customer keeps.
        const data = await res.json().catch(() => null);
        await handleDocNoConflict(data?.error);
        setGenerating(false);
        return;
      }
      saved = res.ok;
    } catch {
      /* save is best-effort — never block the download */
    }
    try {
      await generatePdf();
    } catch {
      showToast("สร้าง PDF ไม่สำเร็จ กรุณาลองใหม่", "error");
      setGenerating(false);
      return;
    }
    setGenerating(false);
    if (saved) {
      // Reserve the number locally (mirrors handleSave) and settle it, so a
      // later reset/new quote advances past it and the dup-check stays accurate.
      settleDocNo();
      setSavePrompt(true);
    } else {
      showToast("ดาวน์โหลดแล้ว (แต่บันทึกประวัติไม่สำเร็จ)", "error");
    }
  }

  // After a quote is persisted, reserve its number locally and stop the
  // auto-running effect from re-firing (which would silently renumber it).
  function settleDocNo() {
    isFreshRef.current = false;
    const doc = q.docNo.trim();
    if (doc) {
      setExistingDocs((prev) => [
        ...prev.filter((d) => d.docNo !== doc),
        { id: q.id, docNo: doc },
      ]);
    }
  }

  /** File a number the server has just refused, so neither the mint nor the
   * duplicate warning can offer it again this session. */
  function markDocNoTaken(docNo: string) {
    const doc = docNo.trim();
    if (!doc) return;
    setExistingDocs((prev) =>
      prev.some((d) => d.docNo === doc)
        ? prev
        : [...prev, { id: TAKEN_BY_ANOTHER, docNo: doc }]
    );
  }

  /**
   * `used_docnos` already owns `taken` — move the document FORWARD onto a
   * number that is free. Two admins saving at the same moment is the ordinary
   * case, and what must not happen is what used to: the same rejected number
   * handed straight back, with บันทึก refusing it again, forever.
   *
   * The day's ledger is RE-READ first, unwindowed: the other admin may have
   * issued several numbers since this page loaded, and advancing one at a time
   * would simply bounce off each of them in turn.
   *
   * Returns the replacement, or null if none could be worked out (the caller
   * then shows the server's own Thai message and the number stays put — the
   * duplicate warning is already lit, because `markDocNoTaken` fired first).
   */
  async function advancePastTakenDocNo(taken: string): Promise<string | null> {
    const doc = taken.trim();
    if (!doc) return null;
    markDocNoTaken(doc);
    // A version number continues as a VERSION (…-23v1 → …-23v2). Renumbering it
    // into the day's running sequence would cut it loose from the document it
    // is a version of.
    if (hasVersionSuffix(doc)) {
      const next = await nextVersionDocNo(doc);
      return next && next !== doc ? next : null;
    }
    if (!q.docDate) return null;
    const led = await loadDayDocNos(q.docDate);
    setDayLedger(led);
    const pool = [
      doc,
      ...knownDocNos.map((d) => d.docNo),
      ...led.docs.map((d) => d.docNo),
    ];
    const next = nextDocNo(quotationDocNoPrefixes(q.docDate), pool);
    return next !== doc ? next : null;
  }

  /** The 409 path both save buttons share. */
  async function handleDocNoConflict(serverMessage?: string | null) {
    const taken = q.docNo.trim();
    const next = await advancePastTakenDocNo(taken);
    if (!next) {
      showToast(serverMessage || "เลขที่ใบเสนอราคาซ้ำ กรุณาเปลี่ยนเลขที่", "error");
      return;
    }
    // Not auto-resubmitted on purpose: the number is printed on the sheet the
    // customer receives, so the admin sees the new one before it is committed.
    setQ((prev) => (prev.docNo.trim() === taken ? { ...prev, docNo: next } : prev));
    if (isFreshRef.current) lastAutoDocNoRef.current = next;
    showToast(
      `เลขที่ ${taken} ถูกใช้ไปแล้ว ระบบเปลี่ยนเป็น ${next} ให้อัตโนมัติ — กรุณากดบันทึกอีกครั้ง`,
      "error"
    );
  }

  // ── "แก้ไข (New Ver.)" — task 6 ────────────────────────────────────────────
  // What the button means: *start an editable new version of the quotation on
  // screen*. It used to be a <Link> to ?id=…&action=clone, which never worked
  // from here: Next.js keeps this client component mounted across a query-string
  // change, so the mount effect that reads `action=clone` never re-ran — the URL
  // changed and nothing else did. Doing the clone in place fixes that, and the
  // URL is then re-pointed with router.replace so a refresh reproduces the state.
  async function startNewVersion() {
    if (startingNewVersion) return;
    const source = { id: q.id, docNo: q.docNo };
    setStartingNewVersion(true);
    try {
      const docNo = await nextVersionDocNo(source.docNo);
      adoptState({ ...q, id: randomId(), docNo });
      setCloneSource(source);
      setIsViewOnly(false);
      setIsEditing(true);
      // NOT a fresh quote: its number was derived from the source, and the
      // auto-running-number effect must never renumber it.
      isFreshRef.current = false;
      lastAutoDocNoRef.current = null;
      router.replace(`/quotation?id=${encodeURIComponent(source.id)}&action=clone`);
      showToast(`สร้างเวอร์ชันใหม่ ${docNo} — ยังไม่ได้บันทึก`, "success");
    } finally {
      setStartingNewVersion(false);
    }
  }

  /** Leave the unsaved new version and open the ORIGINAL quotation for editing. */
  async function loadOriginalForEdit() {
    const source = cloneSource;
    if (!source) return;
    setShowEditOriginalConfirm(false);
    try {
      const res = await fetch(`/api/quotations/${encodeURIComponent(source.id)}`);
      const rec = res.ok ? await res.json() : null;
      if (!rec?.data || !Array.isArray(rec.data.items)) {
        showToast("ไม่พบใบเสนอราคาต้นฉบับ (อาจถูกลบไปแล้ว)", "error");
        return;
      }
      adoptState(
        migrateQuoteState({ ...emptyState(), ...rec.data, id: rec.id || source.id })
      );
      setCloneSource(null);
      setIsViewOnly(false);
      setIsEditing(true);
      isFreshRef.current = false;
      lastAutoDocNoRef.current = null;
      router.replace(`/quotation?id=${encodeURIComponent(source.id)}`);
      showToast(`กำลังแก้ไขใบเดิม ${rec.data.docNo || source.docNo}`, "success");
    } catch {
      showToast("โหลดใบเสนอราคาต้นฉบับไม่สำเร็จ", "error");
    }
  }

  // ── Save only (no PDF) — blocked while the docNo is a duplicate ────────────
  async function handleSave() {
    if (savingQuote) return;
    if (docNoDup) {
      showToast("เลขที่ใบเสนอราคานี้ซ้ำกับใบที่บันทึกไว้ กรุณาเปลี่ยนเลขที่ก่อน", "error");
      return;
    }
    setSavingQuote(true);
    const uploadedImages = q.items
      .filter((it) => it.imageUploaded && it.imageUrl)
      .map((it) => it.imageUrl);
    try {
      const res = await fetch("/api/quotations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: q.id, docNo: q.docNo, data: q, uploadedImages }),
      });
      if (res.status === 409) {
        const data = await res.json().catch(() => null);
        await handleDocNoConflict(data?.error);
        return;
      }
      if (res.ok) {
        // Update snapshot so the form is no longer dirty after save.
        savedSnapshotRef.current = stateFingerprint(q);
        showToast("บันทึกใบเสนอราคาแล้ว (เก็บไว้ 30 วัน)", "success");
        router.push("/billing/saved?tab=quotation");
      } else {
        showToast("บันทึกไม่สำเร็จ", "error");
      }
    } catch {
      showToast("เกิดข้อผิดพลาดในการบันทึก", "error");
    } finally {
      setSavingQuote(false);
    }
  }

  async function handleDeleteQuotation() {
    setDeletingQuote(true);
    try {
      const res = await fetch(`/api/quotations/${q.id}`, { method: "DELETE" });
      if (res.ok) {
        const data = await res.json();
        // Strip dead image refs from local state.
        setQ((prev) => ({
          ...prev,
          id: crypto.randomUUID(),
          items: prev.items.map((it) =>
            it.imageUploaded ? { ...it, imageUrl: "", imageUploaded: false } : it
          ),
        }));
        showToast("ลบใบเสนอราคาแล้ว", "success");
        // Show image deletion confirmation dialog
        if (data.orphanedImages?.length > 0) {
          setOrphanedImages(data.orphanedImages.map((url: string) => ({
            url,
            reason: "ลบใบเสนอราคา"
          })));
        }
      } else {
        showToast("ลบไม่สำเร็จ", "error");
      }
    } catch {
      showToast("เกิดข้อผิดพลาดในการลบ", "error");
    } finally {
      setDeletingQuote(false);
      setSavePrompt(false);
    }
  }

  if (isLoading || !isLoggedIn) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  const inputCls =
    "w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 text-sm";
  const labelCls = "block text-xs font-semibold text-gray-600 mb-1";

  return (
    <>
    <div className="min-h-screen bg-gray-100">
      {toast && <Toast message={toast.message} type={toast.type} />}

      {showResetConfirm && (
        <ConfirmDialog
          title="ยืนยันการล้างข้อมูล"
          message="คุณต้องการล้างข้อมูลทั้งหมดและเริ่มทำใบเสนอราคาใหม่ใช่หรือไม่? ข้อมูลปัจจุบันที่ยังไม่ได้บันทึกจะสูญหาย"
          confirmText="เริ่มใหม่"
          cancelText="ยกเลิก"
          onConfirm={() => {
            setShowResetConfirm(false);
            localStorage.removeItem(DRAFT_KEY);
            const iso = toLocalDateString(new Date());
            isFreshRef.current = true;
            setCloneSource(null);
            const resetDocNo = nextDocNo(
              quotationDocNoPrefixes(iso),
              knownDocNos.map((u) => u.docNo)
            );
            // Record it as the number WE issued, exactly as seedFresh() does.
            // Without this the auto-running-number effect reads the reset number
            // as one the admin typed by hand and stops maintaining it — so
            // changing วันที่ afterwards would leave yesterday's date baked into
            // the quotation number while the sheet prints today's.
            lastAutoDocNoRef.current = resetDocNo;
            setQ({
              ...emptyState(),
              id: randomId(),
              docDate: iso,
              docNo: resetDocNo,
              items: [newItem()],
            });
          }}
          onCancel={() => setShowResetConfirm(false)}
        />
      )}

      {/* Leaving an unsaved new version to edit the original instead (task 6) */}
      {showEditOriginalConfirm && cloneSource && (
        <ConfirmDialog
          title="แก้ไขใบเดิมแทน?"
          message={`เวอร์ชันใหม่ ${q.docNo || "-"} ยังไม่ได้บันทึก และจะถูกทิ้งไป ระบบจะเปิดใบเดิม ${cloneSource.docNo || "-"} ขึ้นมาแก้ไขแทน — การแก้ไขจะทับใบเดิมที่ส่งให้ลูกค้าไปแล้ว`}
          confirmText={`แก้ไขใบเดิม ${cloneSource.docNo || ""}`}
          cancelText="ยกเลิก"
          onConfirm={loadOriginalForEdit}
          onCancel={() => setShowEditOriginalConfirm(false)}
        />
      )}

      <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />

      {/* Keep-or-delete prompt shown after download */}
      {savePrompt && (
        <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-2">ดาวน์โหลดเรียบร้อย ✅</h3>
            <p className="text-sm text-gray-600 mb-5">
              ต้องการเก็บใบเสนอราคานี้ไว้ในระบบไหม? ถ้าเก็บไว้ ระบบจะ
              <span className="font-semibold"> ลบให้อัตโนมัติเมื่อครบ 30 วัน</span>
              {" "}หรือจะลบทันทีเลยก็ได้ (รูปที่อัปโหลดสำหรับใบนี้จะถูกลบออกจากคลาวด์ด้วย — รูปสินค้าจาก catalog ไม่ถูกลบ)
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setSavePrompt(false)}
                disabled={deletingQuote}
                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 font-semibold hover:bg-gray-50 transition text-sm disabled:opacity-60"
              >
                เก็บไว้ 30 วัน
              </button>
              <button
                onClick={handleDeleteQuotation}
                disabled={deletingQuote}
                className="px-4 py-2 rounded-lg bg-red-500 text-white font-semibold hover:bg-red-600 transition text-sm disabled:opacity-60 flex items-center gap-2"
              >
                {deletingQuote && (
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                )}
                🗑️ ลบทันที
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Number inputs: typeable, no up/down spinner buttons */}
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
      `}</style>

      {/* ── Toolbar ── */}
      <div className="no-print sticky top-0 z-20 bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-[1400px] mx-auto px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <h1 className="text-xl font-bold text-gray-900">🧾 สร้างใบเสนอราคา</h1>
          <div className="flex items-center gap-2 flex-wrap">

            {!isEditing && (
              <button onClick={() => { if (isDirty) { guardedNavigate("/billing/saved?tab=quotation"); } else { router.back(); } }} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-semibold hover:bg-gray-50 transition">
                ← กลับ
              </button>
            )}
            <button onClick={() => guardedNavigate("/adminpanel")} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-semibold hover:bg-gray-50 transition">
              🏠 กลับไปหน้าระบบจัดการ
            </button>
            <button onClick={() => guardedNavigate("/billing/saved?tab=quotation")} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-semibold hover:bg-gray-50 transition">
              📄 ใบเสนอราคาที่บันทึกไว้
            </button>

            {!isViewOnly && (
              <button
                onClick={handleSave}
                disabled={savingQuote || docNoDup}
                className="px-5 py-2 rounded-lg border border-green-500 text-green-600 text-sm font-bold hover:bg-green-50 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {savingQuote ? "กำลังเซฟ..." : "💾 เซฟ"}
              </button>
            )}
            {/* ── "แก้ไข (New Ver.)" (task 6) ──────────────────────────────
                Shown ONLY while viewing a saved quotation, where it has one
                unambiguous meaning: turn this document into an editable new
                version. In clone mode the page already IS that new version, so
                the button is deliberately NOT shown — pressing "make a new
                version" on an unsaved new version has no sensible meaning, and
                silently re-pointing it at the original would edit a different
                document than its label says. Clone mode gets the banner below
                instead, which names both documents and offers the original
                explicitly. */}
            {isViewOnly && (
              <button
                onClick={startNewVersion}
                disabled={startingNewVersion}
                className="px-5 py-2 rounded-lg border border-blue-500 text-blue-600 text-sm font-bold hover:bg-blue-50 transition disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {startingNewVersion ? "กำลังสร้างเวอร์ชันใหม่..." : "✏️ แก้ไข (New Ver.)"}
              </button>
            )}
            {!isViewOnly && cloneSource && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="px-3 py-2 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 text-xs font-bold">
                  🆕 เวอร์ชันใหม่ {q.docNo || "-"} (ยังไม่ได้บันทึก) — จากใบเดิม {cloneSource.docNo || "-"}
                </span>
                <button
                  onClick={() =>
                    isDirty ? setShowEditOriginalConfirm(true) : loadOriginalForEdit()
                  }
                  title={`เปิดใบเดิม ${cloneSource.docNo} ขึ้นมาแก้ไขแทน (ทิ้งเวอร์ชันใหม่นี้)`}
                  className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-semibold hover:bg-gray-50 transition"
                >
                  ↩️ แก้ไขใบเดิม ({cloneSource.docNo || "-"}) แทน
                </button>
              </div>
            )}

            {isViewOnly && (
              <button
                onClick={handleDownload}
                disabled={docNoDup}
                className="px-5 py-2 rounded-lg bg-orange-500 text-white text-sm font-bold hover:bg-orange-600 transition shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                ⬇️ ดาวน์โหลด PDF
              </button>
            )}
          </div>
        </div>
      </div>

      <div className={`max-w-[1400px] mx-auto px-4 py-6 ${isViewOnly ? "flex justify-center" : "grid grid-cols-1 xl:grid-cols-[420px_1fr]"} gap-6 items-start`}>
        {/* ══ LEFT: form ══ */}
        {!isViewOnly && (
        <div className="quote-form space-y-4">
          {/* เอกสาร */}
          <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 space-y-3">
            <h2 className="font-bold text-gray-800">ข้อมูลเอกสาร</h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>เลขที่ (No.)</label>
                <input
                  className={`${inputCls} ${docNoDup ? "border-red-400 ring-1 ring-red-300" : ""}`}
                  value={q.docNo}
                  onChange={(e) => set("docNo", e.target.value)}
                />
                {docNoDup && (
                  <p className="mt-1 text-xs text-red-500 font-semibold">
                    ⚠ เลขที่นี้ซ้ำกับใบที่บันทึกไว้ — กรุณาเปลี่ยน
                  </p>
                )}
                {/* The ledger could not be read, so the page issued NO number
                    (see the mint effect): what is in the box is this day's
                    opening number, and "ไม่ซ้ำ" would be a claim we cannot make.
                    Said out loud, with a retry, rather than blocking บันทึก:
                    the used_docnos PRIMARY KEY still refuses a real duplicate,
                    and the 409 path then moves the document onto a free one.
                    Shown ALONGSIDE the duplicate warning when both apply: they
                    answer different questions ("this number is taken" vs "the
                    check did not run"), and hiding this one behind !docNoDup
                    would hide the retry exactly when the admin needs it. */}
                {docNoLedgerFailed && (
                  <div className="mt-1 text-xs text-amber-600 font-semibold">
                    <p>
                      ⚠ ตรวจสอบเลขที่ที่ใช้ไปแล้วไม่สำเร็จ — ระบบจึงยังไม่ออกเลขที่ให้
                      และยังยืนยันไม่ได้ว่าเลขที่นี้ว่าง
                    </p>
                    <button
                      type="button"
                      onClick={() => setDocNoLedgerAttempt((n) => n + 1)}
                      className="mt-1 px-2 py-1 rounded border border-amber-400 text-amber-700 hover:bg-amber-50 transition"
                    >
                      🔄 ลองตรวจสอบเลขที่อีกครั้ง
                    </button>
                  </div>
                )}
              </div>
              <div>
                <label className={labelCls}>วันที่ (Date)</label>
                <input type="date" className={inputCls} value={q.docDate} onChange={(e) => set("docDate", e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>ยืนราคา (วัน)</label>
                <input type="number" min={0} className={inputCls} value={q.validDays}
                  onChange={(e) => set("validDays", Math.max(0, Number(e.target.value)))} />
              </div>
              <div>
                <label className={labelCls}>เลขผู้เสียภาษี (บริษัทเรา)</label>
                <input className={inputCls} placeholder="0-0000-00000-00-0" value={q.companyTaxId}
                  onChange={(e) => set("companyTaxId", e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>โทรบริษัท</label>
                <input className={inputCls} value={q.companyPhone} onChange={(e) => set("companyPhone", e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>อีเมลบริษัท</label>
                <input className={inputCls} value={q.companyEmail} onChange={(e) => set("companyEmail", e.target.value)} />
              </div>
            </div>
          </section>

          {/* เซลล์ */}
          <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 space-y-3 relative z-30">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <h2 className="font-bold text-gray-800">พนักงานขาย (Sales)</h2>
              <SearchableDropdown
                className="w-[240px]"
                placeholder="+ เลือกพนักงานขาย"
                value={q.sellerId || ""}
                options={dbSalespeople.map(s => ({
                  value: s.id,
                  label: s.name,
                  subLabel: s.phone || s.email || ""
                }))}
                onChange={(val) => {
                  const s = dbSalespeople.find(x => x.id === val);
                  if (s) {
                    set("sellerId", val);
                    setQ(prev => ({
                      ...prev,
                      sellerName: s.name,
                      sellerPhone: s.phone || prev.sellerPhone,
                      sellerEmail: s.email || prev.sellerEmail
                    }));
                  }
                }}
                buttonClassName="!bg-blue-50 !border-blue-300 !text-blue-700 hover:!bg-blue-100 font-medium transition-colors"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className={labelCls}>ชื่อเซลล์</label>
                <input className={inputCls} value={q.sellerName} onChange={(e) => set("sellerName", e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>โทร</label>
                <input className={inputCls} value={q.sellerPhone} onChange={(e) => set("sellerPhone", e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>อีเมล</label>
                <input className={inputCls} value={q.sellerEmail} onChange={(e) => set("sellerEmail", e.target.value)} />
              </div>
            </div>
          </section>

          {/* ลูกค้า */}
          <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <h2 className="font-bold text-gray-800">ข้อมูลลูกค้า</h2>
              <div className="flex flex-wrap gap-2 relative z-20">
                <SearchableDropdown
                  className="w-[240px]"
                  placeholder="+ เลือกลูกค้าจากระบบ"
                  value={q.customerId || ""}
                  options={dbCustomers.map(c => ({
                    value: c.id,
                    label: c.name,
                    subLabel: c.companyName || ""
                  }))}
                  onChange={(val) => {
                    const c = dbCustomers.find(x => x.id === val);
                    if (c) {
                      const comp = dbCompanies.find(x => x.id === c.companyId);
                      // Task 14.2 — keep the id of the row that was picked, not
                      // just its name.
                      const customer = selectPartyFromSystem(c);
                      // The company name shown may come from the customer's own
                      // free-text `companyName` rather than from `comp`, so run
                      // it back through the same "typed over" rule: the company
                      // id survives only while the two names still agree.
                      const company = applyTypedPartyName(
                        selectPartyFromSystem(comp),
                        c.companyName || comp?.name || ""
                      );
                      setQ(prev => ({
                        ...prev,
                        customerContact: customer.name,
                        customerId: customer.id,
                        customerCompany: company.name,
                        companyId: company.id,
                        customerAddress: comp ? formatAddress(comp) : prev.customerAddress,
                        customerPhone: c.phone || comp?.phone || prev.customerPhone,
                        customerEmail: c.email || prev.customerEmail
                      }));
                    }
                  }}
                  buttonClassName="!bg-emerald-50 !border-emerald-300 !text-emerald-700 hover:!bg-emerald-100 font-medium transition-colors"
                />
                <SearchableDropdown
                  className="w-[240px]"
                  placeholder="+ เลือกบริษัทจากระบบ"
                  value={q.companyId || ""}
                  options={dbCompanies.map(c => ({
                    value: c.id,
                    label: c.name
                  }))}
                  onChange={(val) => {
                    const comp = dbCompanies.find(x => x.id === val);
                    if (comp) {
                      // Task 14.2 — the picked company keeps its id.
                      const company = selectPartyFromSystem(comp);
                      // Validate if current customer is a known DB customer
                      const currentCust = dbCustomers.find(c => c.name === q.customerContact);
                      if (currentCust && currentCust.companyId && currentCust.companyId !== comp.id) {
                        showToast(`ลูกค้า ${currentCust.name} ไม่ได้อยู่บริษัทนี้`, "error");
                        // Clear customer name since user explicitly chose a different company
                        setQ(prev => ({
                          ...prev,
                          // The name goes, so its id must go with it (task 14.3)
                          // — otherwise the blob would carry a customerId that
                          // no longer matches anything printed on the document.
                          customerContact: "",
                          customerId: "",
                          customerCompany: company.name,
                          companyId: company.id,
                          customerAddress: formatAddress(comp),
                          customerPhone: comp.phone || prev.customerPhone
                        }));
                        return;
                      }

                      setQ(prev => ({
                        ...prev,
                        customerCompany: company.name,
                        companyId: company.id,
                        customerAddress: formatAddress(comp),
                        customerPhone: comp.phone || prev.customerPhone
                      }));
                    }
                  }}
                  buttonClassName="!bg-purple-50 !border-purple-300 !text-purple-700 hover:!bg-purple-100 font-medium transition-colors"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>ชื่อผู้ติดต่อ</label>
                <input className={inputCls} value={q.customerContact} onChange={(e) => setParty("customer", e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>บริษัทลูกค้า</label>
                <input className={inputCls} value={q.customerCompany} onChange={(e) => setParty("company", e.target.value)} />
              </div>
              <div className="col-span-2">
                <label className={labelCls}>ที่อยู่บริษัทลูกค้า</label>
                <textarea rows={2} className={inputCls} value={q.customerAddress} onChange={(e) => set("customerAddress", e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>โทร</label>
                <input className={inputCls} value={q.customerPhone} onChange={(e) => set("customerPhone", e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>อีเมล</label>
                <input className={inputCls} value={q.customerEmail} onChange={(e) => set("customerEmail", e.target.value)} />
              </div>
            </div>
          </section>

          {/* รายการสินค้า */}
          <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-gray-800">รายการสินค้า ({q.items.length})</h2>
              <button onClick={addItem} className="px-3 py-1.5 rounded-lg bg-orange-500 text-white text-sm font-bold hover:bg-orange-600 transition">
                + เพิ่มรายการ
              </button>
            </div>
            {q.items.map((it, idx) => (
              <div key={it.id} className={`border border-dashed border-gray-300 rounded-lg p-3 space-y-2 relative ${idx % 2 === 0 ? 'bg-pink-50' : 'bg-green-50'}`}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-gray-400">#{idx + 1}</span>
                  <div className="flex gap-1">
                    <button onClick={() => moveItem(it.id, -1)} disabled={idx === 0} title="เลื่อนขึ้น"
                      className="w-7 h-7 rounded bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-30 text-xs">↑</button>
                    <button onClick={() => moveItem(it.id, 1)} disabled={idx === q.items.length - 1} title="เลื่อนลง"
                      className="w-7 h-7 rounded bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-30 text-xs">↓</button>
                    <button onClick={() => removeItem(it.id)} title="ลบรายการ"
                      className="w-7 h-7 rounded bg-red-100 text-red-500 hover:bg-red-500 hover:text-white text-xs font-bold">✕</button>
                  </div>
                </div>
                <SearchableDropdown
                  className="w-full"
                  buttonClassName={inputCls}
                  placeholder="📦 เลือกจากสินค้าในระบบ (autofill ชื่อ+รูป)…"
                  value=""
                  onChange={(val) => applyProduct(it.id, val)}
                  options={products.map((p) => ({
                    value: p.id,
                    label: stripHtml(p.title_th || p.title_en).replace(/🐧/g, "").trim()
                  }))}
                />
                {it.productId && dbProductSpecs.filter(s => s.productId === it.productId).length > 0 && (
                  <SearchableDropdown
                    className="w-full"
                    buttonClassName={`${inputCls} !bg-blue-50 !border-blue-200 !text-blue-800 font-medium`}
                    placeholder="📋 เลือกสเปคเพื่อเติมข้อความอัตโนมัติ (Optional)"
                    value=""
                    onChange={(val) => {
                      const spec = dbProductSpecs.find(s => s.id === val);
                      if (spec) setItem(it.id, { description: spec.detail });
                    }}
                    options={dbProductSpecs.filter(s => s.productId === it.productId).map(s => ({
                      value: s.id,
                      label: s.name
                    }))}
                  />
                )}
                <input className={inputCls} placeholder="ชื่อเครื่อง / รุ่น" value={it.name}
                  onChange={(e) => setItem(it.id, { name: e.target.value })} />
                <textarea rows={2} className={inputCls} placeholder="รายละเอียด / สเปค (ถ้ามี)" value={it.description}
                  onChange={(e) => setItem(it.id, { description: e.target.value })} />
                <div className="flex items-center gap-2">
                  {it.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={it.imageUrl} alt="" className="w-12 h-12 object-contain border border-gray-200 rounded bg-white" />
                  ) : (
                    <div className="w-12 h-12 border border-dashed border-gray-300 rounded flex items-center justify-center text-gray-300 text-xs">รูป</div>
                  )}
                  <button
                    onClick={() => { uploadTargetRef.current = it.id; imageInputRef.current?.click(); }}
                    disabled={uploadingItemId === it.id}
                    className="px-3 py-1.5 text-xs rounded-lg bg-orange-100 text-orange-600 hover:bg-orange-200 transition font-semibold border border-orange-300 disabled:opacity-50"
                  >
                    {uploadingItemId === it.id ? "กำลังอัปโหลด..." : "📷 อัปโหลดรูป"}
                  </button>
                  {it.imageUrl && (
                    <button onClick={() => setItem(it.id, { imageUrl: "", imageUploaded: false })}
                      className="px-3 py-1.5 text-xs rounded-lg text-gray-500 hover:text-red-500 transition font-semibold">
                      เอารูปออก
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className={labelCls}>จำนวน</label>
                    <input type="number" min={0} className={inputCls} value={it.qty}
                      onChange={(e) => setItem(it.id, { qty: Math.max(0, Number(e.target.value)) })} />
                  </div>
                  <div>
                    <label className={labelCls}>หน่วย</label>
                    <input className={inputCls} value={it.unit} onChange={(e) => setItem(it.id, { unit: e.target.value })} />
                  </div>
                  <div>
                    <label className={labelCls}>ราคา/หน่วย (฿)</label>
                    <NumberInput className={inputCls} placeholder="0.00"
                      value={it.unitPrice}
                      onChange={(v) => setItem(it.id, { unitPrice: v })} />
                  </div>
                </div>
                {/* ── ส่วนลดรายรายการ (task 7) ────────────────────────────
                    Mirrors the document-level control below: FormattedNumberInput
                    for the money, SearchableDropdown for ฿/% (never a native
                    <select> — AGENTS.md). The right-hand cell prints the money
                    this line actually comes to, so the figure on the sheet is
                    never a mystery. */}
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className={labelCls}>ส่วนลดรายการนี้</label>
                    <FormattedNumberInput
                      className={inputCls}
                      placeholder="0"
                      value={it.discount ?? 0}
                      onChange={(v) => setLineDiscount(it.id, v)}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>ประเภทส่วนลด</label>
                    <SearchableDropdown
                      searchable={false}
                      className="w-full"
                      buttonClassName={`${inputCls} h-[38px]`}
                      value={it.discountType ?? "amount"}
                      options={[
                        { value: "amount", label: "บาท (฿)" },
                        { value: "percent", label: "เปอร์เซ็นต์ (%)" },
                      ]}
                      onChange={(val) => setLineType(it.id, val)}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>เป็นเงิน (หลังหักส่วนลด)</label>
                    <div className="px-3 py-2 rounded-lg border border-gray-200 bg-white/70 text-sm text-right">
                      {(lines[idx]?.discountValue ?? 0) > 0 ? (
                        <>
                          <span className="text-gray-400 line-through text-xs mr-1">
                            {fmt(lines[idx].amount)}
                          </span>
                          <span className="font-bold text-gray-800">
                            {fmt(lines[idx].netAmount)}
                          </span>
                        </>
                      ) : (
                        <span className="font-bold text-gray-800">
                          {fmt(lines[idx]?.netAmount ?? 0)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
            <p className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
              ℹ️ ส่วนลดรายรายการจะถูกหักก่อน จากนั้นจึงนำ
              <span className="font-semibold"> ส่วนลดท้ายใบ </span>
              (ในหัวข้อ “ส่วนลด / VAT / เงื่อนไข” ด้านล่าง) มาหักจากยอดที่เหลืออีกครั้ง แล้วจึงคิด VAT
            </p>
          </section>

          {/* สรุปยอด + เงื่อนไข */}
          <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 space-y-3">
            <h2 className="font-bold text-gray-800">ส่วนลด / VAT / เงื่อนไข</h2>
            {/* Says out loud what quotationTotals.ts does: this discount is
                taken off the sum of the ALREADY line-discounted amounts. */}
            <p className="text-xs text-gray-500 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              ⬇️ ส่วนลดด้านล่างนี้เป็น<span className="font-semibold">ส่วนลดท้ายใบ</span> —
              หักจากยอดรวม<span className="font-semibold">หลัง</span>หักส่วนลดรายรายการแล้ว
              {hasLineDiscounts && (
                <> (ตอนนี้คือ <span className="font-semibold">{fmt(afterLineDiscounts)}</span> บาท)</>
              )}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>ส่วนลดท้ายใบ</label>
                <NumberInput className={inputCls} placeholder="0"
                  value={q.discount}
                  onChange={(v) => set("discount", v)} />
              </div>
              <div>
                <label className={labelCls}>ประเภทส่วนลด</label>
                {/* ── ประเภทส่วนลด ────────────────────────────────────────
                    PROJECT RULE — every dropdown is `SearchableDropdown`,
                    never a native <select>. A native one is painted by the
                    OPERATING SYSTEM, so on a dark-mode machine it opens as a
                    dark grey popup in the middle of this white form.
                    `searchable={false}` hides the search box that would be
                    dead weight over two fixed options.

                    The two values are the ones `computeQuoteTotals` branches
                    on ("percent" vs everything else) and the ones persisted in
                    `QuoteState.discountType` — unchanged, in the same order,
                    with "amount" still the default from `emptyState()`. The
                    old <select> carried no `required` and no `invalid:`
                    variant (it can never be empty), so there is no browser
                    validation to replace here.

                    `inputCls` keeps the button on the same 1-of-2 grid cell as
                    the ส่วนลด input beside it; the explicit height pins it to
                    the 38px that `px-3 py-2` + border gives that input,
                    instead of inheriting the component's shorter `py-1.5`. */}
                <SearchableDropdown
                  searchable={false}
                  className="w-full"
                  buttonClassName={`${inputCls} h-[38px]`}
                  value={q.discountType}
                  options={[
                    { value: "amount", label: "บาท (฿)" },
                    { value: "percent", label: "เปอร์เซ็นต์ (%)" },
                  ]}
                  onChange={(val) => set("discountType", val as "amount" | "percent")}
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700 font-medium">
              <input type="checkbox" checked={q.vatEnabled} onChange={(e) => set("vatEnabled", e.target.checked)}
                className="w-4 h-4 accent-orange-500" />
              คิดภาษีมูลค่าเพิ่ม (VAT 7%)
            </label>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="font-bold text-gray-800">เงื่อนไขอื่นๆ</label>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setQ(prev => ({ ...prev, conditions: emptyState().conditions }))}
                    className="text-gray-500 hover:text-gray-700 text-sm font-medium flex items-center gap-1"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
                    คืนค่าเริ่มต้น
                  </button>
                  <button
                    type="button"
                    onClick={() => setQ(prev => ({
                      ...prev,
                      conditions: [...(prev.conditions || []), { id: crypto.randomUUID(), label: "", value: "" }]
                    }))}
                    className="text-orange-600 hover:text-orange-700 text-sm font-medium flex items-center gap-1"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"/></svg>
                    เพิ่มเงื่อนไข
                  </button>
                </div>
              </div>
              
              {(q.conditions || []).map((cond, idx) => (
                <div key={cond.id} className="p-3 bg-gray-50 border border-gray-200 rounded-lg space-y-2 relative">
                  <button
                    type="button"
                    onClick={() => setQ(prev => ({
                      ...prev,
                      conditions: (prev.conditions || []).filter(c => c.id !== cond.id)
                    }))}
                    className="absolute top-2 right-2 text-gray-400 hover:text-red-500"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"/></svg>
                  </button>
                  <div className="pr-8 space-y-2">
                    <input 
                      placeholder="หัวข้อ (เช่น เงื่อนไขชำระเงิน)" 
                      className={`${inputCls} font-bold text-gray-800`}
                      value={cond.label} 
                      onChange={(e) => {
                        const newConds = [...(q.conditions || [])];
                        newConds[idx].label = e.target.value;
                        set("conditions", newConds);
                      }} 
                    />
                    <textarea 
                      rows={2} 
                      placeholder="รายละเอียด"
                      className={inputCls} 
                      value={cond.value} 
                      onChange={(e) => {
                        const newConds = [...(q.conditions || [])];
                        newConds[idx].value = e.target.value;
                        set("conditions", newConds);
                      }} 
                    />
                  </div>
                </div>
              ))}
            </div>
            <div>
              <label className={labelCls}>หมายเหตุเพิ่มเติม</label>
              <textarea rows={2} className={inputCls} value={q.note} onChange={(e) => set("note", e.target.value)} />
            </div>
          </section>
        </div>
        )}

        {/* ══ RIGHT: A4 sheet (what gets printed) ══ */}
        <div className={`overflow-x-auto ${!isViewOnly ? "xl:sticky xl:top-[90px] xl:max-h-[calc(100vh-100px)] xl:overflow-y-auto" : ""} rounded-sm`}>
          <div
            id="quote-sheet"
            className="bg-white shadow-lg border border-gray-200 rounded-sm mx-auto text-gray-900"
            style={{ width: "210mm", minHeight: "297mm", padding: "12mm 14mm", fontSize: "13px", lineHeight: 1.55 }}
          >
            {/* Header */}
            <div id="quote-header">
              <div className="flex justify-between items-start gap-4 pb-3 border-b-2 border-gray-800">
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
                      {q.companyPhone && <>โทร {q.companyPhone} </>}
                      {q.companyEmail && <>อีเมล {q.companyEmail}</>}
                    </div>
                    {q.companyTaxId && (
                      <div className="text-xs">เลขประจำตัวผู้เสียภาษี {q.companyTaxId}</div>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-2xl font-bold tracking-wide">ใบเสนอราคา</div>
                  <div className="text-sm text-gray-500 tracking-widest">QUOTATION</div>
                </div>
              </div>

              {/* Doc info + customer */}
              <div id="quote-customer-info" className="flex justify-between gap-6 mt-3 text-[12.5px]">
                <div className="flex-1">
                  <div className="font-bold text-gray-700 mb-1">เรียน (To)</div>
                  <div className="font-semibold">{q.customerContact || "-"}</div>
                  {q.customerCompany && <div>{q.customerCompany}</div>}
                  {q.customerAddress && <div className="whitespace-pre-line text-gray-700">{q.customerAddress}</div>}
                  {q.customerPhone && <div className="text-gray-700">โทร {formatPhone(q.customerPhone)}</div>}
                  {q.customerEmail && <div className="text-gray-700 break-all">อีเมล {q.customerEmail}</div>}
                </div>
                <table className="shrink-0 self-start text-[12.5px]">
                  <tbody>
                    <tr>
                      <td className="pr-3 py-0.5 font-bold text-gray-700 text-right">เลขที่ (No.)</td>
                      <td className="py-0.5 text-right">{q.docNo || "-"}</td>
                    </tr>
                    <tr>
                      <td className="pr-3 py-0.5 font-bold text-gray-700 text-right">วันที่ (Date)</td>
                      <td className="py-0.5 text-right">{thaiDate(q.docDate)}</td>
                    </tr>
                    <tr>
                      <td className="pr-3 py-0.5 font-bold text-gray-700 text-right">ยืนราคา (Valid)</td>
                      <td className="py-0.5 text-right">{q.validDays} วัน</td>
                    </tr>
                    <tr>
                      <td className="pr-3 py-0.5 font-bold text-gray-700 align-top text-right">พนักงานขาย</td>
                      <td className="py-0.5 text-right">
                        <div className="text-gray-900">{q.sellerName || "-"}</div>
                      </td>
                    </tr>
                    {(q.sellerPhone || q.sellerEmail) && (
                      <tr>
                        <td colSpan={2} className="py-0.5 text-right">
                          <div className="text-[11.5px] text-gray-500 mt-0.5 flex flex-col items-end">
                            {q.sellerPhone && <div>โทร: {formatPhone(q.sellerPhone)}</div>}
                            {q.sellerEmail && <div className="break-all text-right">อีเมล: {q.sellerEmail}</div>}
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Items table */}
            <table id="quote-table" className="w-full mt-4 border-collapse text-[12.5px]">
              <thead>
                <tr className="bg-gray-800 text-white">
                  <th className="border border-gray-800 px-2 py-1.5 w-[8mm]">ลำดับ</th>
                  <th className="border border-gray-800 px-2 py-1.5 text-left">รายการ</th>
                  <th className="border border-gray-800 px-2 py-1.5 w-[14mm]">จำนวน</th>
                  <th className="border border-gray-800 px-2 py-1.5 w-[14mm]">หน่วย</th>
                  <th className="border border-gray-800 px-2 py-1.5 w-[24mm]">ราคา/หน่วย</th>
                  {/* The discount column exists ONLY when a line actually
                      carries one, so an old quotation prints the identical
                      six-column table it always did (task 7). */}
                  {hasLineDiscounts && (
                    <th className="border border-gray-800 px-2 py-1.5 w-[22mm]">ส่วนลด</th>
                  )}
                  <th className="border border-gray-800 px-2 py-1.5 w-[26mm]">จำนวนเงิน (บาท)</th>
                </tr>
              </thead>
              <tbody id="quote-tbody">
                {q.items.length === 0 && (
                  <tr>
                    <td colSpan={hasLineDiscounts ? 7 : 6} className="border border-gray-300 px-2 py-6 text-center text-gray-400">
                      — ยังไม่มีรายการสินค้า —
                    </td>
                  </tr>
                )}
                {q.items.map((it, idx) => (
                  <tr key={it.id} className="align-top" data-item-id={it.id}>
                    <td className="border border-gray-300 px-2 py-1.5 text-center">{idx + 1}</td>
                    <td className="border border-gray-300 px-2 py-1.5">
                      <div className="font-semibold">{it.name || "-"}</div>
                      {it.description && (
                        <div className="mt-1 text-gray-600 whitespace-pre-line text-[11.5px]">{it.description}</div>
                      )}
                      {/* Image sits below the description, only when one was added */}
                      {it.imageUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={it.imageUrl} alt="" className="mt-1.5 object-contain" style={{ maxWidth: "40mm", maxHeight: "32mm" }} />
                      )}
                    </td>
                    <td className="border border-gray-300 px-2 py-1.5 text-center">{it.qty}</td>
                    <td className="border border-gray-300 px-2 py-1.5 text-center">{it.unit}</td>
                    <td className="border border-gray-300 px-2 py-1.5 text-right">{fmt(it.unitPrice)}</td>
                    {hasLineDiscounts && (
                      <td className="border border-gray-300 px-2 py-1.5 text-right">
                        {(lines[idx]?.discountValue ?? 0) > 0 ? (
                          <>
                            -{fmt(lines[idx].discountValue)}
                            {it.discountType === "percent" && (
                              <div className="text-[11px] text-gray-500">({it.discount}%)</div>
                            )}
                          </>
                        ) : (
                          "-"
                        )}
                      </td>
                    )}
                    {/* With no line discounts this is the exact expression the
                        sheet has always printed; with them it prints the net,
                        which is what the discount column and the totals below
                        add up to. */}
                    <td className="border border-gray-300 px-2 py-1.5 text-right">
                      {fmt(hasLineDiscounts ? lines[idx].netAmount : it.qty * it.unitPrice)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Totals */}
            <div id="quote-footer" className="flex justify-between gap-6 mt-3">
              <div className="flex-1 text-[12px]">
                <div className="space-y-0.5 text-gray-700">
                  <div className="font-bold text-gray-800">เงื่อนไข</div>
                  {(q.conditions || []).map((cond) => (
                    (cond.label || cond.value) ? (
                      <div key={cond.id} className="whitespace-pre-line">
                        • {cond.label}{cond.label && cond.value ? ': ' : ''}{cond.value}
                      </div>
                    ) : null
                  ))}
                </div>
                {q.note && (
                  <div className="mt-3 space-y-0.5 text-gray-700">
                    <div className="font-bold text-gray-800">หมายเหตุ</div>
                    <div className="whitespace-pre-line">{q.note}</div>
                  </div>
                )}
              </div>
              <table className="shrink-0 self-start w-[70mm] text-[12.5px]">
                <tbody>
                  {/* Without line discounts: the single "รวมเป็นเงิน" row the
                      sheet has always had. With them: the gross first, the
                      line discounts taken off, and "รวมเป็นเงิน" left equal to
                      the SUM OF THE PRINTED LINE AMOUNTS — so the customer can
                      still add the column up and land on it. */}
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
                          {/* "ท้ายใบ" only when there are line discounts to
                              tell it apart from — otherwise the old wording. */}
                          {hasLineDiscounts ? "ส่วนลดท้ายใบ" : "ส่วนลด"}
                          {q.discountType === "percent" ? ` ${q.discount}%` : ""}
                        </td>
                        <td className="py-1 text-right">-{fmt(discountValue)}</td>
                      </tr>
                      <tr>
                        <td className="py-1 pr-2">ยอดหลังหักส่วนลด</td>
                        <td className="py-1 text-right">{fmt(afterDiscount)}</td>
                      </tr>
                    </>
                  )}
                  {q.vatEnabled && (
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

            {/* Signatures */}
            <div id="quote-signatures" className="grid grid-cols-3 gap-6 mt-10 text-center text-[12px]">
              {[
                { title: "ผู้เสนอราคา", name: q.sellerName },
                null,
                { title: "ผู้สั่งซื้อ (ลูกค้า)", name: "" },
              ].map((s, idx) => 
                s ? (
                  <div key={s.title}>
                    <div className="border-b border-gray-400 h-12 mb-2" />
                    <div className="min-h-[18px] mt-2 text-gray-800">{s.name}</div>
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
    </div>

    {orphanedImages.length > 0 && (
      <ImageDeleteConfirmDialog
        images={orphanedImages}
        onComplete={() => setOrphanedImages([])}
      />
    )}

    {/* ── Unsaved-changes confirmation modal ── */}
    {showLeaveConfirm && (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm">
        <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full mx-4 overflow-hidden animate-fade-in-up">
          <div className="p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center text-2xl flex-shrink-0">
                ⚠️
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-900">มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก</h3>
                <p className="text-sm text-gray-500 mt-1">คุณต้องการบันทึกใบเสนอราคานี้ก่อนออกจากหน้านี้หรือไม่?</p>
              </div>
            </div>
          </div>
          <div className="px-6 pb-6 flex flex-col gap-2">
            <button
              onClick={async () => {
                setShowLeaveConfirm(false);
                await handleSave();
              }}
              disabled={savingQuote || docNoDup}
              className="w-full px-4 py-3 rounded-xl bg-green-500 text-white font-bold text-sm hover:bg-green-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              💾 บันทึกแล้วออก
            </button>
            <button
              onClick={() => {
                setShowLeaveConfirm(false);
                savedSnapshotRef.current = stateFingerprint(q); // prevent re-triggering
                if (pendingNav) router.push(pendingNav);
                setPendingNav(null);
              }}
              className="w-full px-4 py-3 rounded-xl bg-red-50 text-red-600 font-bold text-sm hover:bg-red-100 transition border border-red-200"
            >
              🚪 ออกโดยไม่บันทึก
            </button>
            <button
              onClick={() => {
                setShowLeaveConfirm(false);
                setPendingNav(null);
              }}
              className="w-full px-4 py-3 rounded-xl bg-gray-100 text-gray-700 font-semibold text-sm hover:bg-gray-200 transition"
            >
              ← อยู่ต่อในหน้านี้
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
