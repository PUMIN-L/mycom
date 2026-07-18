import type { Language } from "../i18n/translations";

/**
 * Pick a localized field off a DB record with graceful fallback.
 *
 * DB rows store one column per language (e.g. `title_th`, `title_en`,
 * `title_zh`). Pass the base field name and the active language:
 *
 *   localize(product, "title", lang)   // -> title in the right language
 *   localize(category, "name", lang)
 *
 * Fallback order: requested language → English → Thai (and Thai → en → zh for
 * the Thai case), so a missing translation never renders blank.
 */
export function localize(record: object, field: string, lang: Language): string {
  // `record` is a typed row (ProductData, ProductCategory, …) — cast once so we
  // can read the dynamic `${field}_${lang}` columns without an index signature.
  const r = record as Record<string, unknown>;
  // Falsy values (missing column, null, "", 0, false) become "" so they fall
  // back to the next language. A truthy value is stringified — text columns are
  // always strings, but String() guarantees the `: string` return type instead
  // of leaking a number/boolean through the cast.
  const pick = (l: string): string => {
    const v = r[`${field}_${l}`];
    return v ? String(v) : "";
  };
  const th = pick("th");
  const en = pick("en");
  const zh = pick("zh");
  if (lang === "zh") return zh || en || th;
  if (lang === "en") return en || th;
  return th || en || zh;
}
