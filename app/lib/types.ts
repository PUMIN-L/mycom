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
  type: "text" | "image" | "text-image" | "gallery";
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

export const SCHEDULE_TYPES = ["service", "phone_call"] as const;
export type ScheduleType = (typeof SCHEDULE_TYPES)[number];

export const SCHEDULE_STATUSES = ["pending", "completed", "cancelled"] as const;
export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];

export interface CustomerEquipment {
  id: string;
  customerId: string;
  productId: string;
  serialNumber: string;
  quotationNumber: string;
  warrantyCertNumber: string;
  warrantyType: string;
  warrantyStartDate: string | null; // YYYY-MM-DD
  warrantyEndDate: string | null; // YYYY-MM-DD
  status: string; // Active | Expired
  createdAt: string;
  // Joined display fields (present on reads)
  customerName?: string;
  companyName?: string;
  productName?: string;
}

export interface ServiceSchedule {
  id: string;
  equipmentId: string;
  scheduleType: ScheduleType;
  scheduledDate: string; // YYYY-MM-DD
  assignedToAdminId: string;
  status: ScheduleStatus;
  notes: string;
  createdAt: string;
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
  incompleteEquipments: CustomerEquipment[];
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
