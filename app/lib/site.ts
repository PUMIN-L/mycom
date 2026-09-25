// Central place for site-wide constants used by metadata, robots, sitemap and JSON-LD.
//
// The base URL is resolved automatically in this order:
//   1. NEXT_PUBLIC_SITE_URL          — explicit override (e.g. a custom domain)
//   2. VERCEL_PROJECT_PRODUCTION_URL — Vercel's STABLE production domain (recommended)
//   3. VERCEL_URL                    — the per-deploy URL (preview deployments)
//   4. http://localhost:3000         — local development
//
// Vercel injects (2) and (3) automatically, so production canonical/OG/sitemap
// URLs point at the stable production domain without any manual configuration.

function normalizeUrl(url: string): string {
  const withProtocol = /^https?:\/\//.test(url) ? url : `https://${url}`;
  return withProtocol.replace(/\/+$/, ""); // strip trailing slash(es)
}

function resolveSiteUrl(): string {
  const candidate =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.VERCEL_URL ||
    "http://localhost:3000";
  return normalizeUrl(candidate);
}

export const SITE_URL = resolveSiteUrl();

export const SITE_NAME = "Profin Lab Scale";

// Thai brand name, legal entity, and EVERY common spelling variant — so a search
// in any of them ("โปรฟินแลป", "โปรฟิน แล็บ", "โปรฟิน แล็บสเกล", …) can match the
// brand. Fed into the Organization JSON-LD `alternateName` (the strong entity
// signal that tells Google "this brand is also known as …"). English "profinlab"
// already ranks via the domain; these give the Thai spellings something to match.
export const SITE_NAME_TH = "โปรฟิน แล็บสเกล";
export const SITE_LEGAL_NAME = "บริษัท โปรฟิน แล็บสเกล จำกัด";
export const BRAND_ALT_NAMES = [
  "โปรฟิน แล็บสเกล",
  "โปรฟิน แล็บ สเกล",
  "โปรฟินแล็บสเกล",
  "โปรฟินแลป",
  "โปรฟินแล็บ",
  "โปรฟิน แลป",
  "โปรฟิน แล็บ",
  "Profinlab",
  "Profin Lab Scale",
  "Profin Labscale",
  "บริษัท โปรฟิน แล็บสเกล จำกัด",
];

// Brand name FIRST (Thai + English) so both "โปรฟิน แล็บสเกล" and "profinlab"
// have the strongest on-page signal — the <title>.
export const SITE_TITLE =
  "โปรฟิน แล็บสเกล (Profinlab) | จำหน่ายเครื่องมือวัด เครื่องทดสอบ สอบเทียบ สร้างห้องปฏิบัติการ";

// The long form, for structured data (the Organization JSON-LD) and the web
// manifest — places that are read, not truncated. NOT for <meta description>:
// see SITE_META_DESCRIPTION.
export const SITE_DESCRIPTION =
  "บริษัท โปรฟิน แล็บ สเกล จำกัด (Profinlab) — จำหน่าย ซ่อมบำรุง สอบเทียบ และติดตั้งเครื่องมือวัดและเครื่องทดสอบ" +
  "ในห้องปฏิบัติการอุตสาหกรรม พร้อมสอนการใช้งาน บริการออกแบบและสร้างห้อง Lab " +
  "เครื่อง tensile tester เครื่องทดสอบฟิล์ม เครื่องทดสอบพลาสติก เครื่องทดสอบ COF " +
  "เครื่องชั่ง เครื่องวัดสี เครื่องวัดความหนืด — นนทบุรี ประเทศไทย";

// The <meta name="description"> of the home page (and the default for any page
// that sets none). Google shows roughly 150–160 characters and drops the rest,
// so this stays inside that: the home page used to send SITE_DESCRIPTION plus
// a list of equipment — 625 characters, most of it never displayed.
export const SITE_META_DESCRIPTION =
  "โปรฟิน แล็บสเกล (Profinlab) จำหน่าย ซ่อม และสอบเทียบเครื่องมือวัด เครื่องทดสอบ " +
  "เช่น Tensile Tester, Viscometer, เครื่องวัดสี พร้อมออกแบบสร้างห้องแล็บ — นนทบุรี";

// Business hours, as the owner gave them (Sept 2026): Monday–Friday,
// 08:30–17:00. In the Organization JSON-LD (openingHoursSpecification) for
// local results. Change it here if the hours change.
export const OPENING_HOURS = {
  days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
  opens: "08:30",
  closes: "17:00",
} as const;

// Alt text of the site-wide Open Graph image (app/opengraph-image.tsx).
export const OG_IMAGE_ALT = `${SITE_NAME} — Testing Instruments & Laboratory Solutions`;

// No `keywords` list: Google has ignored <meta name="keywords"> for years, and
// the 120-term list it used to render only told other engines "stuffed".

