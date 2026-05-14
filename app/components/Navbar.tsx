"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { useLanguage, useT } from "../i18n/LanguageContext";
import { translations, type Language } from "../i18n/translations";

const langLabels: Record<Language, string> = {
  th: "🇹🇭 TH",
  en: "🇬🇧 EN",
  zh: "🇨🇳 CN",
};

export default function Navbar() {
  const { lang, setLang } = useLanguage();
  const t = useT();
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [langDropdown, setLangDropdown] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const navLinks = [
    { href: "/#services", label: t(translations.nav.services) },
    { href: "/#products", label: t(translations.nav.products) },
    { href: "/#clients", label: t(translations.nav.clients) },
    { href: "/contact", label: t(translations.nav.contact) },
  ];

  return (
    <nav
      id="navbar"
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 border-b ${scrolled
        ? "bg-white/90 backdrop-blur-md shadow-sm border-gray-100"
        : "bg-transparent border-transparent"
        }`}
    >
      <div className="px-6 md:px-10 flex items-center justify-between h-20 md:h-24">
        {/* Logo */}
        <a href="#" className="flex items-center  group">
          <div className="relative w-8 h-18 transition-transform group-hover:scale-110">
            <Image
              src="/images/profin-logo-3.png"
              alt="Profin Logo"
              fill
              sizes="40px"
              className="object-contain"
            />
          </div>
          <div className="flex flex-col">
            <span className={`text-lg font-sans font-bold tracking-tight transition-colors ${scrolled ? "text-black" : "text-white group-hover:text-[var(--accent)]"}`}>
              PROFIN LAB SCALE
            </span>
            <span className={`text-[10px] tracking-[-0.015em] ml-[1px] mt-[-2px] uppercase transition-colors ${scrolled ? "text-gray-500" : "text-white/60"}`}>
              Premium Testing Equipments
            </span>
          </div>
        </a>

        {/* Desktop Nav */}
        <div className="hidden md:flex items-center gap-10">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className={`text-[18px] font-bold font-thai uppercase transition-all relative group
                ${scrolled ? "text-gray-800" : "text-white hover:text-[var(--accent)]"}`}
            >
              {link.label}
              <span className="absolute bottom-[-8px] left-1/2 w-0 h-[1px] bg-[var(--accent)] transition-all duration-300 -translate-x-1/2 group-hover:w-full" />
            </a>
          ))}

          {/* Language Switcher */}
          <div className="relative">
            <button
              onMouseEnter={() => setLangDropdown(true)}
              onClick={() => setLangDropdown(!langDropdown)}
              className={`flex items-center gap-2 px-4 py-2 text-[15px] font-bold uppercase tracking-widest transition-all
                ${scrolled
                  ? "text-gray-800 border-gray-200 hover:border-[var(--accent)]"
                  : "text-white border-white/20 hover:border-white"}`}
            >
              {langLabels[lang]}
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {langDropdown && (
              <div
                onMouseLeave={() => setLangDropdown(false)}
                className="absolute right-0 mt-0 w-32 bg-white shadow-2xl border border-gray-100 animate-fade-in rounded"
              >
                {(["th", "en", "zh"] as Language[]).map((l) => (
                  <button
                    key={l}
                    onClick={() => { setLang(l); setLangDropdown(false); }}
                    className={`w-full px-5 py-3 text-left text-[15px] font-bold uppercase tracking-widest hover:bg-gray-200 cursor-pointer transition-colors ${lang === l ? "text-[var(--accent)]" : "text-gray-600"
                      }`}
                  >
                    {langLabels[l]}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Contact Button */}
          {/* <a
            href="https://line.me/ti/p/~puminkmutnb"
            target="_blank"
            rel="noopener noreferrer"
            className={`px-8 py-3 text-[10px] font-bold uppercase tracking-widest transition-all
              ${scrolled
                ? "bg-[var(--brand-navy)] text-white hover:bg-[var(--accent)]"
                : "bg-green-500 text-white hover:bg-[var(--accent)] hover:text-white"}`}
          >
            Line Us
          </a> */}
        </div>

        {/* Mobile Toggle */}
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className={`md:hidden p-2 transition-colors ${scrolled ? "text-navy" : "text-white"}`}
          aria-label="Toggle menu"
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            {mobileOpen ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>
      </div>

      {/* Mobile Menu */}
      {mobileOpen && (
        <div className="md:hidden bg-white border-t border-gray-100 animate-fade-in h-screen">
          <div className="section-wrapper py-10 flex flex-col gap-8">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className="text-2xl font-serif text-navy hover:text-[var(--accent)] transition-colors"
              >
                {link.label}
              </a>
            ))}
            <div className="flex flex-col gap-4 pt-10 border-t border-gray-100">
              <span className="text-[10px] uppercase tracking-widest text-gray-400">Select Language</span>
              <div className="flex gap-4">
                {(["th", "en", "zh"] as Language[]).map((l) => (
                  <button
                    key={l}
                    onClick={() => { setLang(l); setMobileOpen(false); }}
                    className={`px-4 py-2 text-[10px] font-bold uppercase tracking-widest border transition-all ${lang === l
                      ? "bg-[var(--accent)] text-white border-[var(--accent)]"
                      : "text-gray-600 border-gray-200"
                      }`}
                  >
                    {langLabels[l]}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
