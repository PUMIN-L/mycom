"use client";

import { useT } from "../i18n/LanguageContext";
import { translations } from "../i18n/translations";
import Image from "next/image";

const serviceIcons = {
  sales: "/images/service-sales.png",
  service: "/images/service-calibration-new.png",
  lab: "/images/service-lab.png",
};

export default function Services() {
  const t = useT();

  return (
    <section id="services" className="py-28 md:py-30 bg-white relative overflow-hidden ">
      {/* Background Decorative Element */}
      <div className="absolute top-0 right-0 w-1/3 h-full bg-[var(--bg-secondary)] -skew-x-12 translate-x-1/2" />

      <div className="section-wrapper relative z-10 ">
        {/* Section Header */}
        <div className="mb-20 max-w-3xl">
          {/* <span className="inline-block text-[10px] font-bold uppercase tracking-[0.4em] text-[var(--accent)] mb-4">
            {t(translations.services.sectionTag)}
          </span> */}
          <h2 className="text-3xl md:text-5xl font-serif text-[var(--accent)] mb-8 leading-tight">
            {t(translations.services.title)}
          </h2>
          <div className="w-20 h-[1px] bg-[var(--accent)] mb-8" />
          <p className="text-[var(--text-secondary)] text-lg md:text-xl font-light leading-relaxed">
            {t(translations.services.subtitle)}
          </p>
        </div>

        {/* Service Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
          {translations.services.items.map((item, i) => (
            <div
              key={i}
              className="premium-card flex flex-col items-start group overflow-hidden border border-[var(--border-color)] hover:shadow-xl transition-all duration-500"
            >
              <div className="w-full h-72 relative overflow-hidden">
                <Image
                  src={serviceIcons[item.icon as keyof typeof serviceIcons]}
                  alt={t(item.title)}
                  fill
                  sizes="(max-width: 768px) 100vw, 33vw"
                  className="object-cover object-center transition-transform duration-700"
                />
                <div className="absolute inset-0 bg-black/5 group-hover:bg-transparent transition-colors duration-500" />
              </div>

              <div className="p-8 md:p-10 flex flex-col flex-grow">
                <h3 className="text-2xl font-serif text-[var(--brand-navy)] mb-4 group-hover:text-[var(--accent)] transition-colors">
                  {t(item.title)}
                </h3>
                <p className="text-[var(--text-muted)] leading-relaxed font-light mb-8">
                  {t(item.desc)}
                </p>
                <div className="mt-auto flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-[var(--accent)] group-hover:gap-4 transition-all">
                  Learn More
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                  </svg>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
