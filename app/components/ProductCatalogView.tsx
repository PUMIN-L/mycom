"use client";

// The body of /products (every category) and /products/[slug] (one). The
// server pages hand it plain-text data (lib/catalogPages.ts); this renders it
// in the visitor's language. Server-rendered in Thai, like every public page.
//
// Every product links straight to its content page when it has one
// (lib/productLinks.ts) — these pages exist so that every product page is one
// crawlable link away from the site's navigation.

import SkeletonImage from "./SkeletonImage";
import Link from "next/link";
import { useLanguage, useT } from "../i18n/LanguageContext";
import { translations, type Language } from "../i18n/translations";
import { localize } from "../lib/localize";
import { productHref } from "../lib/productLinks";
import { PRODUCTS_PATH } from "../lib/catalogPaths";
import type { CatalogCategory, CatalogProduct, CatalogSection } from "../lib/catalogPages";

interface ProductCatalogViewProps {
  /** "all" = /products, "category" = one category page (sections has one). */
  mode: "all" | "category";
  sections: CatalogSection[];
  /** The rest of the catalog, linked from a category page. */
  otherCategories?: CatalogCategory[];
  contentIdByProduct: Record<string, string>;
}

export default function ProductCatalogView({
  mode,
  sections,
  otherCategories = [],
  contentIdByProduct,
}: ProductCatalogViewProps) {
  const t = useT();
  const { lang } = useLanguage();
  const name = (c: CatalogCategory) => localize(c, "name", lang);

  const single = mode === "category" ? sections[0] : undefined;
  const heading = single ? name(single) : t(translations.productPages.allTitle);
  // The English name under a Thai/Chinese heading: it is what buyers search.
  const subheading =
    single && lang !== "en" && single.name_en && single.name_en.toLowerCase() !== heading.toLowerCase()
      ? single.name_en
      : null;
  const intro = single
    ? t(translations.productPages.categoryIntro).replace("{name}", heading)
    : t(translations.productPages.allIntro);

  return (
    <div className="pt-32 pb-24">
      <div className="section-wrapper">
        <nav aria-label="Breadcrumb" className="mb-8 text-sm text-gray-500">
          <ol className="flex flex-wrap items-center gap-2">
            <li>
              <Link href="/" className="hover:text-[var(--accent)]">
                {t(translations.nav.home)}
              </Link>
            </li>
            <li aria-hidden="true">›</li>
            {single ? (
              <>
                <li>
                  <Link href={PRODUCTS_PATH} className="hover:text-[var(--accent)]">
                    {t(translations.productPages.allProducts)}
                  </Link>
                </li>
                <li aria-hidden="true">›</li>
                <li aria-current="page" className="text-gray-700">
                  {heading}
                </li>
              </>
            ) : (
              <li aria-current="page" className="text-gray-700">
                {t(translations.productPages.allProducts)}
              </li>
            )}
          </ol>
        </nav>

        <header className="mb-14 max-w-4xl">
          <h1 className="mb-4 text-3xl font-bold leading-tight text-[var(--brand-navy)] md:text-5xl">
            {heading}
          </h1>
          {subheading && <p className="mb-6 text-lg font-medium text-gray-400">{subheading}</p>}
          <p className="text-lg leading-relaxed text-gray-600">{intro}</p>
        </header>

        {sections.map((section) => (
          <section
            key={section.id}
            aria-labelledby={single ? undefined : `category-${section.id}`}
            aria-label={single ? heading : undefined}
            className="mb-16"
          >
            {!single && (
              <div className="mb-6 flex items-baseline justify-between gap-4 border-b border-gray-100 pb-3">
                <h2 id={`category-${section.id}`} className="text-2xl font-bold text-[var(--brand-navy)]">
                  <Link href={section.path} className="hover:text-[var(--accent)]">
                    {name(section)}
                  </Link>
                </h2>
                <Link
                  href={section.path}
                  className="whitespace-nowrap text-sm font-semibold text-[var(--accent)] hover:underline"
                >
                  {t(translations.productPages.viewCategory)} (
                  {t(translations.productPages.itemCount).replace("{n}", String(section.products.length))}) →
                </Link>
              </div>
            )}
            <ul className="grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-4">
              {section.products.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  href={productHref(product.id, contentIdByProduct)}
                  lang={lang}
                  // One heading level below the page's: h2 under a category
                  // page's h1, h3 under /products' category h2s.
                  headingLevel={single ? 2 : 3}
                />
              ))}
            </ul>
          </section>
        ))}

        {otherCategories.length > 0 && (
          <section aria-labelledby="other-categories" className="mb-16">
            <h2 id="other-categories" className="mb-5 text-xl font-bold text-[var(--brand-navy)]">
              {t(translations.productPages.otherCategories)}
            </h2>
            <ul className="flex flex-wrap gap-3">
              {otherCategories.map((c) => (
                <li key={c.id}>
                  <Link
                    href={c.path}
                    className="inline-block rounded-full border border-gray-200 px-4 py-2 text-sm text-gray-700 transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
                  >
                    {name(c)}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="flex flex-col items-start justify-between gap-4 rounded-2xl bg-gray-50 p-8 md:flex-row md:items-center">
          <p className="text-lg font-semibold text-[var(--brand-navy)]">
            {t(translations.productPages.askQuote)}
          </p>
          <Link
            href="/contact"
            className="bg-[var(--accent)] px-8 py-3 font-bold text-white transition hover:opacity-90"
          >
            {t(translations.nav.contact)}
          </Link>
        </div>
      </div>
    </div>
  );
}

function ProductCard({
  product,
  href,
  lang,
  headingLevel,
}: {
  product: CatalogProduct;
  href: string;
  lang: Language;
  headingLevel: 2 | 3;
}) {
  const title = localize(product, "title", lang);
  const en = product.title_en;
  const desc = localize(product, "desc", lang);
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <li>
      <Link
        href={href}
        className="group flex h-full flex-col overflow-hidden rounded-xl border border-gray-100 bg-white transition hover:border-gray-200 hover:shadow-lg"
      >
        <div className="relative aspect-square bg-white">
          {product.image && (
            <SkeletonImage
              src={product.image}
              alt={title}
              fill
              sizes="(max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
              className="object-contain p-5"
            />
          )}
        </div>
        <div className="flex flex-1 flex-col p-4">
          <Heading className="line-clamp-2 whitespace-pre-wrap text-base font-bold text-gray-900 group-hover:text-[var(--accent)]">
            {title}
          </Heading>
          {lang !== "en" && en && en.toLowerCase() !== title.toLowerCase() && (
            <p className="mt-0.5 line-clamp-1 text-xs text-gray-400">{en}</p>
          )}
          {desc && <p className="mt-2 line-clamp-2 whitespace-pre-wrap text-sm text-gray-500">{desc}</p>}
        </div>
      </Link>
    </li>
  );
}
