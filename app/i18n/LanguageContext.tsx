"use client";

import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { type Language } from "./translations";

interface LanguageContextType {
  lang: Language;
  setLang: (lang: Language) => void;
}

const LanguageContext = createContext<LanguageContextType>({
  lang: "th",
  setLang: () => {},
});

function detectBrowserLanguage(): Language {
  if (typeof window === "undefined") return "th";
  const browserLang = navigator.language || (navigator as unknown as { userLanguage?: string }).userLanguage || "th";
  const code = browserLang.toLowerCase().slice(0, 2);
  if (code === "th") return "th";
  if (code === "zh") return "zh";
  return "en";
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Language>("th");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("idkt-lang") as Language | null;
    if (saved && ["th", "en", "zh"].includes(saved)) {
      setLang(saved);
    } else {
      setLang(detectBrowserLanguage());
    }
    setMounted(true);
  }, []);

  const handleSetLang = (newLang: Language) => {
    setLang(newLang);
    localStorage.setItem("idkt-lang", newLang);
  };

  if (!mounted) {
    return <div style={{ visibility: "hidden" }}>{children}</div>;
  }

  return (
    <LanguageContext.Provider value={{ lang, setLang: handleSetLang }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}

export function useT() {
  const { lang } = useLanguage();
  return (obj: Record<Language, string>) => obj[lang];
}
