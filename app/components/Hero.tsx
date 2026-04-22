"use client";

import { useT } from "../i18n/LanguageContext";
import { translations } from "../i18n/translations";
import Image from "next/image";

export default function Hero() {
  const t = useT();

  return (
    <section
      id="hero"
      className="relative min-h-screen flex items-center justify-center overflow-hidden"
    >
      {/* Background Image */}
      <div className="absolute inset-0 z-0">
        <Image
          src="/images/hero-bg.png"
          alt="Background"
          fill
          className="object-cover"
          priority
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[var(--bg-primary)]/60 via-[var(--bg-primary)]/40 to-[var(--bg-primary)]" />
      </div>

      {/* Animated particles */}
      <div className="absolute inset-0 z-0 overflow-hidden">
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className="absolute rounded-full animate-float"
            style={{
              width: `${4 + i * 2}px`,
              height: `${4 + i * 2}px`,
              background: "var(--accent)",
              opacity: 0.2 + i * 0.05,
              left: `${15 + i * 15}%`,
              top: `${20 + i * 10}%`,
              animationDelay: `${i * 0.8}s`,
              animationDuration: `${4 + i}s`,
            }}
          />
        ))}
      </div>

      {/* Content */}
      <div className="relative z-10 section-wrapper text-center py-32 md:py-40">
        {/* Tagline */}
        <div className="animate-fade-in-up opacity-0 delay-100">
          <span className="inline-block px-4 py-1.5 rounded-full text-xs md:text-sm font-medium border border-[var(--border-color-hover)] text-[var(--accent-light)] bg-[var(--accent)]/10 mb-6">
            {t(translations.hero.tagline)}
          </span>
        </div>

        {/* Title */}
        <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold leading-tight mb-6 animate-fade-in-up opacity-0 delay-200">
          {t(translations.hero.title).split("\n").map((line, i) => (
            <span key={i}>
              {i === 0 ? (
                <span className="gradient-text animate-gradient">{line}</span>
              ) : (
                <span className="text-white">{line}</span>
              )}
              {i === 0 && <br />}
            </span>
          ))}
        </h1>

        {/* Subtitle */}
        <p className="text-base md:text-lg text-[var(--text-secondary)] max-w-2xl mx-auto mb-10 animate-fade-in-up opacity-0 delay-300 leading-relaxed">
          {t(translations.hero.subtitle)}
        </p>

        {/* CTA */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 animate-fade-in-up opacity-0 delay-400">
          <a
            href="/contact"
            className="px-8 py-3.5 rounded-full text-base font-semibold text-white transition-all hover:scale-105 hover:shadow-lg hover:shadow-[var(--accent)]/25"
            style={{ background: "var(--accent-gradient)" }}
          >
            {t(translations.hero.cta)}
          </a>
          <a
            href="https://line.me/ti/p/~puminkmutnb"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-8 py-3.5 rounded-full text-base font-semibold text-white transition-all hover:scale-105"
            style={{ background: "#06C755" }}
          >
            <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white">
              <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.282.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314" />
            </svg>
            {t(translations.hero.ctaLine)}
          </a>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mt-16 md:mt-20 animate-fade-in-up opacity-0 delay-500">
          {[
            { value: "15+", label: { th: "ปีประสบการณ์", en: "Years Experience", zh: "年经验" } },
            { value: "500+", label: { th: "ลูกค้า", en: "Clients", zh: "客户" } },
            { value: "1000+", label: { th: "เครื่องที่ติดตั้ง", en: "Installations", zh: "安装设备" } },
            { value: "24/7", label: { th: "บริการหลังขาย", en: "After Sales", zh: "售后服务" } },
          ].map((stat, i) => (
            <div
              key={i}
              className="glass rounded-2xl p-5 text-center card-hover"
            >
              <div className="text-2xl md:text-3xl font-bold gradient-text mb-1">
                {stat.value}
              </div>
              <div className="text-xs md:text-sm text-[var(--text-secondary)]">
                {t(stat.label)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
