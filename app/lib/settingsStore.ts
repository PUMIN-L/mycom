import { query } from "./db";
import type { RowDataPacket } from "mysql2";
import { CONTACT_EMAIL } from "./contact";

// Key-value settings configurable from the CMS (/settings, admin-only).
// Reads fall back to a hardcoded default so the app works before the row exists.

export const CONTACT_EMAIL_SETTING = "contact_email";

export async function getSetting(name: string): Promise<string | null> {
  const [rows] = await query<RowDataPacket[]>(
    "SELECT value FROM settings WHERE name = ?",
    [name]
  );
  return rows.length > 0 ? String(rows[0].value) : null;
}

export async function setSetting(name: string, value: string): Promise<void> {
  await query(
    "INSERT INTO settings (name, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)",
    [name, value]
  );
}

/** Where contact-form submissions are emailed. Falls back to the shared constant. */
export async function getContactEmail(): Promise<string> {
  return (await getSetting(CONTACT_EMAIL_SETTING)) || CONTACT_EMAIL;
}

// ── Company profile (address, phone) ────────────────────────────────────────
// Previously hardcoded in app/lib/contact.ts — moved here so an admin can
// update them from /settings instead of needing a code change + redeploy
// every time the office address or phone number changes. The address is kept
// as ONE canonical value (used for the public Contact page display, the
// Google Maps link/embed, AND the Organization JSON-LD) rather than a
// separate translated copy per UI language — the previous per-language
// address text in translations.ts was never anything but a manual copy of
// the same physical address, so keeping a single editable source is strictly
// simpler and cannot drift out of sync with itself.

export interface CompanyProfile {
  /** Thai display format, e.g. "062-012-9895". */
  phone: string;
  /** Full address as shown on the public Contact page. */
  addressDisplay: string;
  /** Structured PostalAddress fields for JSON-LD / Google Maps queries. */
  addressStreet: string;
  addressLocality: string;
  addressRegion: string;
  addressPostalCode: string;
  addressCountry: string;
}

const COMPANY_PROFILE_DEFAULTS: CompanyProfile = {
  phone: "062-012-9895",
  addressDisplay:
    "93 ซอยงามวงศ์วาน 6 แยก 19 ถนนงามวงศ์วาน ตำบลบางเขน อำเภอเมืองนนทบุรี จ.นนทบุรี 11000",
  addressStreet: "93 Soi Ngamwongwan 6 Yaek 19, Ngamwongwan Rd., Bang Khen",
  addressLocality: "Mueang Nonthaburi",
  addressRegion: "Nonthaburi",
  addressPostalCode: "11000",
  addressCountry: "TH",
};

const COMPANY_PROFILE_SETTING_KEYS: Record<keyof CompanyProfile, string> = {
  phone: "company_phone",
  addressDisplay: "company_address_display",
  addressStreet: "company_address_street",
  addressLocality: "company_address_locality",
  addressRegion: "company_address_region",
  addressPostalCode: "company_address_postal_code",
  addressCountry: "company_address_country",
};

const COMPANY_PROFILE_FIELDS = Object.keys(
  COMPANY_PROFILE_SETTING_KEYS
) as (keyof CompanyProfile)[];

export async function getCompanyProfile(): Promise<CompanyProfile> {
  const entries = await Promise.all(
    COMPANY_PROFILE_FIELDS.map(async (field) => {
      const stored = await getSetting(COMPANY_PROFILE_SETTING_KEYS[field]);
      return [field, stored || COMPANY_PROFILE_DEFAULTS[field]] as const;
    })
  );
  return Object.fromEntries(entries) as unknown as CompanyProfile;
}

export async function updateCompanyProfile(
  partial: Partial<CompanyProfile>
): Promise<void> {
  const fields = (Object.keys(partial) as (keyof CompanyProfile)[]).filter(
    (field) => COMPANY_PROFILE_SETTING_KEYS[field] !== undefined
  );
  await Promise.all(
    fields.map((field) =>
      setSetting(COMPANY_PROFILE_SETTING_KEYS[field], partial[field] as string)
    )
  );
}

/** Single-line address for a Google Maps text-search query / embed. */
export function companyAddressQuery(profile: CompanyProfile): string {
  return `${profile.addressStreet}, ${profile.addressLocality}, ${profile.addressRegion} ${profile.addressPostalCode}, ${profile.addressCountry}`;
}

/**
 * Thai domestic phone display format (e.g. "062-012-9895") -> E.164 (e.g.
 * "+66620129895") for structured data. Thai mobile/landline numbers drop the
 * leading 0 and prepend the country code.
 */
// Admin-entered free text, so it may already be in international format
// (e.g. "+66-62-012-9895") — only bare local numbers ("062-012-9895") get the
// leading 0 stripped and +66 prepended; anything already carrying the
// country code is passed through as-is instead of getting +66 doubled up.
export function toThaiE164(phone: string): string {
  const trimmed = phone.trim();
  if (trimmed.startsWith("+")) {
    return `+${trimmed.replace(/\D/g, "")}`;
  }
  const digits = trimmed.replace(/\D/g, "");
  // A real Thai local number always starts with "0" once stripped of
  // formatting — a leading "66" (with no "+") only happens when the country
  // code was typed without the plus sign.
  if (digits.startsWith("66") && digits.length > 9) {
    return `+${digits}`;
  }
  const local = digits.startsWith("0") ? digits.slice(1) : digits;
  return `+66${local}`;
}
