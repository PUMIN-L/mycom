import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Navbar from "../../components/Navbar";
import Footer from "../../components/Footer";
import ServicePageView from "../../components/ServicePageView";
import { getCompanyInfo } from "../../lib/companyInfo";
import { isMaintenanceMode } from "../../lib/settingsStore";
import { pageMetadata } from "../../lib/pageMetadata";
import { SERVICE_PAGES, serviceBySlug, servicePath } from "../../lib/servicePages";
import { jsonLdHtml } from "../../lib/jsonLd";
import { translations } from "../../i18n/translations";
import { SITE_NAME, SITE_URL } from "../../lib/site";

// /services/{slug} — one page per service on the home page, so a search for
// "สอบเทียบเครื่องมือวัด" or "สร้างห้องแลป" has a page written for it. The
// services were only three cards on the home page before. Built at deploy
// time; any other slug is a 404.
export const dynamicParams = false;

export function generateStaticParams() {
  return SERVICE_PAGES.map((s) => ({ slug: s.slug }));
}

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const service = serviceBySlug(slug);
  if (!service) return {};
  const copy = translations.servicePages.pages[service.slug];
  return pageMetadata({
    title: copy.title.th,
    description: copy.metaDescription.th,
    path: servicePath(service.slug),
    image: service.image,
  });
}

export default async function ServicePage({ params }: Params) {
  const { slug } = await params;
  const service = serviceBySlug(slug);
  if (!service) notFound();
  const copy = translations.servicePages.pages[service.slug];
  const url = `${SITE_URL}${servicePath(service.slug)}`;

  const [info, maintenanceOn] = await Promise.all([getCompanyInfo(), isMaintenanceMode()]);

  const serviceLd = {
    "@context": "https://schema.org",
    "@type": "Service",
    name: copy.title.th,
    alternateName: copy.title.en,
    serviceType: copy.title.en,
    description: copy.intro.th,
    url,
    image: `${SITE_URL}${service.image}`,
    areaServed: { "@type": "Country", name: "Thailand" },
    provider: { "@type": "Organization", "@id": `${SITE_URL}/#organization`, name: SITE_NAME, url: SITE_URL },
  };
  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: copy.title.th, item: url },
    ],
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdHtml(serviceLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdHtml(breadcrumbLd) }} />
      <Navbar />
      <main className="bg-white">
        <ServicePageView service={service} />
      </main>
      <Footer email={info.email} phone={info.phone} address={info.address} maintenanceOn={maintenanceOn} />
    </>
  );
}
