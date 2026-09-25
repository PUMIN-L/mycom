import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  getContent,
  getAllContentsMeta,
  ContentBlock,
} from "../../lib/contentStore";
import { getAllProducts, getAllCategories, isProductPublic } from "../../lib/productStore";
import { getSession } from "../../lib/session";
import { isMaintenanceMode } from "../../lib/settingsStore";
import { SITE_URL, SITE_NAME } from "../../lib/site";
import { getCompanyInfo } from "../../lib/companyInfo";
import { htmlToText, clipText } from "../../lib/stripHtml";
import { pageMetadata } from "../../lib/pageMetadata";
import { showcasePageTitle, relatedShowcaseItems } from "../../lib/showcaseSeo";
import { categoryPath } from "../../lib/catalogPaths";
import ShowcaseClient, {
  type ProductItem as ShowcaseProductItem,
  type ProductCategory as ShowcaseCategoryItem,
  type RelatedItem as ShowcaseRelatedItem,
  type RelatedCategory as ShowcaseRelatedCategory,
} from "./ShowcaseClient";

export const dynamic = "force-dynamic";

// Pull readable text out of the content blocks for the meta description.
// Block content is rich text: it goes through htmlToText, or the description
// carried the tags ("<p>…</p>") and entities ("&amp;") verbatim.
function plainTextFromBlocks(blocks: ContentBlock[]): string {
  return blocks
    .filter((b) => (b.type === "text" || b.type === "text-image") && b.content)
    .map((b) => htmlToText(b.content as string))
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

  // Read only when there is a product to name (cached; isHiddenFromAnonymous
  // above has usually read it already).
  const product = content.productId
    ? (await getAllProducts()).find((p) => p.id === content.productId)
    : undefined;

  // `content.title` is rich text (sanitizeRichText, not plain text) — the
  // page itself renders it with dangerouslySetInnerHTML, but <title>/OG/
  // Twitter tags are plain-text contexts, so a title saved as e.g.
  // `<p>GM-4</p>` was showing up on Google literally with the tags still in
  // it. showcasePageTitle reads it as text, and adds the product's names when
  // the title is only a model number (lib/showcaseSeo.ts).
  const title = showcasePageTitle(content.title, product) || SITE_NAME;
  const description = clipText(
    plainTextFromBlocks(content.blocks) ||
      (product ? htmlToText(product.desc_th || product.desc_en) : "") ||
      title
  );

  return pageMetadata({
    title,
    description,
    path: `/showcase/${content.id}`,
    image: firstImage(content.blocks),
    type: "article",
  });
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
  const [content, allContents, products, categories, session, companyInfo, maintenanceOn] = await Promise.all([
    getContent(id),
    getAllContentsMeta(),
    getAllProducts(),
    getAllCategories(),
    getSession(),
    getCompanyInfo(),
    isMaintenanceMode(),
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

  // ...and of what IS shipped, only the fields ShowcaseClient reads (the
  // product badge and the edit-mode picker: id, category, three titles).
  // Passing the full rows serialized every product's three-language
  // description, image and flags into each of these pages — ~55 KB of JSON
  // per view at 85 products, the bulk of the page — for nothing. The type
  // annotations make any extra field here a compile error.
  const productItems: ShowcaseProductItem[] = visibleProducts.map((p): ShowcaseProductItem => ({
    id: p.id,
    categoryId: p.categoryId,
    title_th: p.title_th,
    title_en: p.title_en,
    title_zh: p.title_zh,
  }));
  const categoryItems: ShowcaseCategoryItem[] = categories.map((c): ShowcaseCategoryItem => ({
    id: c.id,
    name_th: c.name_th,
    name_en: c.name_en,
    name_zh: c.name_zh,
  }));

  // Same reasoning for the "other contents" metadata list: content linked to
  // a hidden product must not appear in an anonymous visitor's RSC payload.
  const visibleAllContents = session
    ? allContents
    : allContents.filter((c) => {
        if (!c.productId) return true;
        const product = products.find((p) => p.id === c.productId);
        return !product || isProductPublic(product);
      });

  // ── Links to other product pages (lib/showcaseSeo.ts) ──
  // Built from PUBLIC products only, whoever is looking: this list is for
  // visitors and crawlers, and a hidden product must never be linked from a
  // public page. A content page used to link nowhere but the site nav, so
  // most of them were reachable only through the sitemap.
  const publicProducts = products.filter(isProductPublic);
  const relatedItems: ShowcaseRelatedItem[] = relatedShowcaseItems({
    currentContentId: content.id,
    currentProductId: content.productId,
    products: publicProducts,
    contents: visibleAllContents,
  }).map(({ contentId, product }): ShowcaseRelatedItem => ({
    contentId,
    image: product.image,
    title_th: product.title_th,
    title_en: product.title_en,
    title_zh: product.title_zh,
  }));
  // The linked product's category page — "see everything in this category".
  // Only for a public product: its category then has at least one public
  // product, so the page exists.
  const linkedProduct = publicProducts.find((p) => p.id === content.productId);
  const linkedCategory = linkedProduct
    ? categories.find((c) => c.id === linkedProduct.categoryId)
    : undefined;
  const relatedCategory: ShowcaseRelatedCategory | null = linkedCategory
    ? {
        path: categoryPath(linkedCategory),
        name_th: linkedCategory.name_th,
        name_en: linkedCategory.name_en,
        name_zh: linkedCategory.name_zh,
      }
    : null;

  const description = clipText(plainTextFromBlocks(content.blocks), 200);
  const image = firstImage(content.blocks);
  // Same rich-text-title issue as generateMetadata above: schema.org's
  // `headline`/breadcrumb `name` are plain-text fields, not HTML.
  const plainTitle = htmlToText(content.title) || SITE_NAME;

  const logo = { "@type": "ImageObject", url: `${SITE_URL}/icon.png` };
  const articleLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: plainTitle,
    description: description || undefined,
    image: image ? [image] : undefined,
    datePublished: content.createdAt || undefined,
    // When the content last changed (contents.updatedAt, v43); a content not
    // edited since the column existed reads as modified == published.
    dateModified: content.updatedAt || content.createdAt || undefined,
    author: { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
    publisher: { "@type": "Organization", name: SITE_NAME, url: SITE_URL, logo },
    mainEntityOfPage: `${SITE_URL}/showcase/${content.id}`,
  };

  // Breadcrumb trail for rich results: Home › {category} › Title when the
  // content belongs to a public product, else Home › Title. Never the
  // /showcase list URL — that is the admin panel now (redirects to
  // /adminpanel), so it must not appear in a public breadcrumb.
  const crumbs = [
    { name: "Home", item: SITE_URL },
    ...(linkedCategory
      ? [{ name: htmlToText(linkedCategory.name_th || linkedCategory.name_en), item: `${SITE_URL}${categoryPath(linkedCategory)}` }]
      : []),
    { name: plainTitle, item: `${SITE_URL}/showcase/${content.id}` },
  ];
  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((crumb, i) => ({ "@type": "ListItem", position: i + 1, ...crumb })),
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
        initialProducts={productItems}
        initialCategories={categoryItems}
        relatedItems={relatedItems}
        relatedCategory={relatedCategory}
        companyInfo={{ email: companyInfo.email, phone: companyInfo.phone, address: companyInfo.address }}
        maintenanceOn={maintenanceOn}
      />
    </>
  );
}
