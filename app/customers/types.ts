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
}

export interface Salesperson {
  id: string;
  name: string;
  phone: string;
  email: string;
  note: string;
}
