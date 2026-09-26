import { sanitizePlainText } from "../../lib/sanitizeHtml";
import { ApiError } from "../../lib/apiHelpers";

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

export type CompanyInput = { name: string } & Record<keyof typeof TEXT_FIELDS, string>;

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
  const input = { name: sanitizePlainText(body.name).substring(0, 255) } as CompanyInput;
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
