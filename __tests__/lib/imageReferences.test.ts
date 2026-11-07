// @vitest-environment node
/**
 * Every place the site shows a Cloudinary file, with its page
 * (app/lib/imageReferences.ts) — and the same places imageUsageHelper's
 * getAllUsedImageUrls protects from deletion, so a new image location added
 * to one and not the other fails here.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/app/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/app/lib/cloudinaryHelper", () => ({ deleteCloudinaryImage: vi.fn(), extractPublicId: vi.fn() }));
import { query } from "@/app/lib/db";
import { listImageReferences } from "@/app/lib/imageReferences";
import { getAllUsedImageUrls } from "@/app/lib/imageUsageHelper";

const CLD = "https://res.cloudinary.com/demo/image/upload/v1/";

type Rows = Record<string, unknown>[];
let tables: { contents: Rows; products: Rows; documents: Rows; quotations: Rows; billing: Rows };

/** Answers each query from `tables`, paging quotations / billing like the store asks. */
function fakeDb() {
  vi.mocked(query).mockImplementation((async (sql: string, params: unknown[] = []) => {
    const page = (rows: Rows) => {
      const [after, limit] = params as [string, number];
      return rows
        .filter((r) => String(r.id) > after)
        .sort((a, b) => String(a.id).localeCompare(String(b.id)))
        .slice(0, limit);
    };
    if (/FROM contents/.test(sql)) return [tables.contents, []];
    if (/FROM products/.test(sql)) return [tables.products, []];
    if (/FROM documents/.test(sql)) return [tables.documents, []];
    if (/FROM quotations/.test(sql)) return [params.length ? page(tables.quotations) : tables.quotations, []];
    if (/FROM billing_documents/.test(sql)) return [params.length ? page(tables.billing) : tables.billing, []];
    throw new Error(`unexpected SQL: ${sql}`);
  }) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  tables = { contents: [], products: [], documents: [], quotations: [], billing: [] };
  fakeDb();
});

