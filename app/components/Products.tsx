"use client";

import { useT } from "../i18n/LanguageContext";
import { translations } from "../i18n/translations";
import Image from "next/image";

export default function Products() {
  const t = useT();

  return (
    <section id="products" className="py-32 md:py-48 bg-[var(--bg-secondary)] relative">
      <div className="section-wrapper relative z-10">
        {/* Section Header */}
        <div className="text-center mb-24">
          <span className="inline-block text-[10px] font-bold uppercase tracking-[0.4em] text-[var(--accent)] mb-4">
            {t(translations.products.sectionTag)}
          </span>
          <h2 className="text-4xl md:text-6xl font-serif text-[var(--brand-navy)] mb-6">
            {t(translations.products.title)}
          </h2>
          <div className="w-20 h-[1px] bg-[var(--accent)] mx-auto mb-8" />
          <p className="text-[var(--text-secondary)] max-w-2xl mx-auto text-lg md:text-xl font-light">
            {t(translations.products.subtitle)}
          </p>
        </div>

        {/* Product Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-10">
          {translations.products.items.map((item, i) => (
            <div
              key={i}
              className="bg-white overflow-hidden premium-card group"
            >
              {/* Image Container */}
              <div className="relative h-72 overflow-hidden bg-gray-100">
                <Image
                  src={item.image}
                  alt={item.title.en}
                  fill
                  className="object-cover transition-transform duration-700 group-hover:scale-105"
                  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                />
                <div className="absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/10" />
              </div>

              {/* Content */}
              <div className="p-10">
                <h3 className="text-2xl font-serif text-[var(--brand-navy)] mb-4 group-hover:text-[var(--accent)] transition-colors">
                  {t(item.title)}
                </h3>
                <p className="text-[var(--text-muted)] leading-relaxed font-light text-base mb-6">
                  {t(item.desc)}
                </p>
                <div className="flex items-center gap-3 text-[10px] font-bold uppercase tracking-widest text-[var(--accent)]">
                  View Collection
                  <div className="w-8 h-[1px] bg-[var(--accent)] transition-all group-hover:w-12" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
