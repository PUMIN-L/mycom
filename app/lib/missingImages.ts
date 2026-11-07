// The missing-image scan (/settings → "ตรวจหารูปที่หาย"): which pages show a
// picture or PDF whose file is gone from Cloudinary. Pure, no server imports:
// the API builds the index with it (lib/imageReferences.ts collects the
// references) and the settings section groups the results with it.
//
// Why it exists: until 2026-08-12 the showcase editor deleted a picture from
// Cloudinary the moment ✕ or "replace" was pressed — before the page was
// saved, and without asking whether anything else still used it. An edit that
// was then cancelled kept pointing at a file that no longer existed. Nothing
// deletes like that any more (ImageDeleteConfirmDialog + imageUsageHelper),
// but the files already gone stay gone; this finds the pages they broke.

export type ImageSourceKind = "content" | "product" | "document" | "quotation" | "billing";

/** One place a Cloudinary file is used. */
export interface ImageReference {
  url: string;
  kind: ImageSourceKind;
  /** The row's id. */
  sourceId: string;
  /** What the admin calls it: the content or product title, the catalog's, a document number. */
  title: string;
  /** Where on it: "รูปสินค้า", "บล็อกที่ 2 (แกลเลอรี) · รูปที่ 3", "ไฟล์ PDF", "รายการที่ 4". */
  where: string;
  /** The admin page that shows it — and where it is fixed. */
  href: string;
  /** Not shown to visitors (an unpublished product or catalog). */
  hidden: boolean;
}

/** A page, once — the index refers to it by position. */
export interface ImagePage {
  kind: ImageSourceKind;
  sourceId: string;
  title: string;
  href: string;
  hidden: boolean;
}

/** One file, checked once however many places use it. */
export interface IndexedImage {
  url: string;
  uses: { page: number; where: string }[];
}

/** What GET /api/admin/missing-images answers. */
export interface ImageIndex {
  pages: ImagePage[];
  images: IndexedImage[];
}

export type ImageCheckStatus = "ok" | "missing" | "error";

export interface ImageCheckResult {
  url: string;
  /** "missing": Cloudinary has no such file (404). "error": it could not be told. */
  status: ImageCheckStatus;
  httpStatus: number | null;
  /** Cloudinary's x-cld-error, or "timeout" / "network" / "redirect" / "unsupported". */
  detail?: string;
}

/** URLs per POST /api/admin/missing-images/check. */
export const CHECK_BATCH_SIZE = 20;

export const IMAGE_KIND_LABEL: Record<ImageSourceKind, string> = {
  content: "หน้าเนื้อหา",
  product: "สินค้า",
  document: "แคตตาล็อก",
  quotation: "ใบเสนอราคา",
  billing: "เอกสารขาย",
};

/** Pages a visitor sees first; then the documents only staff open. */
const KIND_ORDER: ImageSourceKind[] = ["content", "product", "document", "quotation", "billing"];

/** The references as pages + files, each file once (so it is checked once). */
export function indexImageReferences(refs: readonly ImageReference[]): ImageIndex {
  const pages: ImagePage[] = [];
  const pageAt = new Map<string, number>();
  const images: IndexedImage[] = [];
  const imageAt = new Map<string, number>();
  for (const ref of refs) {
    const pageKey = `${ref.kind}:${ref.sourceId}`;
    let page = pageAt.get(pageKey);
    if (page === undefined) {
      page = pages.length;
      pageAt.set(pageKey, page);
      pages.push({ kind: ref.kind, sourceId: ref.sourceId, title: ref.title, href: ref.href, hidden: ref.hidden });
    }
    let image = imageAt.get(ref.url);
    if (image === undefined) {
      image = images.length;
      imageAt.set(ref.url, image);
      images.push({ url: ref.url, uses: [] });
    }
    images[image].uses.push({ page, where: ref.where });
  }
  return { pages, images };
}

/** "e8onnyjtnuetewonz1mm.jpg" — the last part of the address, for a person to recognise. */
export function fileNameOf(url: string): string {
  const last = url.split(/[?#]/)[0].split("/").pop() ?? "";
  try {
    return decodeURIComponent(last) || url;
  } catch {
    return last || url;
  }
}

export interface MissingOnPage extends ImagePage {
  missing: { url: string; where: string; fileName: string }[];
}

/**
 * The pages that show at least one missing file, with what is missing where:
 * pages visitors see first (content, products, catalogs), then quotations and
 * billing documents; by title within a kind.
 */
export function pagesWithMissingImages(
  index: ImageIndex,
  results: ReadonlyMap<string, ImageCheckResult>
): MissingOnPage[] {
  const byPage = new Map<number, MissingOnPage>();
  for (const image of index.images) {
    if (results.get(image.url)?.status !== "missing") continue;
    for (const use of image.uses) {
      let entry = byPage.get(use.page);
      if (!entry) {
        entry = { ...index.pages[use.page], missing: [] };
        byPage.set(use.page, entry);
      }
      entry.missing.push({ url: image.url, where: use.where, fileName: fileNameOf(image.url) });
    }
  }
  return [...byPage.values()].sort(
    (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.title.localeCompare(b.title, "th")
  );
}

/** In order, `size` at a time (the last one shorter). */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Why a file could not be checked, in Thai. */
export function checkErrorLabel(result: Pick<ImageCheckResult, "httpStatus" | "detail">): string {
  if (result.detail === "timeout") return "Cloudinary ตอบช้าเกินไป";
  if (result.detail === "unsupported") return "ไม่ใช่ลิงก์ของ Cloudinary";
  if (result.detail === "redirect") return "Cloudinary ส่งต่อไปที่อื่น";
  if (result.httpStatus === 401 || result.httpStatus === 403) return `Cloudinary ไม่ให้เข้าถึง (${result.httpStatus})`;
  if (result.httpStatus === 420 || result.httpStatus === 429) return "Cloudinary จำกัดจำนวนคำขอ";
  if (result.httpStatus) return `Cloudinary ตอบ ${result.httpStatus}`;
  return "เชื่อมต่อ Cloudinary ไม่ได้";
}
