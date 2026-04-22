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
    <section id="services" className="py-24 md:py-32 relative">
      {/* Subtle background gradient */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[var(--accent)]/[0.02] to-transparent" />

      <div className="section-wrapper relative z-10">
        {/* Section Header */}
        <div className="text-center mb-16">
          <span className="inline-block px-4 py-1.5 rounded-full text-xs font-medium border border-[var(--border-color-hover)] text-[var(--accent-light)] bg-[var(--accent)]/10 mb-4">
            {t(translations.services.sectionTag)}
          </span>
          <h2 className="text-3xl md:text-5xl font-bold text-white mb-4">
            {t(translations.services.title)}
          </h2>
          <p className="text-[var(--text-secondary)] max-w-2xl mx-auto text-base md:text-lg">
            {t(translations.services.subtitle)}
          </p>
        </div>

        {/* Service Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {translations.services.items.map((item, i) => (
            <div
              key={i}
              className="glass rounded-2xl p-8 card-hover group"
            >
              <div className="w-14 h-14 rounded-xl flex items-center justify-center mb-6 text-[var(--accent-light)] bg-[var(--accent)]/10 group-hover:bg-[var(--accent)]/20 transition-colors">
                {serviceIcons[item.icon as keyof typeof serviceIcons]}
              </div>
              <h3 className="text-xl font-bold text-white mb-3">
                {t(item.title)}
              </h3>
              <p className="text-[var(--text-secondary)] leading-relaxed text-sm">
                {t(item.desc)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
