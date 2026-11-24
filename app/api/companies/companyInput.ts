import type { RowDataPacket } from "mysql2";
import { query } from "../../lib/db";
import { sanitizePlainText } from "../../lib/sanitizeHtml";
import { ApiError } from "../../lib/apiHelpers";
import { normalizeBranchCode, normalizeTaxId } from "../../lib/thaiTaxId";

// The company form's fields, as POST /api/companies and PUT /api/companies/[id]
// both read them.

/** Each optional text field, with its column's length. */
const TEXT_FIELDS = {
  addressNo: 255,
  moo: 255,
  soi: 255,
  road: 255,
  subDistrict: 255,
  district: 255,
  province: 255,
  postalCode: 255,
  phone: 255,
  note: 2000,
} as const;

/** How the form labels each field, for the error an admin reads. */
const FIELD_LABELS: Record<keyof typeof TEXT_FIELDS, string> = {
  addressNo: "เลขที่",
  moo: "หมู่",
  soi: "ซอย",
  road: "ถนน",
  subDistrict: "ตำบล/แขวง",
  district: "อำเภอ/เขต",
  province: "จังหวัด",
  postalCode: "รหัสไปรษณีย์",
  phone: "เบอร์โทร",
  note: "หมายเหตุ",
};

/**
 * The tax fields (v50, for the accounting module). `undefined` = the request
 * did not send the field at all, and an update must leave the column alone —
 * a caller that knows nothing of tax IDs must not wipe one out.
 */
export interface CompanyTaxInput {
  /** As typed: a Thai ID is kept as its 13 digits; anything else (a foreign number) as written. */
  taxId: string | null | undefined;
  /** Five digits ("00000" = สำนักงานใหญ่), or null for none. */
  branchCode: string | null | undefined;
  /** The percent the company usually withholds (3 for services), or null. */
  whtPercent: number | null | undefined;
}

export type CompanyInput = { name: string } & Record<keyof typeof TEXT_FIELDS, string> &
  CompanyTaxInput & {
    /** เซลล์ผู้ดูแล (v57): an id, null for nobody, undefined = not sent (an update leaves it alone). */
    salespersonId: string | null | undefined;
  };

export const TAX_ID_MAX = 30;
export const WHT_PERCENT_MAX = 15;

function readTaxFields(body: Record<string, unknown>): CompanyTaxInput {
  const out: CompanyTaxInput = { taxId: undefined, branchCode: undefined, whtPercent: undefined };

  if (body.taxId !== undefined) {
    if (body.taxId === null || body.taxId === "") out.taxId = null;
    else if (typeof body.taxId !== "string" && typeof body.taxId !== "number") {
      throw new ApiError(400, 'ช่อง "เลขประจำตัวผู้เสียภาษี" ต้องเป็นข้อความ');
    } else {
      const typed = sanitizePlainText(String(body.taxId)).trim();
      // A Thai ID typed with dashes or spaces is stored as its digits.
      const digits = normalizeTaxId(typed);
      const value = /^\d+$/.test(digits) ? digits : typed;
      if (value.length > TAX_ID_MAX) throw new ApiError(400, `เลขประจำตัวผู้เสียภาษียาวเกิน ${TAX_ID_MAX} ตัวอักษร`);
      out.taxId = value || null;
    }
  }

  if (body.branchCode !== undefined) {
    if (body.branchCode === null || body.branchCode === "") out.branchCode = null;
    else if (typeof body.branchCode !== "string" && typeof body.branchCode !== "number") {
      throw new ApiError(400, 'ช่อง "สาขา" ต้องเป็นข้อความ');
    } else {
      const branch = normalizeBranchCode(body.branchCode);
      if (branch === null) throw new ApiError(400, "สาขาต้องเป็น สำนักงานใหญ่ หรือเลขสาขาไม่เกิน 5 หลัก");
      out.branchCode = branch || null;
    }
  }

  if (body.whtPercent !== undefined) {
    if (body.whtPercent === null || body.whtPercent === "") out.whtPercent = null;
    else {
      const n = Number(body.whtPercent);
      if (typeof body.whtPercent === "boolean" || !Number.isFinite(n) || n < 0 || n > WHT_PERCENT_MAX) {
        throw new ApiError(400, `หัก ณ ที่จ่ายต้องเป็นตัวเลข 0–${WHT_PERCENT_MAX}%`);
      }
      out.whtPercent = Math.round(n * 100) / 100;
    }
  }
  return out;
}

function readSalespersonId(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 255) throw new ApiError(400, 'ช่อง "เซลล์ผู้ดูแล" ไม่ถูกต้อง');
  return value;
}

/**
 * The chosen เซลล์ผู้ดูแล must be on the list — or ApiError(400): a stale
 * form (the salesperson deleted meanwhile) must not store an id that names
 * nobody. Nothing to check for none, or when the field was not sent.
 */
export async function assertSalespersonExists(salespersonId: string | null | undefined): Promise<void> {
  if (!salespersonId) return;
  const [rows] = await query<RowDataPacket[]>("SELECT id FROM salespeople WHERE id = ? LIMIT 1", [salespersonId]);
  if (rows.length === 0) throw new ApiError(400, "ไม่พบพนักงานขายที่เลือก อาจถูกลบไปแล้ว กรุณาเลือกใหม่");
}

/**
 * The submitted company, cleaned — or ApiError(400) for a missing name or a
 * field that is not text. A number (a house number or postal code sent as
 * one) is taken as its digits; an object, array or boolean used to reach
 * sanitize-html, which throws on them, and come back as a 500.
 */
export function readCompanyInput(data: unknown): CompanyInput {
  const body = (data ?? {}) as Record<string, unknown>;
  if (typeof body.name !== "string" || body.name.trim() === "") {
    throw new ApiError(400, "กรุณากรอกชื่อบริษัท");
  }
  const input = {
    name: sanitizePlainText(body.name).substring(0, 255),
    ...readTaxFields(body),
    salespersonId: readSalespersonId(body.salespersonId),
  } as CompanyInput;
  for (const [field, max] of Object.entries(TEXT_FIELDS) as [keyof typeof TEXT_FIELDS, number][]) {
    const value = body[field];
    if (value === undefined || value === null) {
      input[field] = "";
    } else if (typeof value === "string" || typeof value === "number") {
      input[field] = sanitizePlainText(String(value)).substring(0, max);
    } else {
      throw new ApiError(400, `ช่อง "${FIELD_LABELS[field]}" ต้องเป็นข้อความ`);
    }
  }
  return input;
}
