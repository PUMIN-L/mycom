"use client";

import { useT } from "../i18n/LanguageContext";
import { translations } from "../i18n/translations";

export default function Footer() {
  const t = useT();

  const quickLinks = [
    { href: "#services", label: t(translations.nav.services) },
    { href: "#products", label: t(translations.nav.products) },
    { href: "#clients", label: t(translations.nav.clients) },
    { href: "#contact", label: t(translations.nav.contact) },
  ];

  return (
    <footer className="border-t border-[var(--border-color)] bg-[var(--bg-secondary)]/50">
      <div className="section-wrapper py-16">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
          {/* Company Info */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center text-white font-bold text-sm"
                style={{ background: "var(--accent-gradient)" }}
              >
                IDK
              </div>
              <span className="text-lg font-bold text-white">
                I Don&apos;t Know Tech
              </span>
            </div>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed mb-6">
              {t(translations.footer.description)}
            </p>
            {/* Social */}
            <div className="flex gap-3">
              <a
                href="https://line.me/ti/p/~puminkmutnb"
                target="_blank"
                rel="noopener noreferrer"
                className="w-10 h-10 rounded-xl flex items-center justify-center transition-all hover:scale-110"
                style={{ background: "#06C755" }}
                aria-label="LINE"
              >
                <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white">
                  <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.282.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314" />
                </svg>
              </a>
              <a
                href="mailto:ampumin@gmail.com"
                className="w-10 h-10 rounded-xl flex items-center justify-center bg-[var(--bg-card)] border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-white hover:border-[var(--border-color-hover)] transition-all hover:scale-110"
                aria-label="Email"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                </svg>
              </a>
            </div>
          </div>

          {/* Quick Links */}
          <div>
            <h4 className="text-base font-semibold text-white mb-4">
              {t(translations.footer.quickLinks)}
            </h4>
            <ul className="space-y-3">
              {quickLinks.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    className="text-sm text-[var(--text-secondary)] hover:text-[var(--accent-light)] transition-colors"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact Info */}
          <div>
            <h4 className="text-base font-semibold text-white mb-4">
              {t(translations.footer.contactInfo)}
            </h4>
            <div className="space-y-3 text-sm text-[var(--text-secondary)]">
              <p>{t(translations.contact.address)}</p>
              <p>{t(translations.contact.phone)}</p>
              <a href="mailto:ampumin@gmail.com" className="block hover:text-[var(--accent-light)] transition-colors">
                ampumin@gmail.com
              </a>
              <p>LINE: @puminkmutnb</p>
            </div>
          </div>
        </div>

        {/* Copyright */}
        <div className="border-t border-[var(--border-color)] mt-12 pt-8 text-center">
          <p className="text-xs text-[var(--text-muted)]">
            {t(translations.footer.copyright)}
          </p>
        </div>
      </div>
    </footer>
  );
}
