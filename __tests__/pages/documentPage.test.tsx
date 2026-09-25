/**
 * /document/[id] — the public PDF catalog viewer, reached from /catalog.
 *  - its <title> carried the brand twice ("X - Profin Lab Scale | Profin Lab Scale");
 *  - its back button went to /adminpanel, which sends a visitor to /login;
 *  - the PDF was only ever loaded by JavaScript, so a crawler had no link to it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

vi.mock("@/app/lib/documentStore", () => ({ getDocument: vi.fn() }));
vi.mock("@/app/document/[id]/PdfViewerWrapper", () => ({ default: () => null }));

import { getDocument } from "@/app/lib/documentStore";
import DocumentPreviewPage, { generateMetadata } from "@/app/document/[id]/page";
import { SITE_NAME, SITE_URL } from "@/app/lib/site";

const params = { params: Promise.resolve({ id: "d1" }) };
const doc = {
  id: "d1",
  title: "Catalog 2026",
  description: "เครื่องทดสอบฟิล์ม",
  pdfUrl: "https://res.cloudinary.com/demo/raw/upload/v1/c.pdf",
  coverUrl: "https://res.cloudinary.com/demo/image/upload/v1/c.jpg",
  createdAt: "2026-01-01",
  sortOrder: 0,
};

beforeEach(() => {
  cleanup();
  vi.mocked(getDocument).mockResolvedValue(doc as never);
});

describe("/document/[id]", () => {
  it("titles the page once with the brand (the root template adds it)", async () => {
    const metadata = await generateMetadata(params);
    expect(metadata.title).toBe("Catalog 2026");
    expect(String(metadata.title)).not.toContain(SITE_NAME);
    expect(metadata.alternates).toEqual({ canonical: "/document/d1" });
    expect(metadata.openGraph).toMatchObject({
      url: `${SITE_URL}/document/d1`,
      images: [{ url: doc.coverUrl }],
    });
  });

  it("goes back to the public catalog, not the admin panel", async () => {
    const { container } = render(await DocumentPreviewPage(params));
    expect(container.querySelector("a[href='/catalog']")).not.toBeNull();
    expect(container.querySelector("a[href='/adminpanel']")).toBeNull();
  });

  it("links the PDF itself for crawlers, and marks the download nofollow", async () => {
    const { container } = render(await DocumentPreviewPage(params));
    const proxy = `/api/documents/proxy?url=${encodeURIComponent(doc.pdfUrl)}`;
    // Compared by attribute: jsdom's selector engine mis-parses "&" inside
    // a quoted [href="…"] value.
    const link = (href: string) =>
      Array.from(container.querySelectorAll("a")).find((a) => a.getAttribute("href") === href);
    expect(link(proxy)?.textContent).toContain("เปิดไฟล์ PDF");
    expect(link(`${proxy}&download=1`)?.getAttribute("rel")).toBe("nofollow");
  });

  it("puts the catalog in the breadcrumb", async () => {
    const { container } = render(await DocumentPreviewPage(params));
    const ld = JSON.parse(container.querySelector('script[type="application/ld+json"]')!.innerHTML);
    expect(ld.itemListElement.map((c: { name: string }) => c.name)).toEqual(["Home", "แคตตาล็อกสินค้า", "Catalog 2026"]);
  });
});
