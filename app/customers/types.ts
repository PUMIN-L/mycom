// The rows /customers lists besides customers (whose type, shared with
// /crm/alerts, lives in app/lib/types.ts). Moved here from page.tsx so the
// forms and dialogs in this folder can share them.

export interface Company {
  id: string;
  name: string;
  addressNo: string;
  moo: string;
  soi: string;
  road: string;
  subDistrict: string;
  district: string;
  province: string;
  postalCode: string;
  phone: string;
  note: string;
  /** v50 (accounting): NULL until someone fills them in. */
  taxId?: string | null;
  /** "00000" สำนักงานใหญ่ · five digits a branch. */
  branchCode?: string | null;
  /** DECIMAL — arrives as text ("3.00"). */
  whtPercent?: string | number | null;
  /** เซลล์ผู้ดูแล (v57): the salesperson who looks after it, NULL for nobody. */
  salespersonId?: string | null;
}

export interface Salesperson {
  id: string;
  name: string;
  phone: string;
  email: string;
  note: string;
}
