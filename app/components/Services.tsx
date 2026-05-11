"use client";

import { useT } from "../i18n/LanguageContext";
import { translations } from "../i18n/translations";

const serviceIcons = {
  sales: (
    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
    </svg>
  ),
  service: (
    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17l-5.1 5.1a2.121 2.121 0 01-3-3l5.1-5.1m0 0L15.17 4.42a2.121 2.121 0 013 3l-7.75 7.75zM14.121 9.879L9.879 14.121" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  lab: (
    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
    </svg>
  ),
};

export default function Services() {
  const t = useT();

  return (
    <section id="services" className="py-32 md:py-48 bg-white relative overflow-hidden">
      {/* Background Decorative Element */}
      <div className="absolute top-0 right-0 w-1/3 h-full bg-[var(--bg-secondary)] -skew-x-12 translate-x-1/2" />

      <div className="section-wrapper relative z-10">
        {/* Section Header */}
        <div className="mb-20 max-w-3xl">
          <span className="inline-block text-[10px] font-bold uppercase tracking-[0.4em] text-[var(--accent)] mb-4">
            {t(translations.services.sectionTag)}
          </span>
          <h2 className="text-4xl md:text-6xl font-serif text-[var(--brand-navy)] mb-8 leading-tight">
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
              className="premium-card p-10 flex flex-col items-start group"
            >
              <div className="w-16 h-16 flex items-center justify-center mb-8 text-[var(--accent)] border border-[var(--accent)]/20 transition-all group-hover:bg-[var(--brand-navy)] group-hover:text-white group-hover:border-[var(--brand-navy)]">
                {serviceIcons[item.icon as keyof typeof serviceIcons]}
              </div>
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
          ))}
        </div>
      </div>
    </section>
  );
}