describe("listImageReferences", () => {
  it("content pages: a block's picture and each gallery picture, with the block and position", async () => {
    tables.contents = [
      {
        id: "c1",
        title: "<p>YASUDA &amp; No.120-FWP</p>",
        blocks: [
          { type: "text-image", imageUrl: `${CLD}a.jpg` },
          { type: "text", content: "<p>no picture</p>" },
          { type: "gallery", imageUrls: [`${CLD}b.png`, "/local.png", `${CLD}c.jpg`] },
          { type: "image", imageUrl: "https://example.com/not-cloudinary.jpg" },
          null,
        ],
      },
    ];
    expect(await listImageReferences()).toEqual([
      { kind: "content", sourceId: "c1", title: "YASUDA & No.120-FWP", href: "/showcase/c1", hidden: false, url: `${CLD}a.jpg`, where: "บล็อกที่ 1 (ข้อความ + รูป)" },
      { kind: "content", sourceId: "c1", title: "YASUDA & No.120-FWP", href: "/showcase/c1", hidden: false, url: `${CLD}b.png`, where: "บล็อกที่ 3 (แกลเลอรี) · รูปที่ 1" },
      { kind: "content", sourceId: "c1", title: "YASUDA & No.120-FWP", href: "/showcase/c1", hidden: false, url: `${CLD}c.jpg`, where: "บล็อกที่ 3 (แกลเลอรี) · รูปที่ 3" },
    ]);
  });

  it("reads blocks stored as a JSON string, and skips ones it cannot read", async () => {
    tables.contents = [
      { id: "s", title: "", blocks: JSON.stringify([{ type: "image", imageUrl: `${CLD}s.jpg` }]) },
      { id: "bad", title: "x", blocks: "{not json" },
      { id: "obj", title: "x", blocks: { not: "an array" } },
    ];
    const refs = await listImageReferences();
    expect(refs).toEqual([expect.objectContaining({ sourceId: "s", title: "s", where: "บล็อกที่ 1 (รูป)" })]);
  });

  it("products: the picture, named by the Thai title (else English, else id), hidden when unpublished", async () => {
    tables.products = [
      { id: "p1", image: `${CLD}p1.jpg`, title_th: "<p>เครื่องชั่ง</p>", title_en: "Scale", isPublished: 1 },
      { id: "p2", image: `${CLD}p2.jpg`, title_th: "", title_en: "<p>Oven</p>", isPublished: 0 },
      { id: "p3", image: `${CLD}p3.jpg`, title_th: "", title_en: "", isPublished: false },
      { id: "p4", image: "/images/local.png", title_th: "ท้องถิ่น", title_en: "", isPublished: 1 },
    ];
    expect(await listImageReferences()).toEqual([
      { url: `${CLD}p1.jpg`, kind: "product", sourceId: "p1", title: "เครื่องชั่ง", where: "รูปสินค้า", href: "/edit-product/p1", hidden: false },
      { url: `${CLD}p2.jpg`, kind: "product", sourceId: "p2", title: "Oven", where: "รูปสินค้า", href: "/edit-product/p2", hidden: true },
      { url: `${CLD}p3.jpg`, kind: "product", sourceId: "p3", title: "p3", where: "รูปสินค้า", href: "/edit-product/p3", hidden: true },
    ]);
  });

  it("catalogs: the cover and the PDF, hidden when unpublished", async () => {
    tables.documents = [
      { id: "d1", title: "แคตตาล็อก A & B", coverUrl: `${CLD}cover.jpg`, pdfUrl: "https://res.cloudinary.com/demo/raw/upload/v1/a.pdf", isPublished: 0 },
    ];
    const refs = await listImageReferences();
    expect(refs.map((r) => [r.where, r.title, r.href, r.hidden])).toEqual([
      ["รูปปก", "แคตตาล็อก A & B", "/documents", true],
      ["ไฟล์ PDF", "แคตตาล็อก A & B", "/documents", true],
    ]);
  });

  it("quotations and billing documents: line-item pictures by item number, titled by number and customer, opened read-only", async () => {
    tables.quotations = [
      {
        id: "q1",
        docNo: "QT2026-0001",
        data: JSON.stringify({
          customerCompany: "บริษัท ก",
          items: [{ imageUrl: "" }, { imageUrl: `${CLD}q-item2.jpg`, machines: [{ photo: `${CLD}q-nested.jpg` }] }],
          logo: `${CLD}q-logo.png`,
        }),
      },
      { id: "q2", docNo: "QT2026-0002", data: { items: [{ imageUrl: "https://example.com/x.jpg" }] } },
    ];
    tables.billing = [{ id: "b1", docNo: "", data: { customerName: "คุณ ข", items: [{ imageUrl: `${CLD}b-item1.jpg` }] } }];
    const refs = await listImageReferences();
    expect(refs).toEqual([
      { kind: "quotation", sourceId: "q1", title: "QT2026-0001 · บริษัท ก", href: "/quotation?id=q1&view=1", hidden: false, url: `${CLD}q-item2.jpg`, where: "รายการที่ 2" },
      { kind: "quotation", sourceId: "q1", title: "QT2026-0001 · บริษัท ก", href: "/quotation?id=q1&view=1", hidden: false, url: `${CLD}q-nested.jpg`, where: "รายการที่ 2" },
      { kind: "quotation", sourceId: "q1", title: "QT2026-0001 · บริษัท ก", href: "/quotation?id=q1&view=1", hidden: false, url: `${CLD}q-logo.png`, where: "รูปในเอกสาร" },
      { kind: "billing", sourceId: "b1", title: "คุณ ข", href: "/billing?id=b1&view=1", hidden: false, url: `${CLD}b-item1.jpg`, where: "รายการที่ 1" },
    ]);
  });

  it("reads quotations and billing a page at a time, all the way through", async () => {
    tables.quotations = Array.from({ length: 250 }, (_, i) => ({
      id: `q${String(i).padStart(3, "0")}`,
      docNo: `QT-${i}`,
      data: { items: [{ imageUrl: `${CLD}q${i}.jpg` }] },
    }));
    const refs = await listImageReferences();
    expect(refs).toHaveLength(250);
    const quotationQueries = vi.mocked(query).mock.calls.filter(([sql]) => /FROM quotations/.test(String(sql)));
    expect(quotationQueries.map(([, params]) => params)).toEqual([
      ["", 100],
      ["q099", 100],
      ["q199", 100],
    ]);
  });

  it("a document with no title or customer is named by its id", async () => {
    tables.quotations = [{ id: "q9", docNo: null, data: { items: [{ imageUrl: `${CLD}x.jpg` }] } }];
    expect((await listImageReferences())[0].title).toBe("q9");
  });
});

describe("the scan covers what deletion protects", () => {
  it("every file getAllUsedImageUrls protects is in the scan — except a quote's uploadedImages the quote no longer prints", async () => {
    tables.contents = [{ id: "c", title: "C", blocks: [{ type: "image", imageUrl: `${CLD}c.jpg` }, { type: "gallery", imageUrls: [`${CLD}g.jpg`] }] }];
    tables.products = [{ id: "p", image: `${CLD}p.jpg`, title_th: "P", title_en: "", isPublished: 1 }];
    tables.documents = [{ id: "d", title: "D", coverUrl: `${CLD}d.jpg`, pdfUrl: `${CLD}d.pdf`, isPublished: 1 }];
    tables.quotations = [
      {
        id: "q",
        docNo: "Q",
        uploadedImages: JSON.stringify([`${CLD}q-upload.jpg`, `${CLD}q-dropped.jpg`]),
        data: JSON.stringify({ items: [{ imageUrl: `${CLD}q-upload.jpg` }, { imageUrl: `${CLD}p.jpg` }] }),
      },
    ];
    tables.billing = [{ id: "b", docNo: "B", data: JSON.stringify({ items: [{ imageUrl: `${CLD}b.jpg` }] }) }];

    const protectedUrls = await getAllUsedImageUrls();
    const scanned = new Set((await listImageReferences()).map((r) => r.url));
    const notScanned = [...protectedUrls].filter((u) => !scanned.has(u));
    expect(notScanned).toEqual([`${CLD}q-dropped.jpg`]);
  });
});
