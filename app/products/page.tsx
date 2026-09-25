import type { Metadata } from "next";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import ProductCatalogView from "../components/ProductCatalogView";
import { getProductsData } from "../lib/getProductsData";
import { getCompanyInfo } from "../lib/companyInfo";
import { isMaintenanceMode } from "../lib/settingsStore";
import { pageMetadata } from "../lib/pageMetadata";
import { catalogSections } from "../lib/catalogPages";
import { PRODUCTS_PATH } from "../lib/catalogPaths";
import { jsonLdHtml } from "../lib/jsonLd";
import { SITE_URL } from "../lib/site";

// /products — every public product, by category, each linking to its content
// page. The home grid shows 9 at a time and filters in the browser, so before
// this page most products had no crawlable link from anywhere on the site.
// Linked from the footer on every page. Same caching as the home page.
export const revalidate = 60;

export const metadata: Metadata = pageMetadata({
  title: "สินค้าทั้งหมด – เครื่องมือวัดและเครื่องทดสอบ",
  description:
    "รวมเครื่องมือวัดและเครื่องทดสอบทุกหมวดจาก Profin Lab Scale — Tensile Tester, เครื่องทดสอบฟิล์ม, Viscometer, เครื่องวัดสี, เครื่องชั่ง พร้อมติดตั้งและสอบเทียบ",
  path: PRODUCTS_PATH,
});

const breadcrumbLd = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
    { "@type": "ListItem", position: 2, name: "สินค้าทั้งหมด", item: `${SITE_URL}${PRODUCTS_PATH}` },
  ],
};

export default async function ProductsPage() {
  const [{ categories, products, contentIdByProduct }, info, maintenanceOn] = await Promise.all([
    getProductsData(), // public products only
    getCompanyInfo(),
    isMaintenanceMode(),
  ]);

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdHtml(breadcrumbLd) }} />
      <Navbar />
      <main className="bg-white">
        <ProductCatalogView
          mode="all"
          sections={catalogSections(categories, products)}
          contentIdByProduct={contentIdByProduct}
        />
      </main>
      <Footer email={info.email} phone={info.phone} address={info.address} maintenanceOn={maintenanceOn} />
    </>
  );
}
