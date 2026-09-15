// Single source of truth for the app's data models.
//
// IMPORTANT: keep this file free of any server-only imports (no `mysql2`,
// `cloudinary`, `next/headers`, etc.). It is imported by BOTH server code
// (`lib/*Store.ts`, route handlers) and client components, so it must stay a
// pure, dependency-free type module. The stores re-export these types, so most
// server code can keep importing from `./productStore` / `./contentStore`.

// ── Products ────────────────────────────────────────────────────────────────

export interface ProductCategory {
  id: number;
  name_th: string;
  name_en: string;
  name_zh: string;
  sortOrder: number;
}

export interface ProductData {
  id: string;
  categoryId: number;
  image: string;
  title_th: string;
  title_en: string;
  title_zh: string;
  desc_th: string;
  desc_en: string;
  desc_zh: string;
  createdAt: string;
  isPublished?: boolean;
  sortOrder?: number;
  bestSellerRank?: number | null;
  showBestSellerBadge?: boolean;
  pendingDeleteAt?: string | null;
  supplierIds?: string[];
}

// ── Suppliers ────────────────────────────────────────────────────────────────

export interface Supplier {
  id: string;
  companyName: string;
  contactName: string;
  phone: string;
  note: string;
  createdAt: string;
  linkedProducts?: Array<{ id: string; title_th: string; title_en: string }>;
  /** Printed on a purchase order's header. Optional: added after suppliers
   *  already existed, so a supplier created before this has neither. */
  address?: string;
  taxId?: string;
}

export interface ProductSpec {
  id: string;
  productId: string;
  name: string;
  detail: string;
  createdAt: string;
}

// ── Contents ────────────────────────────────────────────────────────────────

export interface ContentBlock {
  id: string;
  type: "text" | "image" | "text-image" | "gallery" | "youtube";
  content?: string;
  imageUrl?: string;
  imageUrls?: string[];
  imagePosition?: "left" | "right";
  fontSize?: string;
  fontWeight?: string;
  textAlign?: string;
  textColor?: string;
  selectedImageIndex?: number;
  /** Image display width as a percentage (25–100). Undefined = 100 (legacy). */
  imageWidth?: number;
  /** Extra vertical gap below this block in px (0–100). Undefined = default spacing. */
  spacingBelow?: number;
  /** The pasted YouTube URL for a "youtube" block (watch/youtu.be/shorts/embed — see app/lib/youtube.ts). */
  youtubeUrl?: string;
}

export interface ContentData {
  id: string;
  title: string;
  blocks: ContentBlock[];
  createdAt: string;
  productId?: string | null;
}

// Lightweight projection for list / related-content views: everything those
// UIs need (title, counts, link, product link) WITHOUT the heavy blocks JSON,
// so pages don't serialize ~120KB of block content the client never renders.
export interface ContentMeta {
  id: string;
  title: string;
  createdAt: string;
  productId: string | null;
  textCount: number;
  imageCount: number;
}

// ── Documents ───────────────────────────────────────────────────────────────

export interface DocumentData {
  id: string;
  title: string;
  description: string;
  pdfUrl: string;
  coverUrl: string;
  createdAt: string;
  sortOrder: number;
}

/**
 * A contact person at a customer's company. Was a private interface inside
 * `app/customers/page.tsx`; promoted here (spec: open-customer-profile-
 * in-place) so `CustomerDetailsModal` — now shared between `/customers` and
 * `/crm/alerts` — and both of those pages can all agree on one shape instead
 * of each declaring their own copy.
 */
export interface Customer {
  id: string;
  companyId: string;
  // Joined display field (present on reads, absent on a bare write payload).
  companyName?: string;
  name: string;
  department: string;
  phone: string;
  email: string;
  note: string;
}

// ── CRM: Sold Equipment & Warranty Tracking ─────────────────────────────────

/** A calibration is valid for 1 year — the "next due" date shown to admins
 * (and the DB alert query, which fires 2 months before this anniversary) are
 * both computed from this. Lives here (not crmStore.ts) so client components
 * can import it without pulling in server-only DB code. */
export const CALIBRATION_VALIDITY_MONTHS = 12;

export const SCHEDULE_TYPES = ["service", "phone_call"] as const;
export type ScheduleType = (typeof SCHEDULE_TYPES)[number];

export const SCHEDULE_STATUSES = ["pending", "completed", "cancelled"] as const;
export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];

/** Where a machine came from. Display/filter information only — it never
 * changes which alerts fire (that is `warrantyAlertEnabled`'s job). */
