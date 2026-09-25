import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import Navbar from "../../components/Navbar";
import Footer from "../../components/Footer";
import ProductCatalogView from "../../components/ProductCatalogView";
import { getProductsData } from "../../lib/getProductsData";
import { getCompanyInfo } from "../../lib/companyInfo";
import { isMaintenanceMode } from "../../lib/settingsStore";
import { pageMetadata } from "../../lib/pageMetadata";
import { catalogSections, categoryDescription, categoryTitle } from "../../lib/catalogPages";
import { PRODUCTS_PATH, categoryIdFromSlug, categorySlug } from "../../lib/catalogPaths";
import { jsonLdHtml } from "../../lib/jsonLd";
import { SITE_URL } from "../../lib/site";

// /products/{id}-{slug} — one category: a page that targets what people type
// ("เครื่องทดสอบแรงดึง", "tensile tester") with its title, h1 and products.
// Categories were only filter buttons on the home page before, with no URL.
//
// Rendered on first visit and cached like the home page (no category is built
// at deploy time, so the build does not need the database). A category with no
// public products 404s rather than serve an empty page.
export const revalidate = 60;

export async function generateStaticParams() {
  return [];
}

type Params = { params: Promise<{ slug: string }> };

async function loadCategory(slug: string) {
  const id = categoryIdFromSlug(slug);
  if (id === null) return null;
  const data = await getProductsData(); // public products only
  const category = data.categories.find((c) => c.id === id);
  if (!category) return null;
  const [section] = catalogSections([category], data.products);
  if (!section) return null;
  return { data, category, section };
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const found = await loadCategory(slug);
  if (!found) return { title: "ไม่พบหมวดหมู่สินค้า", robots: { index: false, follow: true } };
  const { section } = found;
  return pageMetadata({
    title: categoryTitle(section),
    description: categoryDescription(section),
    path: section.path,
    image: section.products.find((p) => p.image)?.image,
  });
}

export default async function CategoryPage({ params }: Params) {
  const { slug } = await params;
  const found = await loadCategory(slug);
  if (!found) notFound();
  const { data, category, section } = found;

  // One URL per category: an old slug (the category was renamed) or a bare
  // id moves to the current one. The id is what identifies the page, so the
  // redirect is permanent — whatever the name becomes, this id lands here.
  if (slug !== categorySlug(category)) permanentRedirect(section.path);

  const otherCategories = catalogSections(data.categories, data.products)
    .filter((s) => s.id !== section.id)
    .map(({ id, path, name_th, name_en, name_zh }) => ({ id, path, name_th, name_en, name_zh }));

  const [info, maintenanceOn] = await Promise.all([getCompanyInfo(), isMaintenanceMode()]);

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "สินค้าทั้งหมด", item: `${SITE_URL}${PRODUCTS_PATH}` },
      { "@type": "ListItem", position: 3, name: categoryTitle(section), item: `${SITE_URL}${section.path}` },
    ],
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdHtml(breadcrumbLd) }} />
      <Navbar />
      <main className="bg-white">
        <ProductCatalogView
          mode="category"
          sections={[section]}
          otherCategories={otherCategories}
          contentIdByProduct={data.contentIdByProduct}
        />
      </main>
      <Footer email={info.email} phone={info.phone} address={info.address} maintenanceOn={maintenanceOn} />
    </>
  );
}
