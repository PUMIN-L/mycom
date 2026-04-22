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
    <section id="clients" className="py-24 md:py-32 relative overflow-hidden">
      <div className="section-wrapper relative z-10">
        {/* Section Header */}
        <div className="text-center mb-16">
          <span className="inline-block px-4 py-1.5 rounded-full text-xs font-medium border border-[var(--border-color-hover)] text-[var(--accent-light)] bg-[var(--accent)]/10 mb-4">
            {t(translations.clients.sectionTag)}
          </span>
          <h2 className="text-3xl md:text-5xl font-bold text-white mb-4">
            {t(translations.clients.title)}
          </h2>
          <p className="text-[var(--text-secondary)] max-w-2xl mx-auto text-base md:text-lg">
            {t(translations.clients.subtitle)}
          </p>
        </div>
      </div>

      {/* Marquee - row 1 */}
      <div className="relative mb-6">
        <div className="absolute left-0 top-0 bottom-0 w-20 md:w-40 bg-gradient-to-r from-[var(--bg-primary)] to-transparent z-10" />
        <div className="absolute right-0 top-0 bottom-0 w-20 md:w-40 bg-gradient-to-l from-[var(--bg-primary)] to-transparent z-10" />
        <div className="flex animate-marquee">
          {[...clientLogos, ...clientLogos].map((client, i) => (
            <div
              key={i}
              className="flex-shrink-0 mx-4 glass rounded-2xl px-8 py-5 flex items-center justify-center min-w-[160px] card-hover"
            >
              <div className="text-center">
                <div className="text-2xl font-bold gradient-text mb-1">{client.initials}</div>
                <div className="text-xs text-[var(--text-muted)]">{client.name}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Marquee - row 2 (reverse) */}
      <div className="relative">
        <div className="absolute left-0 top-0 bottom-0 w-20 md:w-40 bg-gradient-to-r from-[var(--bg-primary)] to-transparent z-10" />
        <div className="absolute right-0 top-0 bottom-0 w-20 md:w-40 bg-gradient-to-l from-[var(--bg-primary)] to-transparent z-10" />
        <div className="flex animate-marquee" style={{ animationDirection: "reverse", animationDuration: "35s" }}>
          {[...clientLogos.slice(6), ...clientLogos.slice(0, 6), ...clientLogos.slice(6), ...clientLogos.slice(0, 6)].map(
            (client, i) => (
              <div
                key={i}
                className="flex-shrink-0 mx-4 glass rounded-2xl px-8 py-5 flex items-center justify-center min-w-[160px] card-hover"
              >
                <div className="text-center">
                  <div className="text-2xl font-bold gradient-text mb-1">{client.initials}</div>
                  <div className="text-xs text-[var(--text-muted)]">{client.name}</div>
                </div>
              </div>
            )
          )}
        </div>
      </div>
    </section>
  );
}
