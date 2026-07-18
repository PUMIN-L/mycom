import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  getContent,
  getAllContentsMeta,
  ContentBlock,
} from "../../lib/contentStore";
import { getAllProducts, getAllCategories } from "../../lib/productStore";
import { SITE_URL, SITE_NAME } from "../../lib/site";
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

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const content = await getContent(id);

  if (!content) {
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
  const [content, allContents, products, categories] = await Promise.all([
    getContent(id),
    getAllContentsMeta(),
    getAllProducts(),
    getAllCategories(),
  ]);

  if (!content) {
    notFound();
  }

  const description = plainTextFromBlocks(content.blocks).slice(0, 200);
  const image = firstImage(content.blocks);

  const articleLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: content.title,
    description: description || undefined,
    image: image || undefined,
    datePublished: content.createdAt || undefined,
    publisher: { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
    mainEntityOfPage: `${SITE_URL}/showcase/${content.id}`,
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleLd).replace(/</g, '\\u003c') }}
      />
      <ShowcaseClient
        initialContent={content}
        initialAllContents={allContents}
        initialProducts={products}
        initialCategories={categories}
      />
    </>
  );
}
