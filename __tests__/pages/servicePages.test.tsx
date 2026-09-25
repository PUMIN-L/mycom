/**
 * /services/[slug] — one page per home-page service, so searches for the
 * service itself ("สอบเทียบเครื่องมือวัด", "สร้างห้องแลป") have a page.
 */
import { describe, it, expect, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";
import { Children } from "react";

class NotFound extends Error {}
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFound();
  },
}));
vi.mock("@/app/lib/companyInfo", () => ({ getCompanyInfo: vi.fn(async () => ({ email: "", phone: "", address: "" })) }));
vi.mock("@/app/lib/settingsStore", () => ({ isMaintenanceMode: vi.fn(async () => false) }));
vi.mock("@/app/components/ServicePageView", () => ({ default: () => null }));
vi.mock("@/app/components/Navbar", () => ({ default: () => null }));
vi.mock("@/app/components/Footer", () => ({ default: () => null }));

import ServicePage, { generateMetadata, generateStaticParams, dynamicParams } from "@/app/services/[slug]/page";
import { SERVICE_PAGES } from "@/app/lib/servicePages";
import { translations } from "@/app/i18n/translations";
import { SITE_URL } from "@/app/lib/site";

const params = (slug: string) => ({ params: Promise.resolve({ slug }) });

describe("/services/[slug]", () => {
  it("builds exactly the service pages, and nothing else", () => {
    expect(generateStaticParams()).toEqual(SERVICE_PAGES.map((s) => ({ slug: s.slug })));
    expect(dynamicParams).toBe(false);
  });

  it.each(SERVICE_PAGES.map((s) => [s.slug]))("%s has its own title, canonical and image", async (slug) => {
    const metadata = await generateMetadata(params(slug));
    const copy = translations.servicePages.pages[slug as (typeof SERVICE_PAGES)[number]["slug"]];
    expect(metadata.title).toBe(copy.title.th);
    expect(metadata.description).toBe(copy.metaDescription.th);
    expect(metadata.alternates).toEqual({ canonical: `/services/${slug}` });
    expect(metadata.openGraph).toMatchObject({ url: `${SITE_URL}/services/${slug}` });
  });

  it("describes the service in structured data, provided by the organisation", async () => {
    const jsx = (await ServicePage(params("calibration-repair"))) as ReactElement<{ children: ReactNode }>;
    const scripts = (Children.toArray(jsx.props.children) as ReactElement<{ dangerouslySetInnerHTML?: { __html: string } }>[])
      .filter((c) => c.type === "script")
      .map((c) => JSON.parse(c.props.dangerouslySetInnerHTML!.__html));
    const service = scripts.find((j) => j["@type"] === "Service");
    expect(service).toMatchObject({
      name: "ซ่อมบำรุงและสอบเทียบเครื่องมือวัด",
      url: `${SITE_URL}/services/calibration-repair`,
      provider: { "@id": `${SITE_URL}/#organization` },
    });
    expect(scripts.find((j) => j["@type"] === "BreadcrumbList")).toBeDefined();
  });

  it("404s for anything else", async () => {
    await expect(ServicePage(params("nope"))).rejects.toBeInstanceOf(NotFound);
  });
});
