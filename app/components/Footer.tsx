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
    <footer className="bg-[var(--brand-navy)] text-white pt-24 pb-12">
      <div className="section-wrapper">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-16 mb-20">
          {/* Brand Column */}
          <div className="md:col-span-1">
            <div className="flex items-center gap-3 mb-8">
              <div className="w-12 h-12 flex items-center justify-center bg-[var(--accent)] text-white font-serif italic font-bold text-2xl">
                IDK
              </div>
              <div className="flex flex-col">
                <span className="text-xl font-serif font-bold tracking-tight">
                  I Don&apos;t Know Tech
                </span>
                {/* <span className="text-[10px] uppercase tracking-[0.3em] text-[var(--accent)]">
                  Premium Lab Solutions
                </span> */}
                <span className="text-[10px] uppercase tracking-[0.3em] text-[var(--accent)]">
                  Premium Trsting Equipments
                </span>
              </div>
            </div>
            <p className="text-white/60 text-sm leading-relaxed font-light">
              {t(translations.footer.description)}
            </p>
          </div>

          {/* Navigation Column */}
          <div>
            <h4 className="text-[10px] font-bold uppercase tracking-[0.4em] text-[var(--accent)] mb-8">
              {t(translations.footer.quickLinks)}
            </h4>
            <ul className="space-y-4">
              {quickLinks.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    className="text-white/70 hover:text-white transition-all text-sm font-light flex items-center group"
                  >
                    <span className="w-0 h-[1px] bg-[var(--accent)] transition-all group-hover:w-4 group-hover:mr-3" />
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact Column */}
          <div>
            <h4 className="text-[10px] font-bold uppercase tracking-[0.4em] text-[var(--accent)] mb-8">
              {t(translations.footer.contactInfo)}
            </h4>
            <div className="space-y-6 text-white/70 text-sm font-light">
              <p className="leading-relaxed">{t(translations.contact.address)}</p>
              <div className="space-y-2">
                <p className="flex items-center gap-3">
                  <span className="text-[var(--accent)]">P:</span> {t(translations.contact.phone)}
                </p>
                <p className="flex items-center gap-3">
                  <span className="text-[var(--accent)]">E:</span> ampumin@gmail.com
                </p>
                <p className="flex items-center gap-3">
                  <span className="text-[var(--accent)]">L:</span> @puminkmutnb
                </p>
              </div>
            </div>
          </div>

          {/* Social/CTA Column */}
          <div>
            <h4 className="text-[10px] font-bold uppercase tracking-[0.4em] text-[var(--accent)] mb-8">
              Connect
            </h4>
            <div className="flex gap-4">
              <a
                href="https://line.me/ti/p/~puminkmutnb"
                target="_blank"
                rel="noopener noreferrer"
                className="w-12 h-12 border border-white/20 flex items-center justify-center hover:bg-white hover:text-[var(--brand-navy)] transition-all"
                aria-label="LINE"
              >
                <svg viewBox="0 0 24 24" className="w-6 h-6 fill-current">
                  <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.282.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314" />
                </svg>
              </a>
              <a
                href="mailto:ampumin@gmail.com"
                className="w-12 h-12 border border-white/20 flex items-center justify-center hover:bg-white hover:text-[var(--brand-navy)] transition-all"
                aria-label="Email"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                </svg>
              </a>
            </div>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="pt-8 border-t border-white/10 flex flex-col md:row items-center justify-between gap-4">
          <p className="text-[10px] text-white/40 uppercase tracking-widest">
            {t(translations.footer.copyright)}
          </p>
          <div className="flex gap-8">
            <a href="#" className="text-[10px] text-white/40 uppercase tracking-widest hover:text-white transition-colors">Privacy Policy</a>
            <a href="#" className="text-[10px] text-white/40 uppercase tracking-widest hover:text-white transition-colors">Terms of Service</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
