"use client";
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import AdminHomeButton from "../components/AdminHomeButton";
import { useRouter } from "next/navigation";
import { useAuth } from "../context/AuthContext";
import Toast from "../components/Toast";
import {
  DOCNO_START,
  pad2,
  nextDocNo,
  quotationDocNoPrefix,
  quotationDocNoPrefixes,
  splitDocNoVersion,
} from "../lib/quotationNumber";
import { toLocalDateString } from "../lib/dateFormat";
import {
  computeQuoteTotals,
  CURRENT_TOTALS_VERSION,
  setLineDiscountAmount,
  setLineDiscountType,
} from "../lib/quotationTotals";
import { stripHtml } from "../lib/stripHtml";
import { selectPartyFromSystem, applyTypedPartyName } from "../lib/quotationToSale";
import SearchableDropdown from "../components/SearchableDropdown";
import FormattedNumberInput from "../components/FormattedNumberInput";
import ConfirmDialog from "../components/ConfirmDialog";
import ImageDeleteConfirmDialog, { type OrphanedImage } from "../components/ImageDeleteConfirmDialog";
import DatePicker from "../components/DatePicker";
import { uploadFormData } from "../lib/uploadClient";
import { bahtText } from "../lib/bahtText";
import { retentionLabel } from "../lib/quotationRetention";
import {
  LEGACY_DRAFT_KEY,
  browserStorage,
  draftKey,
  loadDraft,
  removeDraft,
  saveDraft,
  type DraftContext,
  type QuoteDraft,
} from "./quoteDraft";

// ── ใบเสนอราคา (Quotation builder) ──────────────────────────────────────────
// Admin-only tool: fill the form on the left, see a live A4 sheet on the right,
// then "ดาวน์โหลด PDF" renders ONLY the sheet to a PDF in the browser (no
// server-side PDF dependencies — heavy PDF/DOM libs have already broken this
// app on Vercel once). An unsaved document is kept as a draft in the browser
// (quoteDraft.ts) and offered back when the page is opened again.

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
  /** Which arithmetic this document was issued under (lib/quotationTotals.ts).
   *  A FRESH document gets the current one (2026-10-07 on); a new version keeps
   *  its source's, so a saved document without it keeps the original for good. */
  totalsVersion?: number;
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

/** The salesperson last saved on a quotation from this browser — each sales
 *  person usually works from their own computer, so a new quotation starts
 *  with them instead of a blank "พนักงานขาย". Kept per signed-in user, so on
 *  a shared computer each admin gets their own. */
const LAST_SELLER_KEY = "quotation-last-seller-v1";
const lastSellerKey = (owner: string) => (owner ? `${LAST_SELLER_KEY}:${owner}` : LAST_SELLER_KEY);
type SellerFields = Pick<QuoteState, "sellerId" | "sellerName" | "sellerPhone" | "sellerEmail">;

function readLastSeller(owner: string): Partial<SellerFields> {
  try {
    const raw = JSON.parse(window.localStorage.getItem(lastSellerKey(owner)) || "null");
    if (!raw || typeof raw.sellerName !== "string" || !raw.sellerName.trim()) return {};
    const str = (v: unknown) => (typeof v === "string" ? v : "");
    return { sellerId: str(raw.sellerId), sellerName: raw.sellerName, sellerPhone: str(raw.sellerPhone), sellerEmail: str(raw.sellerEmail) };
  } catch {
    return {};
  }
}

function rememberSeller(q: SellerFields, owner: string) {
  if (!q.sellerName?.trim()) return;
  try {
    window.localStorage.setItem(
      lastSellerKey(owner),
      JSON.stringify({ sellerId: q.sellerId || "", sellerName: q.sellerName, sellerPhone: q.sellerPhone, sellerEmail: q.sellerEmail })
    );
  } catch {
    // A browser that will not store it just starts the next one blank.
  }
}

type CompanyFields = Pick<QuoteState, "companyPhone" | "companyEmail" | "companyTaxId">;
const COMPANY_FIELDS: (keyof CompanyFields)[] = ["companyPhone", "companyEmail", "companyTaxId"];

/** Our company's lines filled in from `defaults` — only where still blank,
 *  so nothing the admin has typed is ever overwritten. */
function fillCompanyDefaults<S extends CompanyFields>(state: S, defaults: Partial<CompanyFields> | null): S {
  if (!defaults) return state;
  let next = state;
  for (const key of COMPANY_FIELDS) {
    const value = (defaults[key] || "").trim();
    if (value && !state[key]?.trim()) next = { ...next, [key]: value };
  }
  return next;
}

/** ฿ or % for a discount — two buttons instead of a dropdown, which in the
 *  narrow item card was cut to "เปอร์เซ็…". */
function DiscountTypeToggle({
  value,
  onChange,
  label,
}: {
  value: "amount" | "percent";
  onChange: (v: "amount" | "percent") => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex shrink-0 rounded-lg border border-gray-200 bg-gray-50 p-0.5">
      {(
        [
          ["amount", "฿", "บาท"],
          ["percent", "%", "เปอร์เซ็นต์"],
        ] as const
      ).map(([v, sign, title]) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          aria-label={title}
          title={title}
          onClick={() => onChange(v)}
          className={`min-w-9 px-2.5 py-1 rounded-md text-sm font-semibold transition-colors ${
            value === v ? "bg-white text-orange-600 shadow-sm" : "text-gray-500 hover:text-gray-800"
          }`}
        >
          {sign}
        </button>
      ))}
    </div>
  );
}

/** A small square icon button for the item card's header. */
function IconButton({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`w-7 h-7 inline-flex items-center justify-center rounded-lg text-gray-400 transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
        danger ? "hover:text-red-500 hover:bg-red-50" : "hover:text-orange-600 hover:bg-orange-50"
      }`}
    >
      {children}
    </button>
  );
}

const ICON = "w-4 h-4";

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
const baseOfDocNo = (docNo: string) => splitDocNoVersion(docNo).base;

/** Does this number already carry a version suffix ("…-23v2")? */
const hasVersionSuffix = (docNo: string) => splitDocNoVersion(docNo.trim()).version !== null;

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

/**
 * The document as "unsaved changes" compares it: everything but its `id` (a
 * key for the stored record, not something the admin edits). One function for
 * every snapshot and every comparison, so two can never be built differently.
 * `id: undefined` drops the key from the JSON and keeps the others in order.
 */
function fingerprintOf(s: QuoteState): string {
  return JSON.stringify({ ...s, id: undefined });
}

/**
 * What the document SAYS, for comparing a draft with a document: like
 * `fingerprintOf`, but the conditions by their text alone. A quotation saved
 * before conditions existed gets them with fresh random ids on every load
 * (migrateQuoteState), so by ids it differed from its own draft every time.
 */
function contentFingerprint(s: QuoteState): string {
  return JSON.stringify(
    sortedKeys({
      ...s,
      id: undefined,
      conditions: (s.conditions || []).map((c) => [c.label, c.value]),
    })
  );
}

/** `v` with every object's keys in one order (and undefined values dropped,
 *  as JSON drops them) — a document and its draft may have been assembled in
 *  different orders without saying anything different. */
function sortedKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortedKeys);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (x !== undefined) out[k] = sortedKeys(x);
    }
    return out;
  }
  return v;
}

/** A stored draft this page can open: a quotation-shaped object with its
 *  lines. Anything else (hand-edited, from another version of the page) would
 *  crash the form on กู้คืน, so it is never offered. */
function isUsableDraftState(s: unknown): s is QuoteState {
  if (!s || typeof s !== "object") return false;
  const st = s as Partial<QuoteState>;
  return (
    Array.isArray(st.items) &&
    st.items.every((it) => !!it && typeof it === "object" && typeof it.id === "string") &&
    (st.conditions === undefined || Array.isArray(st.conditions)) &&
    (st.docNo === undefined || typeof st.docNo === "string")
  );
}

/** "2026-11-03" → a local Date for the date picker; null for anything else. */
function parseIsoDate(iso: string): Date | null {
  const [y, m, d] = (iso || "").split("-").map(Number);
  return y && m && d ? new Date(y, m - 1, d) : null;
}

/** Are these still exactly the three default conditions (ids aside)? */
function isDefaultConditions(conds: QuoteState["conditions"] | undefined): boolean {
  const defaults = emptyState().conditions;
  const list = conds || [];
  return (
    list.length === defaults.length &&
    list.every((c, i) => c.label === defaults[i].label && c.value === defaults[i].value)
  );
}

