"use client";

import Image from "next/image";
import { useT } from "../i18n/LanguageContext";
import { translations } from "../i18n/translations";

export default function AboutSection() {
  const t = useT();

  return (
    <div className="pt-32 pb-24">
      <div className="section-wrapper">
        {/* Header */}
        <div className="max-w-5xl mb-20 animate-fade-in-up">
          <span className="text-[var(--accent)] font-bold uppercase tracking-[0.4em] text-xs mb-8 block">
            {t(translations.aboutPage.tag)}
          </span>
          <h1 className="text-4xl md:text-6xl font-bold text-[var(--brand-navy)] mb-8 leading-[1.2]">
            {t(translations.aboutPage.title)}
          </h1>
          <p className="text-lg md:text-xl text-gray-600 leading-relaxed font-normal max-w-3xl">
            {t(translations.aboutPage.description)}
          </p>
        </div>

        {/* Hero Image */}
        <div className="relative aspect-[21/9] w-full overflow-hidden mb-24 rounded-2xl shadow-2xl animate-fade-in delay-200">
          <Image
            src="/images/about-hero.png"
            alt="Modern Laboratory"
            fill
            className="object-cover"
            priority
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
        </div>

        {/* Content Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-20 items-start">
          <div className="space-y-8 animate-slide-in-left delay-300">
            <h2 className="text-2xl md:text-3xl font-bold text-[var(--brand-navy)]">
              {t(translations.aboutPage.visionTitle)}
            </h2>
            <p className="text-gray-600 leading-relaxed font-normal">
              {t(translations.aboutPage.visionDesc)}
            </p>
            <div className="pt-8 grid grid-cols-2 gap-8">
              <div>
                <span className="text-3xl md:text-4xl font-bold text-[var(--accent)] block mb-2">10+</span>
                <span className="text-[10px] uppercase tracking-widest text-gray-400 font-bold">
                  {t(translations.aboutPage.expYears)}
                </span>
              </div>
              <div>
                <span className="text-3xl md:text-4xl font-bold text-[var(--accent)] block mb-2">500+</span>
                <span className="text-[10px] uppercase tracking-widest text-gray-400 font-bold">
                  {t(translations.aboutPage.projectsDone)}
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-8 animate-fade-in delay-500">
            <h2 className="text-2xl md:text-3xl font-bold text-[var(--brand-navy)]">
              {t(translations.aboutPage.valuesTitle)}
            </h2>
            <ul className="space-y-6">
              <li className="flex gap-4">
                <div className="w-8 h-8 rounded-full bg-[var(--accent)]/10 flex items-center justify-center flex-shrink-0 text-[var(--accent)] font-bold">1</div>
                <div>
                  <h4 className="font-bold text-[var(--brand-navy)] mb-1 uppercase tracking-wider text-sm">
                    {t(translations.aboutPage.value1Title)}
                  </h4>
                  <p className="text-gray-500 text-sm">
                    {t(translations.aboutPage.value1Desc)}
                  </p>
                </div>
              </li>
              <li className="flex gap-4">
                <div className="w-8 h-8 rounded-full bg-[var(--accent)]/10 flex items-center justify-center flex-shrink-0 text-[var(--accent)] font-bold">2</div>
                <div>
                  <h4 className="font-bold text-[var(--brand-navy)] mb-1 uppercase tracking-wider text-sm">
                    {t(translations.aboutPage.value2Title)}
                  </h4>
                  <p className="text-gray-500 text-sm">
                    {t(translations.aboutPage.value2Desc)}
                  </p>
                </div>
              </li>
              <li className="flex gap-4">
                <div className="w-8 h-8 rounded-full bg-[var(--accent)]/10 flex items-center justify-center flex-shrink-0 text-[var(--accent)] font-bold">3</div>
                <div>
                  <h4 className="font-bold text-[var(--brand-navy)] mb-1 uppercase tracking-wider text-sm">
                    {t(translations.aboutPage.value3Title)}
                  </h4>
                  <p className="text-gray-500 text-sm">
                    {t(translations.aboutPage.value3Desc)}
                  </p>
                </div>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
