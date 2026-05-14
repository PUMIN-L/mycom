"use client";

import { useState } from "react";
import { useT } from "../i18n/LanguageContext";
import { translations } from "../i18n/translations";
import Image from "next/image";

export default function Products() {
  const t = useT();
  const [selectedCategory, setSelectedCategory] = useState(0);

  const filteredItems = translations.products.items.filter(
    (item) => item.categoryId === selectedCategory
  );

  return (
    <section id="products" className="py-32 md:py-48 bg-[var(--bg-secondary)] relative">
      {/* Decorative background element */}
      <div className="absolute top-0 right-0 w-1/3 h-1/3 bg-[var(--accent)] opacity-[0.03] rounded-full blur-[120px] -translate-y-1/2 translate-x-1/2" />

      <div className="section-wrapper relative z-10">
        {/* Section Header */}
        <div className="text-center mb-24 animate-fade-in-up">
          <h2 className="text-xl md:text-4xl font-serif text-[var(--accent)] mb-6">
            {t(translations.products.title)}
          </h2>
          {/* <p className="text-[var(--text-secondary)] text-lg md:text-xl font-light max-w-2xl mx-auto italic">
            {t(translations.products.subtitle)}
          </p> */}
        </div>

        <div id="product-content" className="flex flex-col lg:flex-row gap-16 lg:gap-24 scroll-mt-32">
          {/* Sidebar Navigation */}
          <div className="lg:w-1/4">
            <div className="sticky top-32 self-start">
              <div className="flex flex-col gap-6">
                {translations.products.categories.map((category, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      setSelectedCategory(idx);
                      setTimeout(() => {
                        const element = document.getElementById("product-content");
                        if (element) {
                          const rect = element.getBoundingClientRect();
                          if (Math.abs(rect.top - 128) > 10) {
                            window.scrollTo({
                              top: window.scrollY + rect.top - 128,
                              behavior: "smooth"
                            });
                          }
                        }
                      }, 0);
                    }}
                    className={`group text-left transition-all duration-300 w-fit ${idx === selectedCategory
                      ? "text-[var(--text-primary)]"
                      : "text-gray-400 hover:text-[var(--text-primary)]"
                      }`}
                  >
                    <span className="relative py-1 font-serif text-xl md:text-2xl tracking-wide inline-block">
                      {t(category)}
                      <div
                        className={`absolute bottom-0 left-0 h-[1.5px] bg-[var(--text-primary)] transition-all duration-500 ${idx === selectedCategory ? "w-full" : "w-0 group-hover:w-full opacity-30"
                          }`}
                      />
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Product Grid */}
          <div className="lg:w-3/4 min-h-[1200px]">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-16">
              {filteredItems.map((item, i) => (
                <div
                  key={`${selectedCategory}-${i}`}
                  className="group flex flex-col premium-card rounded-2xl p-4 animate-fade-in-up"
                  style={{ animationDelay: `${i * 100}ms` }}
                >
                  <div className="relative aspect-[4/5] overflow-hidden rounded-xl mb-8 bg-gray-50">
                    <Image
                      src={item.image}
                      alt={t(item.title)}
                      fill
                      sizes="(max-width: 1024px) 100vw, 30vw"
                      className="object-cover transition-transform duration-[2s] ease-out group-hover:scale-110"
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors duration-500" />
                  </div>

                  <div className="flex flex-col px-4 pb-4">
                    <h3 className="text-2xl md:text-2xl font-serif text-[var(--brand-navy)] mb-4 transition-colors group-hover:text-[var(--accent)]">
                      {t(item.title)}
                    </h3>
                    <p className="text-gray-400 leading-relaxed font-light text-sm line-clamp-3 mb-8 h-12">
                      {t(item.desc)}
                    </p>
                    <div className="flex items-center gap-4 text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--accent)] group/btn">
                      <span className="border-b border-transparent group-hover/btn:border-[var(--accent)] transition-all duration-300">
                        View Product
                      </span>
                      <svg
                        className="w-4 h-4 transition-transform duration-300 group-hover/btn:translate-x-2"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                      </svg>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {filteredItems.length === 0 && (
              <div className="flex flex-col items-center justify-center py-32 text-center animate-fade-in">
                <div className="w-16 h-[1px] bg-[var(--accent)] mb-8" />
                <p className="text-gray-400 font-serif text-2xl italic">
                  More products arriving soon
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
