/**
 * The missing-image scan's index and its results by page (app/lib/missingImages.ts):
 * each file is checked once however many places use it, and a missing one is
 * reported on every page that shows it — pages visitors see first.
 */
import { describe, it, expect } from "vitest";
import {
  checkErrorLabel,
  chunk,
  fileNameOf,
  indexImageReferences,
  pagesWithMissingImages,
  type ImageCheckResult,
  type ImageReference,
} from "@/app/lib/missingImages";

const CLD = "https://res.cloudinary.com/demo/image/upload/v1/";
const ref = (over: Partial<ImageReference>): ImageReference => ({
  url: `${CLD}a.jpg`,
  kind: "content",
  sourceId: "c1",
  title: "หน้า A",
  where: "บล็อกที่ 1 (รูป)",
  href: "/showcase/c1",
  hidden: false,
  ...over,
});
const result = (url: string, status: ImageCheckResult["status"]): [string, ImageCheckResult] => [
  url,
  { url, status, httpStatus: status === "ok" ? 200 : status === "missing" ? 404 : null },
];

describe("indexImageReferences", () => {
  it("lists each page once and each file once, with every place the file is used", () => {
    const refs = [
      ref({ url: `${CLD}a.jpg`, where: "บล็อกที่ 1 (รูป)" }),
      ref({ url: `${CLD}b.jpg`, where: "บล็อกที่ 2 (แกลเลอรี) · รูปที่ 1" }),
      ref({ url: `${CLD}a.jpg`, kind: "product", sourceId: "p1", title: "สินค้า P", where: "รูปสินค้า", href: "/edit-product/p1" }),
      ref({ url: `${CLD}a.jpg`, where: "บล็อกที่ 3 (รูป)" }),
    ];
    expect(indexImageReferences(refs)).toEqual({
      pages: [
        { kind: "content", sourceId: "c1", title: "หน้า A", href: "/showcase/c1", hidden: false },
        { kind: "product", sourceId: "p1", title: "สินค้า P", href: "/edit-product/p1", hidden: false },
      ],
      images: [
        {
          url: `${CLD}a.jpg`,
          uses: [
            { page: 0, where: "บล็อกที่ 1 (รูป)" },
            { page: 1, where: "รูปสินค้า" },
            { page: 0, where: "บล็อกที่ 3 (รูป)" },
          ],
        },
        { url: `${CLD}b.jpg`, uses: [{ page: 0, where: "บล็อกที่ 2 (แกลเลอรี) · รูปที่ 1" }] },
      ],
    });
  });

  it("the same id under two kinds is two pages", () => {
    const index = indexImageReferences([ref({ kind: "quotation", sourceId: "x" }), ref({ kind: "billing", sourceId: "x" })]);
    expect(index.pages).toHaveLength(2);
    expect(index.images).toHaveLength(1);
  });
});

