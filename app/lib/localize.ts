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
  const th = (r[`${field}_th`] as string) || "";
  const en = (r[`${field}_en`] as string) || "";
  const zh = (r[`${field}_zh`] as string) || "";
  if (lang === "zh") return zh || en || th;
  if (lang === "en") return en || th;
  return th || en || zh;
}
