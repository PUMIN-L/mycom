import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  getContent,
  getAllContentsMeta,
  ContentBlock,
} from "../../lib/contentStore";
import { getAllProducts, getAllCategories, isProductPublic } from "../../lib/productStore";
import { getSession } from "../../lib/session";
import { SITE_URL, SITE_NAME } from "../../lib/site";
import { getCompanyInfo } from "../../lib/companyInfo";
import ShowcaseClient from "./ShowcaseClient";

export const dynamic = "force-dynamic";

// Pull readable text out of the content blocks for the meta description.
function plainTextFromBlocks(blocks: ContentBlock[]): string {
  return blocks
    .filter((b) => (b.type === "text" || b.type === "text-image") && b.content)
    .map((b) => b.content as string)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstImage(blocks: ContentBlock[]): string | undefined {
  return blocks.find((b) => b.imageUrl)?.imageUrl;
}

// Content linked to a hidden (unpublished / pending-delete) product is
// effectively that product's marketing page — anonymous callers must see it
// exactly as if it doesn't exist (matches getProductsData.ts's public filter
// and /api/contents' anonymous filter). Admins (session present) see it.
async function isHiddenFromAnonymous(productId: string | null | undefined, hasSession: boolean): Promise<boolean> {
  if (hasSession || !productId) return false;
  const products = await getAllProducts();
  const product = products.find((p) => p.id === productId);
  return !!product && !isProductPublic(product);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const [content, session] = await Promise.all([getContent(id), getSession()]);

  if (!content || (await isHiddenFromAnonymous(content.productId, !!session))) {
    return { title: "ไม่พบเนื้อหา", robots: { index: false, follow: false } };
  }

  const description =
    plainTextFromBlocks(content.blocks).slice(0, 160) || SITE_NAME;
  const image = firstImage(content.blocks);
  const canonical = `/showcase/${content.id}`;

  return {
    title: content.title,
    description,
    alternates: { canonical },
    openGraph: {
      type: "article",
      title: content.title,
      description,
      url: `${SITE_URL}${canonical}`,
      images: image ? [{ url: image }] : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title: content.title,
      description,
    },
  };
}

export default async function ShowcaseContentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Fetch everything the editor needs on the server, in parallel. allContents is
  // metadata-only (no blocks) — it's used just for the "Other Contents" list and
  // the edit-mode product-link check, never for block bodies.
  const [content, allContents, products, categories, session, companyInfo] = await Promise.all([
    getContent(id),
    getAllContentsMeta(),
    getAllProducts(),
    getAllCategories(),
    getSession(),
    getCompanyInfo(),
  ]);

  if (!content) {
    notFound();
  }
  if (await isHiddenFromAnonymous(content.productId, !!session)) {
    notFound();
  }

  // Never ship unpublished products' full data (title/desc/image) to an
  // anonymous client in the RSC payload — only used for the product badge and
  // (while editing, admin-only) the product picker, but the raw prop reaches
  // every visitor regardless of what the UI happens to render.
  const visibleProducts = session ? products : products.filter(isProductPublic);

  // Same reasoning for the "other contents" metadata list: content linked to
  // a hidden product must not appear in an anonymous visitor's RSC payload.
  const visibleAllContents = session
    ? allContents
    : allContents.filter((c) => {
        if (!c.productId) return true;
        const product = products.find((p) => p.id === c.productId);
        return !product || isProductPublic(product);
      });

  const description = plainTextFromBlocks(content.blocks).slice(0, 200);
  const image = firstImage(content.blocks);

  const logo = { "@type": "ImageObject", url: `${SITE_URL}/icon.png` };
  const articleLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: content.title,
    description: description || undefined,
    image: image ? [image] : undefined,
    datePublished: content.createdAt || undefined,
    // No updatedAt column yet, so modified == published; Google's Article
    // guidelines still want the field present.
    dateModified: content.createdAt || undefined,
    author: { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
    publisher: { "@type": "Organization", name: SITE_NAME, url: SITE_URL, logo },
    mainEntityOfPage: `${SITE_URL}/showcase/${content.id}`,
  };

  // Breadcrumb trail (Home › Showcase › Title) for rich results.
  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    // Two levels only — the /showcase list URL is now the admin panel
    // (redirects to /adminpanel), so it must not appear in a public breadcrumb.
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
      {
        "@type": "ListItem",
        position: 2,
        name: content.title,
        item: `${SITE_URL}/showcase/${content.id}`,
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleLd).replace(/</g, '\\u003c') }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd).replace(/</g, '\\u003c') }}
      />
      <ShowcaseClient
        initialContent={content}
        initialAllContents={visibleAllContents}
        initialProducts={visibleProducts}
        initialCategories={categories}
        companyInfo={{ email: companyInfo.email, phone: companyInfo.phone, address: companyInfo.address }}
      />
    </>
  );
}
