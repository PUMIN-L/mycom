// The <image:image> entries of one sitemap URL — the pictures that page shows,
// so Google Images can find them (product photos are searched by model name).
// Pure — app/sitemap.ts feeds it.

/** Google reads at most 1,000 images per URL. */
export const MAX_SITEMAP_IMAGES_PER_URL = 1000;

/**
 * The image URLs worth listing, de-duplicated, or undefined when none are —
 * an entry without pictures carries no `images` key at all.
 *
 * Only absolute http(s) URLs. And none containing & < > " ' : Next writes
 * <image:loc> into the XML without escaping it, so one such character would
 * make the WHOLE sitemap unreadable to Google. Cloudinary URLs never carry
 * them; a pasted URL that does is left out rather than escaped, so a Next
 * that starts escaping cannot double it.
 */
export function sitemapImages(urls: Iterable<unknown>): string[] | undefined {
  const out = new Set<string>();
  for (const raw of urls) {
    if (out.size >= MAX_SITEMAP_IMAGES_PER_URL) break;
    if (typeof raw !== "string" || raw.trim() === "") continue;
    let href: string;
    try {
      const url = new URL(raw.trim());
      if (url.protocol !== "https:" && url.protocol !== "http:") continue;
      href = url.href;
    } catch {
      continue;
    }
    if (/[&<>"']/.test(href)) continue;
    out.add(href);
  }
  return out.size > 0 ? [...out] : undefined;
}
