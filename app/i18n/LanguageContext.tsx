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
  // Start at "th" so the server-rendered HTML matches the first client render
  // (no hydration mismatch). After mount we sync to the saved/detected language.
  //
  // We intentionally DO NOT gate rendering on a `mounted` flag. The previous
  // `visibility:hidden` wrapper hid the entire page until hydration finished,
  // which delayed Largest Contentful Paint badly on mobile (LCP ~4.1s). The
  // hero image and layout are language-agnostic, so the only visible effect of
  // syncing after mount is a brief text swap for non-Thai returning visitors —
  // a far better trade-off than blocking first paint for everyone.
  const [lang, setLang] = useState<Language>("th");

  useEffect(() => {
    const saved = localStorage.getItem("idkt-lang") as Language | null;
    if (saved && ["th", "en", "zh"].includes(saved)) {
      setLang(saved);
    } else {
      setLang(detectBrowserLanguage());
    }
  }, []);

  const handleSetLang = (newLang: Language) => {
    setLang(newLang);
    localStorage.setItem("idkt-lang", newLang);
  };

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
  return (obj: Record<Language, string> | undefined) => {
    if (!obj) return "";
    if (lang === "zh") return obj.zh || obj.en || obj.th;
    if (lang === "en") return obj.en || obj.th;
    return obj.th || obj.en || obj.zh;
  };
}
