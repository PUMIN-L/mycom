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
  scheduleId: string;
  serviceReportNumber: string;
  actionDate: string;
  resultDetails: string;
  customerFeedback: string;
  createdAt: string;
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

export interface CrmAlerts {
  expiringWarranties: CustomerEquipment[];
  nearingCalibration: CustomerEquipment[];
  incompleteEquipments: CustomerEquipment[];
  /** True count of matching (non-snoozed) incomplete equipment, which can
   * exceed incompleteEquipments.length since that list is capped. */
  incompleteEquipmentsTotal: number;
  missingDocuments: SalesRecord[];
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
