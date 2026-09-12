import { cache } from "react";
import { unstable_cache } from "next/cache";
import {
  getCompanyProfile,
  getContactEmail,
  companyAddressQuery,
  type CompanyProfile,
} from "./settingsStore";
import { CONTACT_EMAIL } from "./contact";

// Cached, PUBLIC-facing read of the admin-editable company profile (Footer,
// Contact page, Organization JSON-LD all render on nearly every page load —
// hitting the DB uncached on each one would be wasteful). Settings writes
// (app/api/settings/company-profile, .../contact-email) call
// revalidateTag("company-info") so a change shows up immediately instead of
// waiting out the cache.
//
// Deliberately NOT used by the Settings admin page itself or by
// getContactEmail()'s other callers (e.g. the contact-form route, which needs
// the true current value to detect changes) — this cache is for public
// display only.
export interface CompanyInfo {
  email: string;
  phone: string;
  address: string;
  addressMapsQuery: string;
  /** Structured fields, for building JSON-LD PostalAddress. */
  profile: CompanyProfile;
}

const fetchCompanyInfo = async (): Promise<CompanyInfo> => {
  const [profile, email] = await Promise.all([
    getCompanyProfile(),
    getContactEmail(),
  ]);
  return {
    email,
    phone: profile.phone,
    address: profile.addressDisplay,
    addressMapsQuery: companyAddressQuery(profile),
    profile,
  };
};

/**
 * What the PUBLIC site shows when the database cannot be reached at all.
 *
 * Every caller of getCompanyInfo() is a public page (/, /about, /contact,
 * /catalog/*, /showcase/*, the Organization JSON-LD) and several of them need
 * no database for anything else, so an unreachable TiDB used to turn a page
 * that renders fine into a hard 500 — and failed `next build` while
 * prerendering /about and /contact in an environment with no DB_* vars. This
 * mirrors getProductsData.ts, which already degrades to empty data rather than
 * taking the homepage down with it.
 *
 * The address and phone are left EMPTY on purpose rather than restating the
 * real ones here. A second hardcoded copy of the company address would drift
 * from the admin-editable value in settings and would be indistinguishable, on
 * screen, from the live one — a customer would read a stale address as fact.
 * A blank line is visibly missing, which is the honest version of "we could not
 * load this". The email is the exception: CONTACT_EMAIL is already the
 * app-wide fallback that getContactEmail() itself returns when the setting row
 * does not exist, so it is the same value, not a second copy of one.
 */
const COMPANY_INFO_FALLBACK: CompanyInfo = {
  email: CONTACT_EMAIL,
  phone: "",
  address: "",
  // Deliberately "" rather than companyAddressQuery() over blank fields, which
  // would build a ", ,   , " string and send a Maps embed to nowhere.
  addressMapsQuery: "",
  profile: {
    phone: "",
    addressDisplay: "",
    addressStreet: "",
    addressLocality: "",
    addressRegion: "",
    addressPostalCode: "",
    addressCountry: "",
  },
};

const loadCompanyInfo = unstable_cache(fetchCompanyInfo, ["company_info"], {
  tags: ["company-info"],
});

// The try/catch sits OUTSIDE unstable_cache on purpose. Caching the fallback
// would let one transient connection blip pin an empty address on the public
// site until someone happened to save the settings form again — the cache has
// no revalidate window, only the "company-info" tag. Here a failure is never
// stored, so the very next request retries the database.
export const getCompanyInfo = cache(async (): Promise<CompanyInfo> => {
  try {
    return await loadCompanyInfo();
  } catch (error) {
    console.error("Error fetching company info:", error);
    return COMPANY_INFO_FALLBACK;
  }
});
