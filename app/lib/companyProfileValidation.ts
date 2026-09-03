import { sanitizePlainText } from "./sanitizeHtml";
import type { CompanyProfile } from "./settingsStore";

export const COMPANY_PROFILE_FIELD_LIMITS: Record<keyof CompanyProfile, number> = {
  phone: 40,
  addressDisplay: 500,
  addressStreet: 255,
  addressLocality: 100,
  addressRegion: 100,
  addressPostalCode: 20,
  addressCountry: 2,
};

const FIELD_LABELS_TH: Record<keyof CompanyProfile, string> = {
  phone: "เบอร์โทรศัพท์",
  addressDisplay: "ที่อยู่ (แสดงผล)",
  addressStreet: "ถนน/ซอย",
  addressLocality: "อำเภอ/เขต",
  addressRegion: "จังหวัด",
  addressPostalCode: "รหัสไปรษณีย์",
  addressCountry: "รหัสประเทศ",
};

/**
 * Parses/sanitizes the company-profile fields present in a request body.
 * Shared by both the OTP-request route (builds the "pending" partial) and
 * the PUT route (re-validates before applying) so the two can never
 * silently diverge on what counts as valid.
 */
export function parseCompanyProfilePartial(
  body: Record<string, unknown>
): { partial: Partial<CompanyProfile> } | { error: string } {
  const partial: Partial<CompanyProfile> = {};
  for (const field of Object.keys(COMPANY_PROFILE_FIELD_LIMITS) as (keyof CompanyProfile)[]) {
    if (body[field] === undefined) continue;
    const value = sanitizePlainText(String(body[field] ?? "").trim())
      .trim()
      .substring(0, COMPANY_PROFILE_FIELD_LIMITS[field]);
    if (!value) {
      return { error: `กรุณากรอกข้อมูลให้ครบ (${FIELD_LABELS_TH[field]})` };
    }
    partial[field] = value;
  }
  if (Object.keys(partial).length === 0) {
    return { error: "ไม่มีข้อมูลที่จะบันทึก" };
  }
  return { partial };
}

/** Human-readable "field: old -> new" summary for the OTP email, one line per changed field. */
export function summarizeCompanyProfileChanges(
  current: CompanyProfile,
  partial: Partial<CompanyProfile>
): string {
  const lines: string[] = [];
  for (const field of Object.keys(partial) as (keyof CompanyProfile)[]) {
    const next = partial[field];
    if (next === undefined || next === current[field]) continue;
    lines.push(`${FIELD_LABELS_TH[field]}: "${current[field]}" -> "${next}"`);
  }
  return lines.length > 0 ? lines.join("\n") : "(ไม่มีค่าที่เปลี่ยนแปลงจริง)";
}
