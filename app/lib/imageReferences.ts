import "server-only";
import type { RowDataPacket } from "mysql2";
import { query } from "./db";
import { displayText, htmlToText } from "./stripHtml";
import type { ImageReference } from "./missingImages";

// Every place the site SHOWS a Cloudinary file, with the page it is on — for
// the missing-image scan (lib/missingImages.ts). The same sources as
// imageUsageHelper.getAllUsedImageUrls, which protects files from deletion,
// minus quotations' `uploadedImages`: that list only records which uploads a
// quote owns, and a file in it that the quote no longer prints shows nowhere.
// __tests__/lib/imageReferences.test.ts holds the two lists together.

const PAGE_SIZE = 100;

const BLOCK_LABEL: Record<string, string> = {
  image: "รูป",
  "text-image": "ข้อความ + รูป",
  gallery: "แกลเลอรี",
};

const isCloudinaryUrl = (value: unknown): value is string =>
  typeof value === "string" && value.includes("cloudinary.com");

function parsedJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null; // malformed: nothing to show, nothing to find
  }
}

/**
 * Every Cloudinary URL inside a document's JSON (quotation / billing `data`,
 * whose shape is the client's), with where it sits: "รายการที่ 3" for a line
 * item (`items[2]`), otherwise just "in the document".
 */
function documentImages(data: unknown): { url: string; where: string }[] {
  const found: { url: string; where: string }[] = [];
  const walk = (value: unknown, item: number | null, parentKey: string | null) => {
    if (isCloudinaryUrl(value)) {
      found.push({ url: value, where: item === null ? "รูปในเอกสาร" : `รายการที่ ${item + 1}` });
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, parentKey === "items" && item === null ? i : item, null));
      return;
    }
    if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) walk(v, item, k);
    }
  };
  walk(data, null, null);
  return found;
}

function customerOf(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const d = data as Record<string, unknown>;
  for (const key of ["customerCompany", "customerContact", "customerName"]) {
    if (typeof d[key] === "string" && d[key].trim()) return displayText(d[key] as string);
  }
  return "";
}

const documentTitle = (docNo: unknown, data: unknown, fallback: string) =>
  [displayText(String(docNo ?? "")), customerOf(data)].filter(Boolean).join(" · ") || fallback;

/** Every Cloudinary file the site shows, one reference per place it is shown. */
export async function listImageReferences(): Promise<ImageReference[]> {
  const refs: ImageReference[] = [];

  // 1. Showcase content pages: block pictures and gallery pictures.
  const [contentRows] = await query<RowDataPacket[]>(
    "SELECT id, title, blocks FROM contents WHERE blocks IS NOT NULL"
  );
  for (const row of contentRows) {
    const blocks = parsedJson(row.blocks);
    if (!Array.isArray(blocks)) continue;
    const id = String(row.id);
    const page = {
      kind: "content" as const,
      sourceId: id,
      title: htmlToText(String(row.title ?? "")) || id,
      href: `/showcase/${encodeURIComponent(id)}`,
      hidden: false,
    };
    blocks.forEach((block: Record<string, unknown> | null, i) => {
      if (!block || typeof block !== "object") return;
      const label = `บล็อกที่ ${i + 1} (${BLOCK_LABEL[String(block.type)] ?? String(block.type ?? "")})`;
      if (isCloudinaryUrl(block.imageUrl)) refs.push({ ...page, url: block.imageUrl, where: label });
      if (Array.isArray(block.imageUrls)) {
        block.imageUrls.forEach((u, j) => {
          if (isCloudinaryUrl(u)) refs.push({ ...page, url: u, where: `${label} · รูปที่ ${j + 1}` });
        });
      }
    });
  }

  // 2. Product pictures.
  const [productRows] = await query<RowDataPacket[]>(
    "SELECT id, image, title_th, title_en, isPublished FROM products WHERE image IS NOT NULL AND image != ''"
  );
  for (const row of productRows) {
    if (!isCloudinaryUrl(row.image)) continue;
    const id = String(row.id);
    refs.push({
      url: row.image,
      kind: "product",
      sourceId: id,
      title: htmlToText(String(row.title_th ?? "")) || htmlToText(String(row.title_en ?? "")) || id,
      where: "รูปสินค้า",
      href: `/edit-product/${encodeURIComponent(id)}`,
      hidden: row.isPublished === 0 || row.isPublished === false,
    });
  }

  // 3. Catalogs: the cover picture and the PDF itself.
  const [docRows] = await query<RowDataPacket[]>(
    "SELECT id, title, pdfUrl, coverUrl, isPublished FROM documents"
  );
  for (const row of docRows) {
    const id = String(row.id);
    const page = {
      kind: "document" as const,
      sourceId: id,
      title: displayText(String(row.title ?? "")) || id,
      href: "/documents",
      hidden: row.isPublished === 0 || row.isPublished === false,
    };
    if (isCloudinaryUrl(row.coverUrl)) refs.push({ ...page, url: row.coverUrl, where: "รูปปก" });
    if (isCloudinaryUrl(row.pdfUrl)) refs.push({ ...page, url: row.pdfUrl, where: "ไฟล์ PDF" });
  }

  // 4 + 5. Quotations and billing documents — what they print. A page at a
  // time: two years of quotes, up to 200 KB each, is too much to hold at once.
  const documents = [
    {
      kind: "quotation" as const,
      sql: "SELECT id, docNo, data FROM quotations WHERE id > ? ORDER BY id LIMIT ?",
      href: (id: string) => `/quotation?id=${encodeURIComponent(id)}&view=1`,
    },
    {
      kind: "billing" as const,
      sql: "SELECT id, docNo, data FROM billing_documents WHERE id > ? ORDER BY id LIMIT ?",
      href: (id: string) => `/billing?id=${encodeURIComponent(id)}&view=1`,
    },
  ];
  for (const source of documents) {
    for (let after = ""; ; ) {
      const [rows] = await query<RowDataPacket[]>(source.sql, [after, PAGE_SIZE]);
      for (const row of rows) {
        const id = String(row.id);
        const data = parsedJson(row.data);
        const images = documentImages(data);
        if (images.length === 0) continue;
        const page = {
          kind: source.kind,
          sourceId: id,
          title: documentTitle(row.docNo, data, id),
          href: source.href(id),
          hidden: false,
        };
        for (const image of images) refs.push({ ...page, ...image });
      }
      if (rows.length < PAGE_SIZE) break;
      after = String(rows[rows.length - 1].id);
    }
  }

  return refs;
}