export const EQUIPMENT_OWNERSHIP_SOURCES = ["sold_by_us", "customer_owned"] as const;
export type EquipmentOwnershipSource = (typeof EQUIPMENT_OWNERSHIP_SOURCES)[number];

export interface CustomerEquipment {
  id: string;
  salesRecordId?: string;
  customerId: string;
  productId: string;
  serialNumber: string;
  quotationNumber: string;
  warrantyCertNumber: string;
  warrantyType: string;
  warrantyStartDate: string | null; // YYYY-MM-DD
  warrantyEndDate: string | null; // YYYY-MM-DD
  status: string; // Active | Expired
  /** Free-text log of events recorded against this equipment (e.g. "customer
   * declined to renew the warranty"), newest entry appended last. */
  note?: string | null;
  /** Date of the last calibration performed. The alert feed warns 10 months
   * after this date (see getAlerts()'s "nearingCalibration"). */
  calibrationDate?: string | null; // YYYY-MM-DD
  /** "sold_by_us" (default) | "customer_owned". Pre-existing rows keep the
   * default — the migration never reclassifies anything. */
  ownershipSource?: EquipmentOwnershipSource;
  /** Per-unit switch for the "warranty expiring" alert ONLY (calibration and
   * incomplete-record alerts ignore it). Stored as TINYINT(1), so reads that
   * pass rows straight through hand back 0/1 — coerce with Boolean() before
   * comparing strictly. */
  warrantyAlertEnabled?: boolean;
  createdAt: string;
  // Joined display fields (present on reads)
  customerName?: string;
  companyName?: string;
  productName?: string;
  productImage?: string;
}

export interface ServiceSchedule {
  id: string;
  /** Exactly one of equipmentId/customerId is set — a customer-scoped
   * schedule (no equipment) is a general follow-up call, always
   * scheduleType "phone_call". */
  equipmentId?: string | null;
  customerId?: string | null;
  scheduleType: ScheduleType;
  scheduledDate: string; // YYYY-MM-DD
  assignedToAdminId: string;
  status: ScheduleStatus;
  notes: string;
  createdAt: string;
  // Joined display fields (present on customer-scoped reads)
  customerName?: string;
  companyName?: string;
}

export interface ServiceLog {
  id: string;
  /** NULL for a log written by a job sheet that has no appointment behind it
   * (v38) — a walk-in repair is a real visit with no schedule to hang from.
   * Set (and FK-enforced) for every log written by completing a schedule. */
  scheduleId: string | null;
  /** The document number the visit is filed under. For a job-sheet log this is
   * the `jobNo` printed on the paper the customer signed — the meaning this
   * column has been waiting for since add-crm-service-tracking created it. */
  serviceReportNumber: string;
  actionDate: string;
  resultDetails: string;
  customerFeedback: string;
  createdAt: string;
  /** v38: which machine this visit touched. A schedule-born log reaches its
   * machine through the schedule; a job-sheet log carries it directly. */
  equipmentId?: string | null;
  /** v38: the job sheet that wrote this log. (jobId, equipmentId) is UNIQUE, so
   * closing the same sheet twice cannot produce a second set of logs. */
  jobId?: string | null;
}

// ── ใบ Job — the printed service job sheet (v38) ─────────────────────────────

/** `issued` = printed, not necessarily been yet. `completed` = the signed paper
 * came back and the visit is now history. `cancelled` = the trip never
 * happened. ONLY the transition to `completed` writes service history — a sheet
 * that was printed but never taken is not a visit, and a service record that
 * says otherwise cannot be told apart from a true one afterwards. */
export const SERVICE_JOB_STATUSES = ["issued", "completed", "cancelled"] as const;
export type ServiceJobStatus = (typeof SERVICE_JOB_STATUSES)[number];

/** One machine listed on one sheet. Names/serials are NOT snapshotted here —
 * they are read live from `customer_equipments`, because the serial number on
 * the paper must be the one the system holds for that unit (the admin never
 * types it). */
export interface ServiceJobEquipment {
  equipmentId: string;
  sortOrder: number;
  // Joined display fields (present on reads)
  productName?: string | null;
  serialNumber?: string | null;
  warrantyEndDate?: string | null;
}

/** A machine line typed manually — not linked to any equipment in the system. */
export interface CustomEquipment {
  productName: string;
  serialNumber: string;
}

