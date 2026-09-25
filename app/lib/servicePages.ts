// The service pages: /services/{slug}, one per service card on the home
// page. Pure — the text lives in translations.ts (servicePages.pages, keyed
// by these slugs); this is only which pages exist and their pictures.

export const SERVICE_PAGES = [
  { slug: "equipment-sales", icon: "sales", image: "/images/service-sales.png" },
  { slug: "calibration-repair", icon: "service", image: "/images/service-calibration-new.png" },
  { slug: "lab-design-construction", icon: "lab", image: "/images/service-lab.png" },
] as const;

export type ServiceSlug = (typeof SERVICE_PAGES)[number]["slug"];
export type ServicePage = (typeof SERVICE_PAGES)[number];

export function servicePath(slug: ServiceSlug): string {
  return `/services/${slug}`;
}

export function serviceBySlug(slug: string): ServicePage | undefined {
  return SERVICE_PAGES.find((s) => s.slug === slug);
}

/** The page for a home-page service card, which is keyed by its icon. */
export function serviceByIcon(icon: string): ServicePage | undefined {
  return SERVICE_PAGES.find((s) => s.icon === icon);
}
