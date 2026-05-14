"use client";

import { useT } from "../i18n/LanguageContext";
import { translations } from "../i18n/translations";

const clientLogos = [
  { name: "SCG", initials: "SCG" },
  { name: "PTT", initials: "PTT" },
  { name: "CP Group", initials: "CP" },
  { name: "Thai Union", initials: "TU" },
  { name: "Siam Cement", initials: "SC" },
  { name: "BerliJucker", initials: "BJ" },
  { name: "Indorama", initials: "IR" },
  { name: "IRPC", initials: "IRPC" },
  { name: "TPI Polene", initials: "TPI" },
  { name: "Double A", initials: "DA" },
  { name: "Mitr Phol", initials: "MP" },
  { name: "Thai Beverage", initials: "TB" },
];

export default function Clients() {
  const t = useT();

  return (
    <section id="clients" className="py-32 md:py-48 bg-white relative overflow-hidden">
      <div className="section-wrapper relative z-10">
        {/* Section Header */}
        <div className="text-center mb-24">
          {/* <span className="inline-block text-[10px] font-bold uppercase tracking-[0.4em] text-[var(--accent)] mb-4">
            {t(translations.clients.sectionTag)}
          </span> */}
          <h2 className="text-4xl md:text-6xl font-serif text-[var(--accent)] mb-6">
            {t(translations.clients.title)}
          </h2>
          <div className="w-20 h-[1px] bg-[var(--accent)] mx-auto mb-8" />
          <p className="text-[var(--text-secondary)] max-w-2xl mx-auto text-lg md:text-xl font-light">
            {t(translations.clients.subtitle)}
          </p>
        </div>
      </div>

      {/* Marquee - row 1 */}
      <div className="relative mb-8">
        <div className="absolute left-0 top-0 bottom-0 w-20 md:w-60 bg-gradient-to-r from-white to-transparent z-10" />
        <div className="absolute right-0 top-0 bottom-0 w-20 md:w-60 bg-gradient-to-l from-white to-transparent z-10" />
        <div className="flex animate-marquee">
          {[...clientLogos, ...clientLogos].map((client, i) => (
            <div
              key={i}
              className="flex-shrink-0 mx-6 bg-[var(--bg-secondary)] border border-gray-100 px-10 py-8 flex items-center justify-center min-w-[200px] grayscale transition-all hover:grayscale-0"
            >
              <div className="text-center">
                <div className="text-2xl font-serif font-bold text-[var(--brand-navy)] mb-1">{client.initials}</div>
                <div className="text-[10px] uppercase tracking-widest text-gray-400 font-bold">{client.name}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Marquee - row 2 (reverse) */}
      <div className="relative">
        <div className="absolute left-0 top-0 bottom-0 w-20 md:w-60 bg-gradient-to-r from-white to-transparent z-10" />
        <div className="absolute right-0 top-0 bottom-0 w-20 md:w-60 bg-gradient-to-l from-white to-transparent z-10" />
        <div className="flex animate-marquee" style={{ animationDirection: "reverse", animationDuration: "45s" }}>
          {[...clientLogos.slice(6), ...clientLogos.slice(0, 6), ...clientLogos.slice(6), ...clientLogos.slice(0, 6)].map(
            (client, i) => (
              <div
                key={i}
                className="flex-shrink-0 mx-6 bg-[var(--bg-secondary)] border border-gray-100 px-10 py-8 flex items-center justify-center min-w-[200px] grayscale transition-all hover:grayscale-0"
              >
                <div className="text-center">
                  <div className="text-2xl font-serif font-bold text-[var(--brand-navy)] mb-1">{client.initials}</div>
                  <div className="text-[10px] uppercase tracking-widest text-gray-400 font-bold">{client.name}</div>
                </div>
              </div>
            )
          )}
        </div>
      </div>
    </section>
  );
}