export interface ServiceJob {
  id: string;
  /** `DDMMYY-NN`, claimed from the same `used_docnos` ledger as quotation
   * and billing numbers. Assigned once, at creation, and never rewritten. */
  jobNo: string;
  companyId: string;
  customerId: string;
  jobDate: string; // YYYY-MM-DD — display via formatDisplayDate()
  /** Optional on purpose: empty means the printed sheet carries a ruled blank
   * line for the technician to write his own name on at the site. */
  technicianName: string;
  /** Plain id + index, never an FK — the appointment can be deleted and this
   * sheet must still open and print (see db.ts v38). */
  scheduleId: string | null;
  status: ServiceJobStatus;
  /** Typed back in from the handwriting on the returned paper. Optional. */
  workSummary: string | null;
  completedAt: string | null;
  createdAt: string;
  equipments: ServiceJobEquipment[];
  /** Manually typed equipment entries (not linked to the DB). */
  customEquipments: CustomEquipment[];
  // Joined display fields (present on reads)
  customerName?: string | null;
  companyName?: string | null;
  /** True while the linked appointment still exists. False after it was
   * deleted, which is a normal state, not an error. */
  scheduleExists?: boolean;
}

/** One line in a list of sheets. Carries `equipmentCount` instead of the
 * machines themselves — a list of 500 sheets must not fan out into 500 extra
 * reads for rows the list never shows. */
export interface ServiceJobSummary {
  id: string;
  jobNo: string;
  companyId: string;
  customerId: string;
  jobDate: string;
  technicianName: string;
  status: ServiceJobStatus;
  completedAt: string | null;
  createdAt: string;
  equipmentCount: number;
  customerName?: string | null;
  companyName?: string | null;
}

export interface SalesRecord {
  id: string;
  salespersonId: string;
  customerId: string;
  companyId: string;
  productId: string;
  productName: string;
  productImage?: string;
  categoryId: number | null;
  qty: number;
  unitPrice: number;
  totalAmount: number;
  costAmount: number;
  saleType: string;
  saleDate: string; // YYYY-MM-DD
  quotationRef: string;
  poRef: string;
  deliveryRef: string;
  invoiceRef: string;
  receiptRef: string;
  warrantyStartDate: string | null;
  warrantyEndDate: string | null;
  serialNumbers?: string[];
  /** The sale's machines, in the same order as `serialNumbers`, each with the
   * `customer_equipments.id` it lives in. The edit form sends these ids back so
   * a re-save re-binds every machine to its OWN row (id → serial → position)
   * instead of guessing from the position of a serial box. */
  equipments?: {
    id: string;
    serialNumber: string;
    productId: string;
    productName: string;
  }[];
  equipmentId: string | null;
  note: string;
  createdAt: string;
  salespersonName?: string;
  customerName?: string;
  companyName?: string;
}

export interface CostItem {
  id: string;
  salesRecordId: string;
  costType: string;
  label: string;
  amount: number;
  note: string;
  createdAt: string;
}

/**
 * One ลูกหนี้ค้างชำระ alert card. Every field is a DENORMALISED COLUMN on
 * `billing_documents` — the card renders without a single JSON parse, which is
 * what lets the bell poll this category without reading 2000 blobs.
 */
export interface ReceivableAlert {
  id: string;
  docNo: string;
  docType: string;
  /** The document's own วันที่, never `createdAt` — that is rewritten on every
   *  save, including the save /billing performs before generating a PDF. */
  docDate: string | null;
  dueDate: string | null;
  customerName: string;
  customerPhone: string;
  linkedQuotationId: string | null;
  totalAmount: number;
  paidAmount: number;
  /** `max(0, total - paid)`. The number the card shows in large type — the
   *  OUTSTANDING balance, not the document total. */
  outstanding: number;
}

