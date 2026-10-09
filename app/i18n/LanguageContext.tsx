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

const STORAGE_KEY = "idkt-lang";

/** The language this visitor picked with the switcher, if any. */
function savedLanguage(): Language | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === "th" || saved === "en" || saved === "zh" ? saved : null;
  } catch {
    return null; // storage blocked (private mode, site data off): no choice saved
  }
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  // Start at "th" so the server-rendered HTML matches the first client render
  // (no hydration mismatch). After mount we sync to the language the visitor
  // PICKED, if any.
  //
  // Thai until someone picks otherwise — never guessed from the browser's
  // language. Googlebot renders pages as an en-US browser, so guessing turned
  // every page it indexed English after hydration, under a Thai <html lang>,
  // Thai title and Thai description: the site was indexed for the wrong
  // language. A visitor reading another language picks it once; it is saved.
  //
  // We intentionally DO NOT gate rendering on a `mounted` flag. The previous
  // `visibility:hidden` wrapper hid the entire page until hydration finished,
  // which delayed Largest Contentful Paint badly on mobile (LCP ~4.1s). The
  // hero image and layout are language-agnostic, so the only visible effect of
  // syncing after mount is a brief text swap for non-Thai returning visitors —
  // a far better trade-off than blocking first paint for everyone.
  const [lang, setLang] = useState<Language>("th");

  useEffect(() => {
    const saved = savedLanguage();
    if (saved) setLang(saved);
  }, []);

  const handleSetLang = (newLang: Language) => {
    setLang(newLang);
    try {
      localStorage.setItem(STORAGE_KEY, newLang);
    } catch {
      // Storage blocked: the choice holds for this page view only.
    }
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
