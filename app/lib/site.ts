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

export const SITE_TITLE =
  "PROFIN | เครื่องมือทดสอบและสร้างห้องปฏิบัติการ";

export const SITE_DESCRIPTION =
  "ผู้เชี่ยวชาญด้านจำหน่าย ซ่อมบำรุง และสอบเทียบเครื่องมือทดสอบคุณภาพ พร้อมบริการออกแบบและสร้างห้องปฏิบัติการมาตรฐานสากล - Profin Lab scale, Nonthaburi, Thailand";

export const SITE_KEYWORDS = [
  "เครื่องทดสอบ",
  "testing equipment",
  "hardness tester",
  "tensile tester",
  "viscometer",
  "colorimeter",
  "COF tester",
  "leak tester",
  "lab construction",
  "นนทบุรี",
];
