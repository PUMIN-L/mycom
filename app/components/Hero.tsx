"use client";

import { useT } from "../i18n/LanguageContext";
import { translations } from "../i18n/translations";
import Image from "next/image";

export default function Hero() {
  const t = useT();

  return (
    <section
      id="hero"
      className="relative min-h-screen flex items-center justify-start overflow-hidden bg-white "
    >
      {/* Background with Overlay */}
      <div className="absolute inset-0 z-0">
        <Image
          src="https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?auto=format&fit=crop&q=80&w=2070"
          alt="Luxury Laboratory"
          fill
          sizes="100vw"
          className="object-cover"
          priority
        />
        <div className="absolute inset-0 bg-black/40" />
        <div className="absolute inset-0 " />
      </div>

      {/* Content */}
      <div className="relative z-10 mt-40 px-6 md:px-10">
        <div className=" border-white/20 pt-40 pb-6 md:pt-80 md:pb-10 px-0">
          {/* Tagline */}
          {/* <div className="animate-fade-in-up opacity-0 delay-100">
            <span className="inline-block px-6 py-2 rounded-full text-xs md:text-sm font-semibold tracking-widest uppercase border border-white/30 text-white bg-white/10 backdrop-blur-md mb-8">
              {t(translations.hero.tagline)}
            </span>
          </div> */}

          {/* Title */}
          <h1 className="text-lg md:text-2xl font-medium leading-tight mb-2 animate-fade-in-up opacity-0 delay-200 text-white drop-shadow-2xl">
            {t(translations.hero.title).split("\n").map((line, i) => (
              <span key={i} className="block text-left">
                {line}
              </span>
            ))}
          </h1>

          {/* Subtitle */}
          <p className="text-sm md:text-base text-white/90 max-w-3xl mb-6 animate-fade-in-up opacity-0 delay-300 leading-relaxed font-light text-left">
            {t(translations.hero.subtitle).split("\n").map((line, i) => (
              <span key={i} className="block">
                {line}
              </span>
            ))}
          </p>

          {/* CTA */}
          <div className="flex flex-col sm:flex-row items-center justify-start gap-6 animate-fade-in-up opacity-0 delay-400">
            {/* <a
            href="/contact"
            className="group relative px-10 py-4 overflow-hidden bg-white text-[var(--accent)] font-bold transition-all hover:text-white"
          >
            <span className="relative z-10">{t(translations.hero.cta)}</span>
            <div className="absolute inset-0 bg-[var(--accent)] transition-transform duration-500 -translate-x-full group-hover:translate-x-0" />
          </a> */}
            <a
              href="/contact"
              className="px-8 py-3 border-2 border-white text-white font-bold transition-all hover:bg-white hover:text-black"
            >
              {t(translations.hero.cta)}
            </a>
            <a
              href="https://line.me/ti/p/~puminkmutnb"
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center gap-3 px-8 py-3 border-2 border-white text-white font-bold transition-all hover:bg-white hover:text-black"
            >
              <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current transition-colors group-hover:text-[#06C755]">
                <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.282.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314" />
              </svg>
              {t(translations.hero.ctaLine)}
            </a>
          </div>

          {/* Stats */}
          {/* <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mt-24 md:mt-32 animate-fade-in-up opacity-0 delay-500">
          {[
            { value: "15+", label: { th: "ปีประสบการณ์", en: "Years Experience", zh: "年经验" } },
            { value: "500+", label: { th: "ลูกค้า", en: "Clients", zh: "客户" } },
            { value: "1000+", label: { th: "เครื่องที่ติดตั้ง", en: "Installations", zh: "安装设备" } },
            { value: "24/7", label: { th: "บริการหลังขาย", en: "After Sales", zh: "售后服务" } },
          ].map((stat, i) => (
            <div
              key={i}
              className="text-center group"
            >
              <div className="text-3xl md:text-4xl font-serif text-white mb-2 group-hover:text-[var(--accent)] transition-colors duration-300">
                {stat.value}
              </div>
              <div className="text-xs md:text-sm text-white/70 uppercase tracking-[0.2em]">
                {t(stat.label)}
              </div>
            </div>
          ))}
        </div> */}
        </div>
      </div>
    </section>
  );
}
