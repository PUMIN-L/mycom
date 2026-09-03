import { cache } from "react";
import { unstable_cache } from "next/cache";
import {
  getCompanyProfile,
  getContactEmail,
  companyAddressQuery,
  type CompanyProfile,
} from "./settingsStore";

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

export const getCompanyInfo = cache(
  unstable_cache(fetchCompanyInfo, ["company_info"], { tags: ["company-info"] })
);
