// What the accounting settings accept — pure, shared by the settings page
// (said under each field) and the API (which refuses the same things).
import { HEAD_OFFICE_BRANCH, isValidThaiTaxId, normalizeBranchCode, normalizeTaxId } from "../thaiTaxId";
import type { SellerProfile } from "./types";

export const SELLER_LIMITS = { name: 255, address: 500, phone: 100, email: 255 } as const;
export const BANK_LIMITS = { bankName: 100, accountNo: 30, accountName: 255 } as const;
export const VAT_RATE_MAX = 20;
export const CREDIT_DAYS_MAX = 365;

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type SellerProblems = Partial<Record<keyof SellerProfile, string>>;

const tooLong = (label: string, max: number) => `${label}ยาวเกิน ${max} ตัวอักษร`;

/** Our company as the settings form sends it, cleaned: tax ID as digits, branch as five digits. */
export function cleanSellerProfile(input: Partial<Record<keyof SellerProfile, unknown>>): SellerProfile {
  const text = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v).trim() : "");
  return {
    name: text(input.name),
    address: text(input.address),
    taxId: normalizeTaxId(text(input.taxId)),
    branchCode: normalizeBranchCode(text(input.branchCode)) ?? text(input.branchCode),
    phone: text(input.phone),
    email: text(input.email),
  };
}

/** Each field's problem, in Thai. Everything a tax invoice prints is required. */
export function sellerProfileProblems(p: SellerProfile): SellerProblems {
  const problems: SellerProblems = {};
  if (!p.name) problems.name = "กรุณากรอกชื่อบริษัทตามที่จดทะเบียน";
  else if (p.name.length > SELLER_LIMITS.name) problems.name = tooLong("ชื่อบริษัท", SELLER_LIMITS.name);
  if (!p.address) problems.address = "กรุณากรอกที่อยู่ตามที่จดทะเบียน";
  else if (p.address.length > SELLER_LIMITS.address) problems.address = tooLong("ที่อยู่", SELLER_LIMITS.address);
  if (!p.taxId) problems.taxId = "กรุณากรอกเลขประจำตัวผู้เสียภาษี 13 หลัก";
  else if (!isValidThaiTaxId(p.taxId)) problems.taxId = "เลขประจำตัวผู้เสียภาษีไม่ถูกต้อง — ต้องเป็นตัวเลข 13 หลักและหลักสุดท้ายต้องตรง";
  if (!/^\d{5}$/.test(p.branchCode)) problems.branchCode = "สาขาต้องเป็น สำนักงานใหญ่ หรือเลขสาขา 5 หลัก";
  if (p.phone.length > SELLER_LIMITS.phone) problems.phone = tooLong("เบอร์โทร", SELLER_LIMITS.phone);
  if (p.email && !EMAIL_SHAPE.test(p.email)) problems.email = "รูปแบบอีเมลไม่ถูกต้อง เช่น name@example.com";
  else if (p.email.length > SELLER_LIMITS.email) problems.email = tooLong("อีเมล", SELLER_LIMITS.email);
  return problems;
}

/** Null when fine. Whole or half percent, 0–20. */
export function vatRateProblem(value: unknown): string | null {
  const n = Number(value);
  if (value === "" || value === null || value === undefined || !Number.isFinite(n)) return "กรุณากรอกอัตราภาษีมูลค่าเพิ่ม";
  if (n < 0 || n > VAT_RATE_MAX) return `อัตราภาษีต้องอยู่ระหว่าง 0–${VAT_RATE_MAX}%`;
  // Not `Math.round(n * 100) !== n * 100`: 7.07 * 100 is 707.0000000000001.
  if (Math.abs(Math.round(n * 100) - n * 100) > 1e-6) return "อัตราภาษีมีทศนิยมได้ไม่เกิน 2 ตำแหน่ง";
  return null;
}

/** Null when fine. Whole days, 0–365. */
export function creditDaysProblem(value: unknown): string | null {
  const n = Number(value);
  if (value === "" || value === null || value === undefined || !Number.isInteger(n)) return "กรุณากรอกจำนวนวันเครดิตเป็นจำนวนเต็ม";
  if (n < 0 || n > CREDIT_DAYS_MAX) return `จำนวนวันเครดิตต้องอยู่ระหว่าง 0–${CREDIT_DAYS_MAX} วัน`;
  return null;
}

export interface BankAccountInput {
  bankName: string;
  accountNo: string;
  accountName: string;
}

export function cleanBankAccount(input: Partial<Record<keyof BankAccountInput, unknown>>): BankAccountInput {
  const text = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v).trim() : "");
  return { bankName: text(input.bankName), accountNo: text(input.accountNo), accountName: text(input.accountName) };
}

export function bankAccountProblems(b: BankAccountInput): Partial<Record<keyof BankAccountInput, string>> {
  const problems: Partial<Record<keyof BankAccountInput, string>> = {};
  if (!b.bankName) problems.bankName = "กรุณากรอกชื่อธนาคาร";
  else if (b.bankName.length > BANK_LIMITS.bankName) problems.bankName = tooLong("ชื่อธนาคาร", BANK_LIMITS.bankName);
  if (!b.accountNo) problems.accountNo = "กรุณากรอกเลขที่บัญชี";
  else if (!/^[\d\s-]+$/.test(b.accountNo)) problems.accountNo = "เลขที่บัญชีมีได้แค่ตัวเลข ขีด และเว้นวรรค";
  else if (b.accountNo.length > BANK_LIMITS.accountNo) problems.accountNo = tooLong("เลขที่บัญชี", BANK_LIMITS.accountNo);
  if (b.accountName.length > BANK_LIMITS.accountName) problems.accountName = tooLong("ชื่อบัญชี", BANK_LIMITS.accountName);
  return problems;
}

/** The first problem of a set, for the API's single `error` line. */
export function firstProblem(problems: Record<string, string | undefined>): string | null {
  for (const message of Object.values(problems)) if (message) return message;
  return null;
}

export const EMPTY_SELLER: SellerProfile = {
  name: "",
  address: "",
  taxId: "",
  branchCode: HEAD_OFFICE_BRANCH,
  phone: "",
  email: "",
};