export interface CrmAlerts {
  expiringWarranties: CustomerEquipment[];
  nearingCalibration: CustomerEquipment[];
  /** True count of matching (non-snoozed) equipment nearing or past its
   * calibration date. `nearingCalibration` is capped at
   * ALERT_LIST_DISPLAY_LIMIT — nothing closes a calibration except recording a
   * NEW date, so the backlog only ever grows — and the tab must state the real
   * number rather than the length of the capped list. The exact twin of
   * `incompleteEquipmentsTotal` below. */
  nearingCalibrationTotal: number;
  incompleteEquipments: CustomerEquipment[];
  /** True count of matching (non-snoozed) incomplete equipment, which can
   * exceed incompleteEquipments.length since that list is capped. */
  incompleteEquipmentsTotal: number;
  missingDocuments: SalesRecord[];
  /** Equipment-scoped service schedules due within the `scheduleDays` window
   * (default 7) or already overdue — unchanged behaviour. */
  upcomingSchedules: Array<
    ServiceSchedule & {
      customerId?: string;
      customerName?: string;
      companyName?: string;
      productName?: string;
      serialNumber?: string;
      overdue: boolean;
    }
  >;
  /** Customer-scoped follow-up calls (no equipment). Deliberately has NO day
   * window: a call booked six months out shows the moment it is booked and
   * stays until it is completed — booking one used to look like it did
   * nothing for weeks. Capped at 100 rows for display. */
  customerCallFollowUps: Array<
    ServiceSchedule & {
      customerId?: string;
      customerName?: string;
      companyName?: string;
      overdue: boolean;
    }
  >;
  /** True count of customer-scoped follow-ups, which can exceed
   * customerCallFollowUps.length since that list is capped. */
  customerCallFollowUpsTotal: number;
  /** Billing documents that carry debt, still have a balance, and are within
   * RECEIVABLE_ALERT_LEAD_DAYS of their due date (or already past it). Like
   * ข้อมูลไม่ครบ this has NO closing date window — nothing clears it but the
   * money arriving — so the list is capped and the true count travels
   * separately. A document with no `dueDate` is NEVER here: nobody agreed a
   * term on it, so it is not late. */
  overdueReceivables: ReceivableAlert[];
  /** True count of overdue/near-due receivables, which can exceed
   * overdueReceivables.length since that list is capped. */
  overdueReceivablesTotal: number;
  /** Pending board tasks whose dueDate has ARRIVED (Bangkok calendar day).
   * Tasks with no due date, and tasks due later, are excluded on purpose —
   * see countDueTasks() in taskStore.ts. */
  dueTaskCount: number;
}

// ── CRM: manual task board ("post-it notes" the admin writes for himself) ────

/** Allowed `task_topics.color` values. A colour is stored as one of these
 * TOKENS, never as raw CSS/hex from the user, so nothing from the DB is ever
 * concatenated into a class or style attribute. Unknown tokens render neutral. */
export const TASK_TOPIC_COLORS = [
  "blue",
  "amber",
  "green",
  "rose",
  "purple",
  "teal",
  "slate",
] as const;
export type TaskTopicColor = (typeof TASK_TOPIC_COLORS)[number];

export const TASK_LINK_TARGETS = ["customer", "equipment", "quotation", "document"] as const;
export type TaskLinkTarget = (typeof TASK_LINK_TARGETS)[number];

export const TASK_STATUSES = ["pending", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** A user-extensible task heading. Rows, not an enum — the owner adds his own
 * headings over time. Retiring one is `isActive = false` (hide), never a
 * DELETE, so the tasks filed under it survive. */
export interface TaskTopic {
  id: number;
  name: string;
  icon: string; // emoji
  color: string; // TASK_TOPIC_COLORS token
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
}

/** A soft link from a task to a customer / machine / quotation / document.
 * `label` is a SNAPSHOT taken when the link was made and is deliberately
 * never re-synced: when the target has been deleted or purged, it is the only
 * remaining evidence of what the task referred to. */
export interface TaskLink {
  taskId: string;
  targetType: TaskLinkTarget;
  targetId: string;
  label: string;
  createdAt: string;
}

export interface CrmTask {
  id: string;
  topicId: number;
  title: string;
  detail: string | null;
  /** YYYY-MM-DD, or null — a task with no due date is a perfectly valid
   * post-it, so this is nullable on purpose. */
  dueDate: string | null;
  status: TaskStatus;
  completedAt: string | null;
  createdAt: string;
  // Joined display fields (present on reads). A task whose topic row is gone
  // still loads, with the fallback heading — it is never hidden or dropped.
  topicName?: string;
  topicIcon?: string;
  topicColor?: string;
  links?: TaskLink[];
}

export interface Expense {
  id: string;
  title: string;
  amount: number;
  expenseDate: string; // YYYY-MM-DD
  category: string;
  note: string;
  createdAt: string;
  source?: "expense" | "sale_cost";
  recurringExpenseId?: string | null;
}

/** A template for a monthly cost (rent, salary, ...) — see expenseStore.ts's
 * generateExpensesForMonth for how this turns into real `expenses` rows. */
export interface RecurringExpense {
  id: string;
  title: string;
  amount: number;
  category: string;
  note: string;
  active: boolean;
  /** "YYYY-MM" of the last month this template was generated for, or null. */
  lastGeneratedMonth: string | null;
  createdAt: string;
}
