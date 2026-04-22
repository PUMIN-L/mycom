"use client";

import { useT } from "../i18n/LanguageContext";
import { translations } from "../i18n/translations";
import Image from "next/image";

export default function Products() {
  const t = useT();

  return (
    <section id="products" className="py-24 md:py-32 relative">
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[var(--bg-secondary)]/50 to-transparent" />

      <div className="section-wrapper relative z-10">
        {/* Section Header */}
        <div className="text-center mb-16">
          <span className="inline-block px-4 py-1.5 rounded-full text-xs font-medium border border-[var(--border-color-hover)] text-[var(--accent-light)] bg-[var(--accent)]/10 mb-4">
            {t(translations.products.sectionTag)}
          </span>
          <h2 className="text-3xl md:text-5xl font-bold text-white mb-4">
            {t(translations.products.title)}
          </h2>
          <p className="text-[var(--text-secondary)] max-w-2xl mx-auto text-base md:text-lg">
            {t(translations.products.subtitle)}
          </p>
        </div>

        {/* Product Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {translations.products.items.map((item, i) => (
            <div
              key={i}
              className="glass rounded-2xl overflow-hidden card-hover group"
            >
              {/* Image */}
              <div className="relative h-52 overflow-hidden bg-[var(--bg-secondary)]">
                <Image
                  src={item.image}
                  alt={item.title.en}
                  fill
                  className="object-cover transition-transform duration-500 group-hover:scale-110"
                  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg-card)] via-transparent to-transparent opacity-60" />
              </div>

              {/* Content */}
              <div className="p-6">
                <h3 className="text-lg font-bold text-white mb-2 group-hover:text-[var(--accent-light)] transition-colors">
                  {t(item.title)}
                </h3>
                <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                  {t(item.desc)}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
