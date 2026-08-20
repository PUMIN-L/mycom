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

export const SITE_DESCRIPTION =
  "บริษัท โปรฟิน แล็บ สเกล จำกัด (Profinlab) — จำหน่าย ซ่อมบำรุง สอบเทียบ และติดตั้งเครื่องมือวัดและเครื่องทดสอบ" +
  "ในห้องปฏิบัติการอุตสาหกรรม พร้อมสอนการใช้งาน บริการออกแบบและสร้างห้อง Lab " +
  "เครื่อง tensile tester เครื่องทดสอบฟิล์ม เครื่องทดสอบพลาสติก เครื่องทดสอบ COF " +
  "เครื่องชั่ง เครื่องวัดสี เครื่องวัดความหนืด — นนทบุรี ประเทศไทย";

export const SITE_KEYWORDS = [
  // ── ชื่อแบรนด์ / Brand ──
  "profinlab",
  "profin",
  "โปรฟินแลป",
  "โปรฟินแล็บ",
  "โปรฟิน แล็บ สเกล",
  "profin lab scale",
  // ── คำค้นหาภาษาไทย: เครื่องมือวัดและทดสอบ ──
  "เครื่องทดสอบ",
  "เครื่องมือวัด",
  "เครื่องมือทดสอบ",
  "เครื่องมือห้องปฏิบัติการ",
  "อุปกรณ์ห้องแลป",
  "เครื่องมือ QC",
  // ── เครื่องทดสอบแรงดึง / Tensile ──
  "เครื่องทดสอบแรงดึง",
  "เครื่อง tensile",
  "เครื่องดึงยืด",
  "เครื่องวัดแรงดึง",
  "เครื่องทดสอบแรงดึงพลาสติก",
  "เครื่อง UTM",
  "Universal Testing Machine",
  // ── เครื่องทดสอบฟิล์ม / บรรจุภัณฑ์ ──
  "เครื่องทดสอบฟิล์ม",
  "เครื่องทดสอบพลาสติก",
  "เครื่องทดสอบบรรจุภัณฑ์",
  "เครื่องวัดความหนาฟิล์ม",
  "เครื่องทดสอบการหดตัวของฟิล์ม",
  "เครื่องทดสอบแรงปิดผนึก",
  "เครื่องทดสอบ heat seal",
  "เครื่องทดสอบแรงลอก",
  "เครื่องทดสอบ peel strength",
  "เครื่องทดสอบแรงฉีกขาด",
  // ── COF / แรงเสียดทาน ──
  "เครื่องทดสอบ COF",
  "เครื่องวัดค่า COF",
  "เครื่องวัดแรงเสียดทาน",
  "เครื่องวัดค่าสัมประสิทธิ์แรงเสียดทาน",
  // ── แรงกระแทก / Impact ──
  "เครื่องทดสอบแรงกระแทก",
  "เครื่องทดสอบแรงกระแทกพลาสติก",
  "Dart Impact Tester",
  // ── เครื่องวัดต่างๆ ──
  "เครื่องวัดความหนืด",
  "เครื่องวัดสี",
  "เครื่องวัดความเงา",
  "เครื่องวัดความแข็ง",
  "เครื่องวัดความชื้น",
  // ── เครื่องชั่ง ──
  "เครื่องชั่งดิจิตอล",
  "เครื่องชั่งวิเคราะห์",
  "เครื่องชั่งความละเอียดสูง",
  // ── ตู้อบ ──
  "ตู้อบลมร้อน",
  "ตู้อบห้องแล็บ",
  "ตู้อบสุญญากาศ",
  // ── เครื่องทดสอบอื่นๆ ──
  "เครื่องทดสอบการรั่วซึม",
  "เครื่องทดสอบการรั่วของบรรจุภัณฑ์",
  "เครื่องทดสอบ Melt Flow Index",
  "เครื่องทดสอบ MFI",
  "เครื่องทดสอบค่าดัชนีการไหล",
  // ── บริการ ──
  "สอบเทียบเครื่องมือวัด",
  "สอบเทียบ",
  "ซ่อมเครื่องทดสอบ",
  "ซ่อมเครื่องมือวัด",
  "ติดตั้งเครื่องทดสอบ",
  "สอนการใช้งานเครื่องทดสอบ",
  "สร้างห้องปฏิบัติการ",
  "สร้างห้อง lab",
  "ห้องปฏิบัติการมาตรฐาน",
  "ห้อง QC",
  "ห้องแลปโรงงาน",
  // ── อุตสาหกรรมเป้าหมาย ──
  "ตัวแทนจำหน่ายเครื่องทดสอบ",
  "เครื่องทดสอบวัสดุ",
  "เครื่องทดสอบยาง",
  "เครื่องทดสอบสิ่งทอ",
  "เครื่องทดสอบกระดาษ",
  // ── English keywords ──
  "testing equipment Thailand",
  "tensile tester",
  "universal testing machine",
  "UTM machine",
  "film testing machine",
  "plastic testing equipment",
  "packaging testing equipment",
  "COF tester",
  "coefficient of friction tester",
  "peel strength tester",
  "seal strength tester",
  "heat seal tester",
  "dart impact tester",
  "melt flow index tester",
  "film thickness gauge",
  "shrinkage tester",
  "viscometer",
  "colorimeter",
  "spectrophotometer",
  "gloss meter",
  "hardness tester",
  "durometer",
  "leak tester",
  "precision balance",
  "analytical balance",
  "laboratory oven",
  "vacuum oven",
  "calibration service Thailand",
  "lab construction Thailand",
  "QC laboratory equipment",
  "quality control instruments",
  "Nonthaburi",
];

