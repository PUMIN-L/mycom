import type { Metadata } from "next";
import { OG_IMAGE_ALT, SITE_NAME, SITE_URL } from "./site";

// The site-wide share image, served by app/opengraph-image.tsx.
export const DEFAULT_OG_IMAGE = {
  url: "/opengraph-image",
  width: 1200,
  height: 630,
  alt: OG_IMAGE_ALT,
};

/**
 * Metadata for one public page: title, description, canonical, Open Graph and
 * the Twitter card, all pointing at THIS page.
 *
 * Why every page needs all of it: Next merges metadata SHALLOWLY, so a page
 * that sets no `openGraph` inherits the root layout's — og:url and og:title of
 * the HOME page, which is what LINE and Facebook then show when someone shares
 * /about. And a page that does set `openGraph` replaces the root's whole object,
 * the file-based image (app/opengraph-image.tsx) included — it is only merged
 * at the segment it lives in — so the image is carried explicitly here, along
 * with siteName and locale, which the root layout also sets.
 *
 * `title` is the bare page title: the root layout's template appends
 * " | Profin Lab Scale" to <title>. og:title gets the same suffix by hand (the
 * template does not reach it).
 */
export function pageMetadata({
  title,
  description,
  path,
  image,
  type = "website",
}: {
  title: string;
  description: string;
  /** Site-relative path, e.g. "/about". */
  path: string;
  /** Absolute image URL for this page; the site-wide image when absent. */
  image?: string;
  type?: "website" | "article";
}): Metadata {
  const fullTitle = `${title} | ${SITE_NAME}`;
  const images = [image ? { url: image } : DEFAULT_OG_IMAGE];
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type,
      siteName: SITE_NAME,
      locale: "th_TH",
      url: `${SITE_URL}${path}`,
      title: fullTitle,
      description,
      images,
    },
    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description,
      images,
    },
  };
}