describe("pagesWithMissingImages", () => {
  const refs = [
    ref({ url: `${CLD}gone.jpg`, kind: "billing", sourceId: "b1", title: "INV-1", where: "รายการที่ 1", href: "/billing?id=b1&view=1" }),
    ref({ url: `${CLD}gone.jpg`, kind: "product", sourceId: "p1", title: "เครื่องชั่ง", where: "รูปสินค้า", href: "/edit-product/p1", hidden: true }),
    ref({ url: `${CLD}ok.jpg`, kind: "content", sourceId: "c1", title: "ข", where: "บล็อกที่ 1 (รูป)" }),
    ref({ url: `${CLD}gone2.png`, kind: "content", sourceId: "c2", title: "ก", where: "บล็อกที่ 2 (แกลเลอรี) · รูปที่ 3", href: "/showcase/c2" }),
    ref({ url: `${CLD}unknown.jpg`, kind: "content", sourceId: "c3", title: "ค", href: "/showcase/c3" }),
  ];
  const index = indexImageReferences(refs);

  it("reports a missing file on every page that shows it — content first, then products, … billing last", () => {
    const results = new Map([
      result(`${CLD}gone.jpg`, "missing"),
      result(`${CLD}ok.jpg`, "ok"),
      result(`${CLD}gone2.png`, "missing"),
      result(`${CLD}unknown.jpg`, "error"),
    ]);
    const pages = pagesWithMissingImages(index, results);
    expect(pages.map((p) => [p.kind, p.sourceId])).toEqual([
      ["content", "c2"],
      ["product", "p1"],
      ["billing", "b1"],
    ]);
    expect(pages[0]).toMatchObject({
      title: "ก",
      href: "/showcase/c2",
      missing: [{ url: `${CLD}gone2.png`, where: "บล็อกที่ 2 (แกลเลอรี) · รูปที่ 3", fileName: "gone2.png" }],
    });
    expect(pages[1]).toMatchObject({ hidden: true, missing: [{ where: "รูปสินค้า", fileName: "gone.jpg" }] });
  });

  it("an unchecked or unreadable file is not called missing", () => {
    expect(pagesWithMissingImages(index, new Map())).toEqual([]);
    expect(pagesWithMissingImages(index, new Map([result(`${CLD}gone.jpg`, "error")]))).toEqual([]);
  });

  it("orders by kind before title — titles that sort the other way round do not reorder the kinds", () => {
    const mixed = indexImageReferences([
      ref({ url: `${CLD}y.jpg`, kind: "billing", sourceId: "b", title: "ก" }),
      ref({ url: `${CLD}y.jpg`, kind: "product", sourceId: "p", title: "ข" }),
      ref({ url: `${CLD}y.jpg`, kind: "content", sourceId: "c", title: "ฮ" }),
    ]);
    const pages = pagesWithMissingImages(mixed, new Map([result(`${CLD}y.jpg`, "missing")]));
    expect(pages.map((p) => p.kind)).toEqual(["content", "product", "billing"]);
  });

  it("orders pages of one kind by title, the Thai way", () => {
    const more = indexImageReferences([
      ref({ url: `${CLD}x.jpg`, sourceId: "1", title: "ข" }),
      ref({ url: `${CLD}x.jpg`, sourceId: "2", title: "ก" }),
    ]);
    const pages = pagesWithMissingImages(more, new Map([result(`${CLD}x.jpg`, "missing")]));
    expect(pages.map((p) => p.title)).toEqual(["ก", "ข"]);
  });
});

describe("small helpers", () => {
  it("fileNameOf: the last part of the address, decoded", () => {
    expect(fileNameOf(`${CLD}samples/mycom/e8onny.jpg`)).toBe("e8onny.jpg");
    expect(fileNameOf(`${CLD}%E0%B8%A3%E0%B8%B9%E0%B8%9B.jpg?x=1#y`)).toBe("รูป.jpg");
    expect(fileNameOf(`${CLD}bad%E0.jpg`)).toBe("bad%E0.jpg");
    expect(fileNameOf("https://res.cloudinary.com/")).toBe("https://res.cloudinary.com/");
  });

  it("chunk: in order, `size` at a time", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 20)).toEqual([]);
  });

  it("checkErrorLabel says why in Thai", () => {
    expect(checkErrorLabel({ httpStatus: null, detail: "timeout" })).toBe("Cloudinary ตอบช้าเกินไป");
    expect(checkErrorLabel({ httpStatus: null, detail: "unsupported" })).toBe("ไม่ใช่ลิงก์ของ Cloudinary");
    expect(checkErrorLabel({ httpStatus: 302, detail: "redirect" })).toBe("Cloudinary ส่งต่อไปที่อื่น");
    expect(checkErrorLabel({ httpStatus: 401 })).toBe("Cloudinary ไม่ให้เข้าถึง (401)");
    expect(checkErrorLabel({ httpStatus: 403 })).toBe("Cloudinary ไม่ให้เข้าถึง (403)");
    expect(checkErrorLabel({ httpStatus: 420 })).toBe("Cloudinary จำกัดจำนวนคำขอ");
    expect(checkErrorLabel({ httpStatus: 429 })).toBe("Cloudinary จำกัดจำนวนคำขอ");
    expect(checkErrorLabel({ httpStatus: 500 })).toBe("Cloudinary ตอบ 500");
    expect(checkErrorLabel({ httpStatus: null, detail: "network" })).toBe("เชื่อมต่อ Cloudinary ไม่ได้");
  });
});
