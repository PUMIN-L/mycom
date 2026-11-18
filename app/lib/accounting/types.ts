// The accounting module's shared shapes (ARCHITECTURE.md §8g). Type-only.

/**
 * The documents the module issues, each its own running number series:
 *   INV ใบส่งสินค้า/ใบแจ้งหนี้(/ใบกำกับภาษี) · RE ใบเสร็จรับเงิน(/ใบกำกับภาษี)
 *   BN  ใบวางบิล · CN ใบลดหนี้ · SO PO ลูกค้า (no number of ours — the customer's)
 */
export type AccDocType = "INV" | "RE" | "BN" | "CN" | "SO";
/** The types that take OUR running number. */
export type NumberedDocType = Exclude<AccDocType, "SO">;

export type AccDocStatus = "draft" | "issued" | "void";
export type AccDocSource = "internal" | "external";

/** Our company as it prints on a document — kept as versions (§8g). */
export interface SellerProfile {
  name: string;
  address: string;
  /** 13 digits, no dashes. */
  taxId: string;
  /** "00000" = สำนักงานใหญ่. */
  branchCode: string;
  phone: string;
  email: string;
}

export interface BankAccount {
  id: string;
  bankName: string;
  accountNo: string;
  accountName: string;
  isActive: boolean;
  sortOrder: number;
}

export interface AccountingSettings {
  seller: SellerProfile;
  /** Null until the first save — the form then starts from the website's company profile. */
  sellerVersionId: string | null;
  /** Percent, e.g. 7. */
  vatRate: number;
  /** Days from the issue date to the due date, for a new invoice. */
  creditDays: number;
  bankAccounts: BankAccount[];
}

/** One line of the module's audit log — who did what, when. Never edited. */
export interface AuditEntry {
  id: string;
  at: string;
  userId: string;
  username: string;
  action: string;
  documentId: string | null;
  docNo: string | null;
  detail: string;
}
