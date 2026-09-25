"use client";

// The body of a /services/[slug] page. The text is in translations.ts
// (servicePages.pages[slug]); server-rendered in Thai, like every public page.

import Image from "next/image";
import Link from "next/link";
import { useT } from "../i18n/LanguageContext";
import { translations } from "../i18n/translations";
import { PRODUCTS_PATH } from "../lib/catalogPaths";
import { SERVICE_PAGES, servicePath, type ServicePage } from "../lib/servicePages";

export default function ServicePageView({ service }: { service: ServicePage }) {
  const t = useT();
  const copy = translations.servicePages.pages[service.slug];
  const title = t(copy.title);
  const others = SERVICE_PAGES.filter((s) => s.slug !== service.slug);

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
            <li aria-current="page" className="text-gray-700">
              {title}
            </li>
          </ol>
        </nav>

        <div className="mb-20 grid grid-cols-1 items-center gap-12 md:grid-cols-2">
          <div>
            <h1 className="mb-6 text-3xl font-bold leading-tight text-[var(--brand-navy)] md:text-5xl">{title}</h1>
            <p className="mb-8 text-lg leading-relaxed text-gray-600">{t(copy.intro)}</p>
            <div className="flex flex-wrap gap-4">
              <Link
                href="/contact"
                className="bg-[var(--accent)] px-8 py-3 font-bold text-white transition hover:opacity-90"
              >
                {t(translations.nav.contact)}
              </Link>
              <Link
                href={PRODUCTS_PATH}
                className="border-2 border-[var(--accent)] px-8 py-3 font-bold text-[var(--accent)] transition hover:bg-[var(--accent)] hover:text-white"
              >
                {t(translations.servicePages.browseProducts)}
              </Link>
            </div>
          </div>
          <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl shadow-xl">
            <Image
              src={service.image}
              alt={title}
              fill
              priority
              sizes="(max-width: 768px) 100vw, 50vw"
              className="object-cover"
            />
          </div>
        </div>

        <div className="mb-20 grid grid-cols-1 gap-12 md:grid-cols-2">
          {[
            { heading: copy.listTitle, items: copy.list },
            { heading: copy.list2Title, items: copy.list2 },
          ].map(({ heading, items }, i) => (
            <section key={i}>
              <h2 className="mb-6 text-2xl font-bold text-[var(--brand-navy)]">{t(heading)}</h2>
              <ul className="space-y-3">
                {items.map((item, j) => (
                  <li key={j} className="flex gap-3 text-gray-700">
                    <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-[var(--accent)]" />
                    <span>{t(item)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <section aria-labelledby="other-services" className="mb-16">
          <h2 id="other-services" className="mb-5 text-xl font-bold text-[var(--brand-navy)]">
            {t(translations.servicePages.otherServices)}
          </h2>
          <ul className="flex flex-wrap gap-3">
            {others.map((s) => (
              <li key={s.slug}>
                <Link
                  href={servicePath(s.slug)}
                  className="inline-block rounded-full border border-gray-200 px-4 py-2 text-sm text-gray-700 transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
                >
                  {t(translations.servicePages.pages[s.slug].title)}
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <div className="flex flex-col items-start justify-between gap-4 rounded-2xl bg-gray-50 p-8 md:flex-row md:items-center">
          <div>
            <p className="text-lg font-semibold text-[var(--brand-navy)]">{t(translations.servicePages.ctaTitle)}</p>
            <p className="text-gray-600">{t(translations.servicePages.ctaText)}</p>
          </div>
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