/** When a draft was last kept, as the offer says it ("3 พ.ย. 2569 10:32"). */
function draftTimeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("th-TH", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
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
  const { isLoggedIn, isLoading, user } = useAuth();
  // Whose drafts and remembered salesperson these are (quoteDraft.ts).
  const owner = user?.userId || "";
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

  // ── Drafts (quoteDraft.ts) ────────────────────────────────────────────────
  // WHICH document the open one is, for its draft: a new quotation, an edit of
  // a saved one, or a new version of a saved one.
  const [draftCtx, setDraftCtx] = useState<DraftContext>({ kind: "new" });
  // A draft found when the document opened, waiting for กู้คืน / ทิ้ง. Nothing
  // is autosaved meanwhile — that would overwrite the very draft on offer.
  // `stale`: an edit's draft whose saved quotation has changed since (someone
  // saved it after) — restoring and saving would overwrite that newer work.
  const [draftOffer, setDraftOffer] = useState<(QuoteDraft<QuoteState> & { stale?: boolean }) | null>(null);
  // The document is in place (new one seeded, or saved one loaded) and its
  // draft looked for. Before this, an autosave pass would act on the wrong
  // document — e.g. forget the "new" draft while a saved one is still loading.
  const [draftReady, setDraftReady] = useState(false);
  // Our company's lines for a new quotation (GET company-defaults), kept for
  // the reset too.
  const companyDefaultsRef = useRef<Partial<CompanyFields> | null>(null);
  const savingRef = useRef(false);

  const [confirmResetConditions, setConfirmResetConditions] = useState(false);
  // Item cards folded to one line (not saved — a view of the form only).
  const [collapsedItems, setCollapsedItems] = useState<ReadonlySet<string>>(new Set());
  // "ผู้เสนอราคา" (salesperson + our company lines): folded or open, per document.
  const [sellerUi, setSellerUi] = useState<{ docId: string; open: boolean }>({ docId: "", open: true });

  // Redirect if not logged in (same client gate as the other admin pages)
  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace("/login");
  }, [isLoggedIn, isLoading, router]);

  // Adopt a state as "the document currently open": it becomes the state AND
  // the clean snapshot, so isDirty only fires on edits made from here on.
  function adoptState(next: QuoteState) {
    setQ(next);
    savedSnapshotRef.current = fingerprintOf(next);
  }

  /**
   * A change the PAGE makes, not the admin — the running number moving past a
   * taken one, our company's lines arriving. On a document with no edits it
   * moves the clean snapshot along, so the change alone never makes it
   * "unsaved": an untouched new quotation used to warn on leaving (and would
   * now be kept as a draft) only because its number had advanced.
   */
  const setQAuto = useCallback((update: (prev: QuoteState) => QuoteState) => {
    setQ((prev) => {
      const next = update(prev);
      if (next !== prev && savedSnapshotRef.current !== "" && fingerprintOf(prev) === savedSnapshotRef.current) {
        savedSnapshotRef.current = fingerprintOf(next);
      }
      return next;
    });
  }, []);

  /** A brand-new document dated `iso` and numbered `docNo`: the current
   *  arithmetic, one empty line, and what can be filled in for the admin —
   *  the last salesperson used here, our company's lines when known. */
  const freshState = useCallback((iso: string, docNo: string): QuoteState => {
    // A NEW document: the current arithmetic. Not in emptyState() — every
    // reopened quotation is spread over that, and one saved without the key
    // must keep the arithmetic it was issued under.
    return fillCompanyDefaults(
      {
        ...emptyState(),
        ...readLastSeller(owner),
        id: randomId(),
        docDate: iso,
        docNo,
        items: [newItem()],
        totalsVersion: CURRENT_TOTALS_VERSION,
      },
      companyDefaultsRef.current
    );
  }, [owner]);

  const seedFresh = useCallback(() => {
    const iso = toLocalDateString(new Date());
    isFreshRef.current = true;
    setCloneSource(null);
    // A brand-new number is minted in the CURRENT shape (QT + DDMMYY + -NN).
    // The auto-advance effect below then walks it past the day's used numbers,
    // in BOTH shapes — see quotationDocNoPrefixes().
    const newDocNo = `${quotationDocNoPrefix(iso)}${pad2(DOCNO_START)}`;
    lastAutoDocNoRef.current = newDocNo;
    const fresh = freshState(iso, newDocNo);
    setQ(fresh);
    return fresh;
  }, [freshState]);

  const stateFingerprint = useCallback((s: QuoteState) => fingerprintOf(s), []);

  /** Open `ctx`'s draft for กู้คืน / ทิ้ง — unless it holds nothing the
   *  document on screen does not, or is not a draft this page can open (then
   *  it is simply dropped). An edit's draft whose saved quotation has changed
   *  since it was started is offered with a warning. */
  const offerDraftFor = useCallback(
    (ctx: DraftContext, current: QuoteState) => {
      const storage = browserStorage();
      const key = draftKey(ctx, owner);
      const d = loadDraft<QuoteState>(storage, key, Date.now());
      setDraftCtx(ctx);
      const now = contentFingerprint(current);
      if (d && isUsableDraftState(d.state) && contentFingerprint(d.state) !== now) {
        setDraftOffer({ ...d, stale: ctx.kind === "edit" && !!d.base && d.base !== now });
      } else {
        if (d) removeDraft(storage, key, Date.now());
        setDraftOffer(null);
      }
      setDraftReady(true);
    },
    [owner]
  );

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
        if (!d?.docNo) continue;
        // A version OF THIS BASE — not of "…-230", which merely starts with it.
        const { base: dBase, version } = splitDocNoVersion(d.docNo);
        if (dBase !== base || version === null) continue;
        if (!Number.isNaN(version) && version > maxV) maxV = version;
      }
    } catch {
      // Ledger unreachable — fall back to bumping this document's own version.
      maxV = splitDocNoVersion(docNo).version ?? 0;
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
  const openedRef = useRef(false);
  useEffect(() => {
    if (!isLoggedIn || openedRef.current) return;
    openedRef.current = true;
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
              // `totalsVersion` is carried over untouched: a new version
              // continues its source, in its arithmetic (quotationTotals.ts).
            }

            adoptState(migrated);
            const sourceId = rec.id || reopenId;
            if (isView) setDraftReady(true);
            else offerDraftFor(isClone ? { kind: "clone", sourceId } : { kind: "edit", id: sourceId }, migrated);
          } else {
            showToast("ไม่พบใบเสนอราคานี้ — เริ่มใบใหม่แทน", "error");
            setIsEditing(false);
            offerDraftFor({ kind: "new" }, seedFresh());
          }
        })
        .catch(() => {
          setIsEditing(false);
          offerDraftFor({ kind: "new" }, seedFresh());
        })
        .finally(() => {
          hydratedRef.current = true;
        });
      return;
    }

    // The single draft an old version of this page kept is never offered: it
    // carries no word of WHICH document it belonged to.
    try {
      browserStorage()?.removeItem(LEGACY_DRAFT_KEY);
    } catch {
      // Storage unavailable — nothing to clean up either.
    }
    offerDraftFor({ kind: "new" }, seedFresh());
    hydratedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn]);

  // Our company's lines for a NEW quotation — the latest ones used on a saved
  // quotation (and the company profile's phone). Filled in only where still
  // blank, and as the page's own change, so they never make it "unsaved".
  useEffect(() => {
    if (!isLoggedIn) return;
    let cancelled = false;
    fetch("/api/quotations/company-defaults")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d || typeof d !== "object") return;
        const defaults: Partial<CompanyFields> = {};
        for (const key of COMPANY_FIELDS) if (typeof d[key] === "string") defaults[key] = d[key];
        companyDefaultsRef.current = defaults;
        if (isFreshRef.current) setQAuto((prev) => fillCompanyDefaults(prev, defaults));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isLoggedIn, setQAuto]);

  // Set the snapshot once the fresh state is seeded.
  useEffect(() => {
    if (hydratedRef.current && savedSnapshotRef.current === "" && q.id) {
      savedSnapshotRef.current = fingerprintOf(q);
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

    fetch("/api/customers?fields=list")
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
    // setQAuto: the page moving its own number is not an edit (see there).
    setQAuto((prev) => {
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
  }, [q.docDate, knownDocNos, docNoLedgerReady, docNoLedgerFailed, setQAuto]);

  // ── Unsaved-changes guard ──
  // `stateFingerprint` (above) serializes only the user-editable fields.
  const isDirty = savedSnapshotRef.current !== "" && stateFingerprint(q) !== savedSnapshotRef.current;

  // ── Draft autosave ────────────────────────────────────────────────────────
  // While the document has unsaved edits it is kept, half a second after the
  // last keystroke, as this document's draft; once it is saved (or nothing
  // differs any more) the draft is dropped. Never while a draft is on offer.
  const draftPayloadRef = useRef<{ key: string; draft: QuoteDraft<QuoteState> } | null>(null);
  useEffect(() => {
    draftPayloadRef.current = null;
    if (!draftReady || isViewOnly || draftOffer || !q.id) return;
    const storage = browserStorage();
    const key = draftKey(draftCtx, owner);
    if (!isDirty) {
      removeDraft(storage, key, Date.now());
      return;
    }
    const payload = {
      key,
      draft: {
        savedAt: new Date().toISOString(),
        state: q,
        autoDocNo: isFreshRef.current && q.docNo === lastAutoDocNoRef.current,
        ...(cloneSource ? { cloneSource } : {}),
        // The saved quotation this edit started from: the clean snapshot is
        // exactly that document (an edit is never changed by setQAuto).
        ...(draftCtx.kind === "edit" && savedSnapshotRef.current
          ? { base: contentFingerprint(JSON.parse(savedSnapshotRef.current) as QuoteState) }
          : {}),
      },
    };
    draftPayloadRef.current = payload;
    const t = setTimeout(() => {
      saveDraft(storage, payload.key, payload.draft, Date.now());
      draftPayloadRef.current = null;
    }, 500);
    return () => clearTimeout(t);
  }, [q, isDirty, isViewOnly, draftOffer, draftReady, draftCtx, cloneSource, owner]);

  // The last half-second of typing, when the tab is hidden or closed before
  // the timer above fires.
  useEffect(() => {
    const flush = () => {
      const p = draftPayloadRef.current;
      if (p) saveDraft(browserStorage(), p.key, p.draft, Date.now());
      draftPayloadRef.current = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  /** กู้คืน: the draft becomes the document on screen — still UNSAVED (the
   *  clean snapshot stays the saved document's), so leaving still asks. */
  function restoreDraft() {
    const d = draftOffer;
    if (!d) return;
    setQ(migrateQuoteState({ ...emptyState(), ...d.state }));
    if (draftCtx.kind === "new") {
      // A number the page issued keeps being moved past taken ones.
      isFreshRef.current = !!d.autoDocNo;
      lastAutoDocNoRef.current = d.autoDocNo ? d.state.docNo : null;
    }
    if (d.cloneSource) setCloneSource(d.cloneSource);
    setDraftOffer(null);
    showToast("กู้คืนใบที่ยังไม่ได้บันทึกแล้ว", "success");
  }

  /** ทิ้ง: forget the draft, keep the document as it opened. */
  function discardDraft() {
    removeDraft(browserStorage(), draftKey(draftCtx, owner), Date.now());
    setDraftOffer(null);
  }

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

  // One timer at a time: a second message (บันทึกแล้ว, then a number moved on)
  // used to be cut short by the FIRST one's timer.
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function showToast(message: string, type: "success" | "error") {
    setToast({ message, type });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  }
  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);

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
  /** The same line again, right below it — the same machine in another
   *  configuration or quantity. It shares an uploaded image (persist() lists
   *  each image once). */
  const copyItem = (id: string) =>
    setQ((prev) => {
      const idx = prev.items.findIndex((it) => it.id === id);
      if (idx < 0) return prev;
      const items = [...prev.items];
      items.splice(idx + 1, 0, { ...prev.items[idx], id: randomId() });
      return { ...prev, items };
    });
  const toggleItemCollapsed = (id: string) =>
    setCollapsedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
      const res = await uploadFormData(formData);
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


  // ── Saving — one path for บันทึก, บันทึก + ดาวน์โหลด PDF and the leave dialog ─
  /**
   * POST the document. "conflict": another quotation owns the number, and the
   * document has been moved onto a free one (handleDocNoConflict) — the admin
   * sees it before pressing again. "failed": a refusal or no connection.
   * Throws nothing.
   */
  async function persist(): Promise<"saved" | "conflict" | "failed"> {
    const doc = q;
    // Only images uploaded for THIS quote are deletable — each once, though a
    // copied line shares its source's image.
    const uploadedImages = Array.from(
      new Set(doc.items.filter((it) => it.imageUploaded && it.imageUrl).map((it) => it.imageUrl))
    );
    try {
      const res = await fetch("/api/quotations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: doc.id, docNo: doc.docNo, data: doc, uploadedImages }),
      });
      if (res.status === 409) {
        const data = await res.json().catch(() => null);
        await handleDocNoConflict(data?.error);
        return "conflict";
      }
      if (!res.ok) return "failed";
    } catch {
      return "failed";
    }
    afterSaved(doc);
    return "saved";
  }

  /**
   * The document is on the server now. It stays on screen — saving used to
   * send the admin to the saved list, to open it again to download it — and
   * from here on it IS that saved quotation: clean, its number reserved, its
   * draft gone, the URL its own (so a refresh reopens it rather than starting
   * a new one), and its salesperson remembered for the next new quotation.
   */
  function afterSaved(doc: QuoteState) {
    savedSnapshotRef.current = stateFingerprint(doc);
    settleDocNo();
    const storage = browserStorage();
    removeDraft(storage, draftKey(draftCtx, owner), Date.now());
    if (draftCtx.kind !== "edit" || draftCtx.id !== doc.id) {
      removeDraft(storage, draftKey({ kind: "edit", id: doc.id }, owner), Date.now());
    }
    setDraftCtx({ kind: "edit", id: doc.id });
    setDraftOffer(null);
    setCloneSource(null);
    setIsEditing(true);
    // From the admin's own work only — downloading someone else's quotation
    // while viewing it is not choosing a salesperson.
    if (!isViewOnly) rememberSeller(doc, owner);
    if (!isViewOnly) router.replace(`/quotation?id=${encodeURIComponent(doc.id)}`);
  }

  // ── Download → save record → generate PDF → ask keep/delete ───────────────
  async function handleDownload() {
    if (generating || savingRef.current) return;
    if (draftOffer) {
      showToast("เลือก กู้คืน หรือ ทิ้ง ใบที่ค้างอยู่ก่อน", "error");
      return;
    }
    if (docNoDup) {
      showToast("เลขที่ใบเสนอราคานี้ซ้ำกับใบที่บันทึกไว้ กรุณาเปลี่ยนเลขที่ก่อน", "error");
      return;
    }
    setGenerating(true);
    savingRef.current = true;
    // Persist first: no PDF for a quotation that was not recorded, as for
    // billing, PO and service-job documents — the customer would hold a
    // number the system does not know, free to be issued again to someone
    // else. On a number conflict nothing is downloaded either: the sheet
    // still shows the refused number. (Saving used to be best-effort.)
    const result = await persist();
    savingRef.current = false;
    if (result !== "saved") {
      if (result === "failed") {
        showToast("บันทึกใบเสนอราคาไม่สำเร็จ จึงยังไม่ได้สร้าง PDF กรุณาลองใหม่", "error");
      }
      setGenerating(false);
      return;
    }
    try {
      await generatePdf();
    } catch {
      showToast("สร้าง PDF ไม่สำเร็จ กรุณาลองใหม่", "error");
      setGenerating(false);
      return;
    }
    setGenerating(false);
    setSavePrompt(true);
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
      // `totalsVersion` travels with `q`: a new version continues its source,
      // in its arithmetic (quotationTotals.ts).
      const version = { ...q, id: randomId(), docNo };
      adoptState(version);
      // An unsaved new version of this same quotation, left from before?
      offerDraftFor({ kind: "clone", sourceId: source.id }, version);
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
      const original = migrateQuoteState({ ...emptyState(), ...rec.data, id: rec.id || source.id });
      adoptState(original);
      // The new version being left is thrown away — and so is its draft.
      removeDraft(browserStorage(), draftKey({ kind: "clone", sourceId: source.id }, owner), Date.now());
      offerDraftFor({ kind: "edit", id: source.id }, original);
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
  /** Returns whether the document is now saved (the leave dialog goes on
   *  only then). Guarded by a ref too: Ctrl+S held down repeats. */
  async function handleSave(): Promise<boolean> {
    if (savingRef.current || generating) return false;
    // A save now would drop the draft on offer (it is this document's) before
    // the admin said which one to keep.
    if (draftOffer) {
      showToast("เลือก กู้คืน หรือ ทิ้ง ใบที่ค้างอยู่ก่อน", "error");
      return false;
    }
    if (docNoDup) {
      showToast("เลขที่ใบเสนอราคานี้ซ้ำกับใบที่บันทึกไว้ กรุณาเปลี่ยนเลขที่ก่อน", "error");
      return false;
    }
    savingRef.current = true;
    setSavingQuote(true);
    try {
      const result = await persist();
      if (result === "saved") {
        showToast(`บันทึกใบเสนอราคาแล้ว — เก็บไว้ในระบบ ${retentionLabel()}`, "success");
        return true;
      }
      if (result === "failed") showToast("บันทึกไม่สำเร็จ กรุณาลองใหม่", "error");
      return false;
    } finally {
      savingRef.current = false;
      setSavingQuote(false);
    }
  }

  // Ctrl+S / ⌘S saves the document on screen. By the KEY'S POSITION too: with
  // the Thai keyboard layout the same key reports "ห", not "s".
  const handleSaveRef = useRef(handleSave);
  useEffect(() => {
    handleSaveRef.current = handleSave;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      if (e.code !== "KeyS" && e.key.toLowerCase() !== "s") return;
      if (isViewOnly) return;
      e.preventDefault();
      handleSaveRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isViewOnly]);

  async function handleDeleteQuotation() {
    setDeletingQuote(true);
    try {
      const res = await fetch(`/api/quotations/${q.id}`, { method: "DELETE" });
      if (res.ok) {
        const data = await res.json();
        // Strip dead image refs from local state. What stays on screen is no
        // longer a saved document: a fresh id, and — being what the admin
        // chose to throw away — nothing that warns about leaving it.
        adoptState({
          ...q,
          id: randomId(),
          items: q.items.map((it) =>
            it.imageUploaded ? { ...it, imageUrl: "", imageUploaded: false } : it
          ),
        });
        if (!isViewOnly) {
          // The URL named the deleted quotation; a refresh must not look for it.
          setDraftCtx({ kind: "new" });
          setIsEditing(false);
          router.replace("/quotation?new=1");
        }
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

  // The same look as /customers and /product-specs: white cards, one orange
  // primary action, everything else plain.
  const inputCls =
    "w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 text-sm";
  const labelCls = "block text-xs font-semibold text-gray-600 mb-1";
  const SECTION = "bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-3";
  const H2 = "text-sm font-bold text-gray-800";
  const PICKER = "!px-3 !py-2 !rounded-lg !bg-white !border-gray-200 !shadow-none !text-sm h-[38px]";
  const PRIMARY_BUTTON =
    "px-4 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold transition shadow-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed";
  const SECONDARY_BUTTON =
    "px-4 py-2 rounded-xl bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 text-sm font-semibold transition shadow-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed";
  const NAV_BUTTON =
    "px-3 py-2 rounded-xl text-sm font-semibold text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition flex items-center gap-1.5";

  // Where the document on screen stands, beside the title.
  const status = isViewOnly
    ? { label: "ดูอย่างเดียว", cls: "bg-gray-100 text-gray-600" }
    : cloneSource
      ? { label: "เวอร์ชันใหม่ · ยังไม่ได้บันทึก", cls: "bg-amber-50 text-amber-700" }
      : isDirty
      ? { label: "ยังไม่ได้บันทึก", cls: "bg-amber-50 text-amber-700" }
      : isEditing
        ? { label: "บันทึกแล้ว", cls: "bg-emerald-50 text-emerald-700" }
        : { label: "ใบใหม่", cls: "bg-orange-50 text-orange-700" };

  // "ผู้เสนอราคา" starts open only when the document OPENS with no salesperson
  // on it — decided once per document, not live from the name: read live, it
  // folded the section shut on the first letter typed into an empty one.
  if (sellerUi.docId !== q.id) setSellerUi({ docId: q.id, open: !q.sellerName.trim() });
  const sellerExpanded = sellerUi.docId === q.id ? sellerUi.open : !q.sellerName.trim();

  return (
    <>
    <div className="min-h-screen bg-[#F8FAFC]">
      {toast && <Toast message={toast.message} type={toast.type} />}

      {showResetConfirm && (
        <ConfirmDialog
          title="ยืนยันการล้างข้อมูล"
          message="คุณต้องการล้างข้อมูลทั้งหมดและเริ่มทำใบเสนอราคาใหม่ใช่หรือไม่? ข้อมูลปัจจุบันที่ยังไม่ได้บันทึกจะสูญหาย"
          confirmText="เริ่มใหม่"
          cancelText="ยกเลิก"
          onConfirm={() => {
            setShowResetConfirm(false);
            removeDraft(browserStorage(), draftKey({ kind: "new" }, owner), Date.now());
            setDraftCtx({ kind: "new" });
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
            adoptState(freshState(iso, resetDocNo));
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
              <span className="font-semibold"> ลบให้อัตโนมัติเมื่อครบ {retentionLabel()}</span>
              {" "}หรือจะลบทันทีเลยก็ได้ (รูปที่อัปโหลดสำหรับใบนี้จะถูกลบออกจากคลาวด์ด้วย — รูปสินค้าจาก catalog ไม่ถูกลบ)
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setSavePrompt(false)}
                disabled={deletingQuote}
                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 font-semibold hover:bg-gray-50 transition text-sm disabled:opacity-60"
              >
                เก็บไว้ {retentionLabel()}
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

      {/* Back to the three default conditions — asked first: one click used
          to throw away every condition written for this customer. */}
      {confirmResetConditions && (
        <ConfirmDialog
          title="คืนค่าเงื่อนไขเริ่มต้น?"
          message="เงื่อนไขที่แก้ไว้ในใบนี้จะถูกแทนด้วยค่าเริ่มต้น (เงื่อนไขชำระเงิน · กำหนดส่งมอบ · การรับประกัน)"
          confirmText="คืนค่าเริ่มต้น"
          cancelText="ยกเลิก"
          onConfirm={() => {
            setQ((prev) => ({ ...prev, conditions: emptyState().conditions }));
            setConfirmResetConditions(false);
          }}
          onCancel={() => setConfirmResetConditions(false)}
        />
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

      {/* ── Toolbar ── one way back, the page's state, and its actions. */}
      <div className="no-print sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-gray-200 shadow-sm">
        <div className="max-w-[1400px] mx-auto px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0 flex-wrap">
            <button type="button" onClick={() => guardedNavigate("/billing/saved?tab=quotation")} className={NAV_BUTTON}>
              <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
              ใบเสนอราคาที่บันทึกไว้
            </button>
            <h1 className="text-xl font-bold text-gray-900">ใบเสนอราคา</h1>
            <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${status.cls}`} data-testid="quote-status">
              {status.label}
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <AdminHomeButton onNavigate={() => guardedNavigate("/adminpanel")} />
            {!isViewOnly && (
              <>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={savingQuote || generating || docNoDup || !!draftOffer}
                  title="บันทึก (Ctrl+S)"
                  className={SECONDARY_BUTTON}
                >
                  {savingQuote ? "กำลังบันทึก..." : "บันทึก"}
                </button>
                <button
                  type="button"
                  onClick={handleDownload}
                  disabled={generating || savingQuote || docNoDup || !!draftOffer}
                  className={PRIMARY_BUTTON}
                >
                  <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                  {generating ? "กำลังสร้าง PDF..." : "บันทึก + ดาวน์โหลด PDF"}
                </button>
              </>
            )}
            {/* ── "แก้ไข (New Ver.)" (task 6) ──────────────────────────────
                Shown ONLY while viewing a saved quotation, where it has one
                unambiguous meaning: turn this document into an editable new
                version. In clone mode the page already IS that new version, so
                the button is deliberately NOT shown — clone mode gets the bar
                below instead, which names both documents and offers the
                original explicitly. */}
            {isViewOnly && (
              <>
                <button
                  type="button"
                  onClick={startNewVersion}
                  disabled={startingNewVersion}
                  className={SECONDARY_BUTTON}
                >
                  <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                  {startingNewVersion ? "กำลังสร้างเวอร์ชันใหม่..." : "แก้ไข (New Ver.)"}
                </button>
                <button
                  type="button"
                  onClick={handleDownload}
                  disabled={docNoDup || generating}
                  className={PRIMARY_BUTTON}
                >
                  <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                  {generating ? "กำลังสร้าง PDF..." : "ดาวน์โหลด PDF"}
                </button>
              </>
            )}
          </div>
        </div>
        {!isViewOnly && cloneSource && (
          <div className="border-t border-orange-100 bg-orange-50">
            <div className="max-w-[1400px] mx-auto px-4 py-2 flex items-center justify-between gap-3 flex-wrap text-sm">
              <span className="font-semibold text-orange-800">
                เวอร์ชันใหม่ {q.docNo || "-"} (ยังไม่ได้บันทึก) — จากใบเดิม {cloneSource.docNo || "-"}
              </span>
              <button
                type="button"
                onClick={() =>
                  isDirty ? setShowEditOriginalConfirm(true) : loadOriginalForEdit()
                }
                title={`เปิดใบเดิม ${cloneSource.docNo} ขึ้นมาแก้ไขแทน (ทิ้งเวอร์ชันใหม่นี้)`}
                className="px-3 py-1.5 rounded-lg border border-orange-200 bg-white text-orange-700 text-sm font-semibold hover:bg-orange-100 transition"
              >
                แก้ไขใบเดิม ({cloneSource.docNo || "-"}) แทน
              </button>
            </div>
          </div>
        )}
      </div>

      <div className={`max-w-[1400px] mx-auto px-4 py-6 ${isViewOnly ? "flex justify-center" : "grid grid-cols-1 xl:grid-cols-[420px_1fr]"} gap-6 items-start`}>
        {/* ══ LEFT: form ══ — in the order a quotation is written: who it is
            for, what is on it, its terms; the document's number and date on
            top; who is offering it (rarely changed) folded away at the end. */}
        {!isViewOnly && (
        <div className="quote-form space-y-4">
          {/* A draft left from before (quoteDraft.ts): back, or away. */}
          {draftOffer && (
            <div role="status" className="rounded-2xl border border-orange-200 bg-orange-50 p-4" data-testid="draft-offer">
              <p className="text-sm font-semibold text-orange-900">มีใบที่ยังไม่ได้บันทึกค้างอยู่จากครั้งก่อน</p>
              <p className="mt-0.5 text-xs text-orange-800">
                เลขที่ {draftOffer.state.docNo || "-"}
                {draftOffer.state.customerCompany || draftOffer.state.customerContact
                  ? ` · ${draftOffer.state.customerCompany || draftOffer.state.customerContact}`
                  : ""}
                {" "}· แก้ไขล่าสุด {draftTimeLabel(draftOffer.savedAt)}
              </p>
              {draftOffer.stale && (
                <p className="mt-2 text-xs font-semibold text-red-700" data-testid="draft-stale">
                  ⚠ ใบนี้ถูกบันทึกใหม่หลังจากร่างนี้ — ถ้ากู้คืนแล้วบันทึก จะทับฉบับที่บันทึกล่าสุด
                </p>
              )}
              <div className="mt-3 flex gap-2">
                <button type="button" onClick={restoreDraft} className={`${PRIMARY_BUTTON} !py-1.5 !px-4 text-sm`}>
                  กู้คืน
                </button>
                <button type="button" onClick={discardDraft} className={`${SECONDARY_BUTTON} !py-1.5 !px-4 text-sm`}>
                  ทิ้ง
                </button>
              </div>
            </div>
          )}

          {/* Locked until the draft on offer is answered: typing into the
              document now would be work the autosave cannot keep (it would
              overwrite that very draft), and a save would drop it unasked. */}
          <fieldset disabled={!!draftOffer} className="space-y-4 min-w-0 disabled:opacity-60">
          {/* เอกสาร */}
          <section className={SECTION}>
            <h2 className={H2}>เอกสาร</h2>
            <div className="grid grid-cols-[1fr_1fr_76px] gap-3">
              <div>
                <label className={labelCls}>เลขที่ (No.)</label>
                <input
                  className={`${inputCls} ${docNoDup ? "border-red-400 ring-1 ring-red-300" : ""}`}
                  value={q.docNo}
                  onChange={(e) => set("docNo", e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="quote-date" className={labelCls}>วันที่ (Date)</label>
                {/* The shared date picker (yyyy-mm-dd, Thai months) — the
                    browser's own date box showed "11/03/2026" (month first,
                    from the browser's language) beside a sheet reading
                    "3 พ.ย. 2569". The sheet's reading is repeated under it. */}
                <DatePicker
                  id="quote-date"
                  selected={parseIsoDate(q.docDate)}
                  onChange={(d) => {
                    if (d) set("docDate", toLocalDateString(d));
                  }}
                  className="!px-3 !py-2 !rounded-lg !bg-white focus:!ring-orange-500/30 focus:!border-orange-500"
                />
                <p className="mt-1 text-[11px] text-gray-500" data-testid="quote-date-thai">{thaiDate(q.docDate)}</p>
              </div>
              <div>
                <label className={labelCls}>ยืนราคา (วัน)</label>
                <input type="number" min={0} className={inputCls} value={q.validDays}
                  onChange={(e) => set("validDays", Math.max(0, Number(e.target.value)))} />
              </div>
            </div>
            {docNoDup && (
              <p className="text-xs text-red-500 font-semibold">
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
              <div className="text-xs text-amber-600 font-semibold">
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
          </section>

          {/* ลูกค้า */}
          <section className={SECTION}>
            <h2 className={H2}>ลูกค้า</h2>
            <div className="grid grid-cols-2 gap-2">
              <SearchableDropdown
                className="w-full"
                placeholder="เลือกลูกค้าจากระบบ"
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
                buttonClassName={PICKER}
              />
              <SearchableDropdown
                className="w-full"
                placeholder="เลือกบริษัทจากระบบ"
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
                buttonClassName={PICKER}
              />
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
                <textarea rows={2} className={`${inputCls} resize-y`} value={q.customerAddress} onChange={(e) => set("customerAddress", e.target.value)} />
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
          <section className={SECTION}>
            <div className="flex items-center justify-between gap-2">
              <h2 className={H2}>รายการสินค้า ({q.items.length})</h2>
              <div className="flex items-center gap-2">
                {q.items.length > 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      setCollapsedItems(
                        q.items.every((it) => collapsedItems.has(it.id))
                          ? new Set()
                          : new Set(q.items.map((it) => it.id))
                      )
                    }
                    className="text-xs font-semibold text-gray-500 hover:text-gray-800 transition-colors"
                  >
                    {q.items.every((it) => collapsedItems.has(it.id)) ? "ขยายทั้งหมด" : "ย่อทั้งหมด"}
                  </button>
                )}
                <button type="button" onClick={addItem} className={`${PRIMARY_BUTTON} !py-1.5 !px-3 text-sm`}>
                  + เพิ่มรายการ
                </button>
              </div>
            </div>
            {q.items.map((it, idx) => {
              const line = lines[idx];
              const collapsed = collapsedItems.has(it.id);
              const itemSpecs = it.productId ? dbProductSpecs.filter((s) => s.productId === it.productId) : [];
              const descriptionRows = Math.min(12, Math.max(2, (it.description || "").split("\n").length + 1));
              return (
                <div key={it.id} className="rounded-xl border border-gray-200 bg-white" data-testid="quote-item">
                  {/* Header: the line as the sheet will show it — and a click
                      folds the card to just this, for long quotations. */}
                  <div className={`flex items-center gap-2 px-3 py-2 ${collapsed ? "" : "border-b border-gray-100"}`}>
                    <span className="text-xs font-bold text-gray-400 tabular-nums shrink-0">#{idx + 1}</span>
                    <button
                      type="button"
                      onClick={() => toggleItemCollapsed(it.id)}
                      aria-expanded={!collapsed}
                      title={collapsed ? "ขยายรายการ" : "ย่อรายการ"}
                      className="flex-1 min-w-0 text-left"
                    >
                      <span className="block truncate text-sm font-semibold text-gray-800">{it.name || "รายการใหม่"}</span>
                      {collapsed && (
                        <span className="block truncate text-xs text-gray-500 tabular-nums">
                          {it.qty} {it.unit} × {fmt(it.unitPrice)}
                        </span>
                      )}
                    </button>
                    <span className="shrink-0 text-sm font-bold text-gray-900 tabular-nums" data-testid="quote-item-total">
                      {fmt(line?.netAmount ?? 0)}
                    </span>
                    <div className="flex items-center shrink-0">
                      <IconButton label="เลื่อนขึ้น" onClick={() => moveItem(it.id, -1)} disabled={idx === 0}>
                        <svg aria-hidden="true" className={ICON} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 15l7-7 7 7" /></svg>
                      </IconButton>
                      <IconButton label="เลื่อนลง" onClick={() => moveItem(it.id, 1)} disabled={idx === q.items.length - 1}>
                        <svg aria-hidden="true" className={ICON} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
                      </IconButton>
                      <IconButton label="ทำสำเนารายการ" onClick={() => copyItem(it.id)}>
                        <svg aria-hidden="true" className={ICON} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                      </IconButton>
                      <IconButton label="ลบรายการ" onClick={() => removeItem(it.id)} danger>
                        <svg aria-hidden="true" className={ICON} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </IconButton>
                    </div>
                  </div>
                  {!collapsed && (
                    <div className="p-3 space-y-2">
                      <SearchableDropdown
                        className="w-full"
                        buttonClassName={PICKER}
                        placeholder="เลือกจากสินค้าในระบบ (เติมชื่อ + รูปให้)…"
                        value=""
                        onChange={(val) => applyProduct(it.id, val)}
                        options={products.map((p) => ({
                          value: p.id,
                          label: stripHtml(p.title_th || p.title_en).replace(/🐧/g, "").trim()
                        }))}
                      />
                      {itemSpecs.length > 0 && (
                        <SearchableDropdown
                          className="w-full"
                          buttonClassName={`${PICKER} !bg-orange-50 !border-orange-200 !text-orange-800`}
                          placeholder="เลือกสเปคเพื่อเติมรายละเอียด (ไม่บังคับ)"
                          value=""
                          onChange={(val) => {
                            const spec = dbProductSpecs.find(s => s.id === val);
                            if (spec) setItem(it.id, { description: spec.detail });
                          }}
                          options={itemSpecs.map(s => ({
                            value: s.id,
                            label: s.name
                          }))}
                        />
                      )}
                      <input className={inputCls} placeholder="ชื่อเครื่อง / รุ่น" value={it.name}
                        onChange={(e) => setItem(it.id, { name: e.target.value })} />
                      {/* Grows with the text (2–12 rows): a spec pasted in
                          used to sit in a two-line box with its own scroll. */}
                      <textarea rows={descriptionRows} className={`${inputCls} resize-y`} placeholder="รายละเอียด / สเปค (ถ้ามี)" value={it.description}
                        onChange={(e) => setItem(it.id, { description: e.target.value })} />
                      <div className="flex items-center gap-2">
                        {it.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={it.imageUrl} alt="" className="w-12 h-12 object-contain border border-gray-200 rounded bg-white" />
                        ) : (
                          <div className="w-12 h-12 border border-dashed border-gray-300 rounded flex items-center justify-center text-gray-300 text-xs">รูป</div>
                        )}
                        <button
                          type="button"
                          onClick={() => { uploadTargetRef.current = it.id; imageInputRef.current?.click(); }}
                          disabled={uploadingItemId === it.id}
                          className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 transition font-semibold disabled:opacity-50"
                        >
                          {uploadingItemId === it.id ? "กำลังอัปโหลด..." : "อัปโหลดรูป"}
                        </button>
                        {it.imageUrl && (
                          <button type="button" onClick={() => setItem(it.id, { imageUrl: "", imageUploaded: false })}
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
                      {/* ── ส่วนลดรายรายการ (task 7) ────────────────────────
                          FormattedNumberInput for the money, ฿ / % as two
                          buttons (the dropdown here was cut to "เปอร์เซ็…"),
                          and the money this line comes to on its own row —
                          it used to overflow the card. */}
                      <div>
                        <label className={labelCls}>ส่วนลดรายการนี้</label>
                        <div className="flex items-center gap-2">
                          <FormattedNumberInput
                            className={inputCls}
                            placeholder="0"
                            value={it.discount ?? 0}
                            onChange={(v) => setLineDiscount(it.id, v)}
                          />
                          <DiscountTypeToggle
                            label={`ประเภทส่วนลดรายการที่ ${idx + 1}`}
                            value={it.discountType ?? "amount"}
                            onChange={(v) => setLineType(it.id, v)}
                          />
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm">
                        <span className="text-gray-500">เป็นเงิน</span>
                        <span className="tabular-nums text-right">
                          {(line?.discountValue ?? 0) > 0 && (
                            <span className="text-gray-400 line-through text-xs mr-1.5">{fmt(line.amount)}</span>
                          )}
                          <span className="font-bold text-gray-800">{fmt(line?.netAmount ?? 0)}</span>
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </section>

          {/* ส่วนลด / VAT / เงื่อนไข */}
          <section className={SECTION}>
            <h2 className={H2}>ส่วนลด / VAT / เงื่อนไข</h2>
            <div>
              <label className={labelCls}>ส่วนลดท้ายใบ</label>
              <div className="flex items-center gap-2">
                <NumberInput className={inputCls} placeholder="0"
                  value={q.discount}
                  onChange={(v) => set("discount", v)} />
                <DiscountTypeToggle
                  label="ประเภทส่วนลดท้ายใบ"
                  value={q.discountType}
                  onChange={(v) => set("discountType", v)}
                />
              </div>
              {/* Says what quotationTotals.ts does: this discount comes off
                  the sum of the ALREADY line-discounted amounts, then VAT. */}
              <p className="mt-1 text-xs text-gray-500">
                หักจากยอดรวม{hasLineDiscounts ? `หลังหักส่วนลดรายรายการ (${fmt(afterLineDiscounts)} บาท)` : ""} แล้วจึงคิด VAT
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700 font-medium">
              <input type="checkbox" checked={q.vatEnabled} onChange={(e) => set("vatEnabled", e.target.checked)}
                className="w-4 h-4 accent-orange-500" />
              คิดภาษีมูลค่าเพิ่ม (VAT 7%)
            </label>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-gray-800">เงื่อนไขอื่นๆ</span>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      if (!isDefaultConditions(q.conditions)) setConfirmResetConditions(true);
                    }}
                    disabled={isDefaultConditions(q.conditions)}
                    className="text-gray-500 hover:text-gray-700 text-sm font-medium flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
                    คืนค่าเริ่มต้น
                  </button>
                  <button
                    type="button"
                    onClick={() => setQ(prev => ({
                      ...prev,
                      conditions: [...(prev.conditions || []), { id: randomId(), label: "", value: "" }]
                    }))}
                    className="text-orange-600 hover:text-orange-700 text-sm font-medium flex items-center gap-1"
                  >
                    <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"/></svg>
                    เพิ่มเงื่อนไข
                  </button>
                </div>
              </div>

              {(q.conditions || []).map((cond, idx) => (
                <div key={cond.id} className="p-3 bg-gray-50 border border-gray-200 rounded-lg space-y-2 relative">
                  <button
                    type="button"
                    aria-label={`ลบเงื่อนไข ${cond.label || idx + 1}`}
                    onClick={() => setQ(prev => ({
                      ...prev,
                      conditions: (prev.conditions || []).filter(c => c.id !== cond.id)
                    }))}
                    className="absolute top-2 right-2 text-gray-400 hover:text-red-500"
                  >
                    <svg aria-hidden="true" className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"/></svg>
                  </button>
                  <div className="pr-8 space-y-2">
                    <input
                      placeholder="หัวข้อ (เช่น เงื่อนไขชำระเงิน)"
                      className={`${inputCls} font-bold text-gray-800`}
                      value={cond.label}
                      onChange={(e) => {
                        const value = e.target.value;
                        setQ(prev => ({
                          ...prev,
                          conditions: (prev.conditions || []).map(c => (c.id === cond.id ? { ...c, label: value } : c)),
                        }));
                      }}
                    />
                    <textarea
                      rows={2}
                      placeholder="รายละเอียด"
                      className={`${inputCls} resize-y`}
                      value={cond.value}
                      onChange={(e) => {
                        const value = e.target.value;
                        setQ(prev => ({
                          ...prev,
                          conditions: (prev.conditions || []).map(c => (c.id === cond.id ? { ...c, value } : c)),
                        }));
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div>
              <label className={labelCls}>หมายเหตุเพิ่มเติม</label>
              <textarea rows={2} className={`${inputCls} resize-y`} value={q.note} onChange={(e) => set("note", e.target.value)} />
            </div>
          </section>

          {/* ผู้เสนอราคา — our salesperson and company lines. Set once and
              rarely changed (the salesperson is remembered, our lines come
              from the last quotation), so folded to one line once filled. */}
          <section className={SECTION}>
            <button
              type="button"
              onClick={() => setSellerUi({ docId: q.id, open: !sellerExpanded })}
              aria-expanded={sellerExpanded}
              className="w-full flex items-center justify-between gap-3 text-left"
            >
              <span className="min-w-0">
                <span className={`block ${H2}`}>ผู้เสนอราคา (พนักงานขาย / บริษัทเรา)</span>
                {!sellerExpanded && (
                  <span className="block truncate text-xs text-gray-500 mt-0.5" data-testid="seller-summary">
                    {[q.sellerName, q.companyPhone && `โทร ${q.companyPhone}`, q.companyTaxId && `เลขภาษี ${q.companyTaxId}`]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                )}
              </span>
              <svg aria-hidden="true" className={`w-4 h-4 shrink-0 text-gray-400 transition-transform ${sellerExpanded ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
            </button>
            {sellerExpanded && (
              <div className="space-y-3 pt-1">
                <SearchableDropdown
                  className="w-full"
                  placeholder="เลือกพนักงานขาย"
                  value={q.sellerId || ""}
                  options={dbSalespeople.map(s => ({
                    value: s.id,
                    label: s.name,
                    subLabel: s.phone || s.email || ""
                  }))}
                  onChange={(val) => {
                    const s = dbSalespeople.find(x => x.id === val);
                    if (s) {
                      setQ(prev => ({
                        ...prev,
                        sellerId: val,
                        sellerName: s.name,
                        sellerPhone: s.phone || prev.sellerPhone,
                        sellerEmail: s.email || prev.sellerEmail
                      }));
                    }
                  }}
                  buttonClassName={PICKER}
                />
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className={labelCls}>ชื่อเซลล์</label>
                    <input className={inputCls} value={q.sellerName} onChange={(e) => set("sellerName", e.target.value)} />
                  </div>
                  <div>
                    <label className={labelCls}>โทร (เซลล์)</label>
                    <input className={inputCls} value={q.sellerPhone} onChange={(e) => set("sellerPhone", e.target.value)} />
                  </div>
                  <div>
                    <label className={labelCls}>อีเมล (เซลล์)</label>
                    <input className={inputCls} value={q.sellerEmail} onChange={(e) => set("sellerEmail", e.target.value)} />
                  </div>
                  <div>
                    <label className={labelCls}>โทรบริษัท</label>
                    <input className={inputCls} value={q.companyPhone} onChange={(e) => set("companyPhone", e.target.value)} />
                  </div>
                  <div>
                    <label className={labelCls}>อีเมลบริษัท</label>
                    <input className={inputCls} value={q.companyEmail} onChange={(e) => set("companyEmail", e.target.value)} />
                  </div>
                  <div className="col-span-2">
                    <label className={labelCls}>เลขผู้เสียภาษี (บริษัทเรา)</label>
                    <input className={inputCls} placeholder="0-0000-00000-00-0" value={q.companyTaxId}
                      onChange={(e) => set("companyTaxId", e.target.value)} />
                  </div>
                </div>
              </div>
            )}
          </section>
          </fieldset>
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
                      {fmt(hasLineDiscounts ? lines[idx].netAmount : lines[idx]?.amount ?? 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Totals */}
            <div id="quote-footer" className="flex justify-between gap-6 mt-3">
              <div className="flex-1 text-[12px]">
                {/* Only when a condition has something to print — a bare
                    heading on the customer's copy reads as if terms went missing. */}
                {(q.conditions || []).some((cond) => cond.label || cond.value) && (
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
                )}
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
                  {/* The total in Thai words, as a Thai quotation prints it —
                      rounded exactly as the figure above (bahtText.ts). */}
                  <tr>
                    <td colSpan={2} className="pt-0.5 text-right text-[11.5px] text-gray-600" data-testid="quote-total-words">
                      ({bahtText(grandTotal)})
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Signatures */}
            <div id="quote-signatures" className="grid grid-cols-3 gap-6 mt-10 text-center text-[12px]">
              {[
                // ผู้เสนอราคา is us — the doc's own docDate already says when it was
                // issued, so a blank hand-filled date under our own signature was
                // asking for a second, redundant (and usually never filled-in) date.
                // ผู้สั่งซื้อ still gets one: that's the customer's actual signing
                // date, which nothing else on the page records.
                { title: "ผู้เสนอราคา", name: q.sellerName, showDate: false },
                null,
                { title: "ผู้สั่งซื้อ (ลูกค้า)", name: "", showDate: true },
              ].map((s, idx) =>
                s ? (
                  <div key={s.title}>
                    <div className="border-b border-gray-400 h-12 mb-2" />
                    <div className="min-h-[18px] mt-2 text-gray-800">{s.name}</div>
                    <div className="font-bold mt-2">{s.title}</div>
                    {s.showDate && (
                      <div className="text-gray-500 mt-2">วันที่ ______ / ______ / ______</div>
                    )}
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
                // On to where the admin was going — only once it is saved. (It
                // used to go to the saved list whatever was clicked, and to go
                // there even when the save had failed.)
                const target = pendingNav;
                setPendingNav(null);
                if ((await handleSave()) && target) router.push(target);
              }}
              disabled={savingQuote || docNoDup}
              className="w-full px-4 py-3 rounded-xl bg-orange-500 text-white font-bold text-sm hover:bg-orange-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              บันทึกแล้วออก
            </button>
            <button
              onClick={() => {
                setShowLeaveConfirm(false);
                savedSnapshotRef.current = stateFingerprint(q); // prevent re-triggering
                // Left without saving, on purpose: its draft goes too.
                draftPayloadRef.current = null;
                removeDraft(browserStorage(), draftKey(draftCtx, owner), Date.now());
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
