import type { Metadata } from "next";
import { Suspense } from "react";
import { SITE_META_DESCRIPTION } from "./lib/site";
import Navbar from "./components/Navbar";
import Hero from "./components/Hero";
import Services from "./components/Services";
import Products from "./components/Products";
import ProductsSkeleton from "./components/ProductsSkeleton";
import ProductsJsonLd from "./components/ProductsJsonLd";
import Clients from "./components/Clients";
import Footer from "./components/Footer";
import { getProductsData } from "./lib/getProductsData";
import { getCompanyInfo } from "./lib/companyInfo";
import { isMaintenanceMode } from "./lib/settingsStore";

// Product data is admin-editable, so we use ISR (revalidate) to serve from cache
// and refresh in the background when needed, instead of force-dynamic.
export const revalidate = 60;

// The homepage owns the site-root canonical (moved off the layout so other pages
// don't inherit it). Its Open Graph tags are the root layout's, which already
// describe the home page. The description is SITE_META_DESCRIPTION — short
// enough that Google shows all of it (see site.ts); the equipment names that
// used to be appended here live on /products and the category pages instead.
export const metadata: Metadata = {
  alternates: { canonical: "/" },
  description: SITE_META_DESCRIPTION,
};

export default async function Home() {
  // Start fetching on the server immediately, but DON'T await here — the promise
  // is handed to <Products> (which reads it with `use`) so the rest of the page
  // streams instantly and the skeleton shows only the products area while it loads.
  const dataPromise = getProductsData();
  // Company info is cached (unstable_cache) so this resolves near-instantly
  // except on a cold cache — safe to await plainly rather than needing its
  // own Suspense boundary like the (uncached, potentially slow) product data.
  const [companyInfo, maintenanceOn] = await Promise.all([
    getCompanyInfo(),
    isMaintenanceMode(),
  ]);

  return (
    <>
      <Navbar isHomePage={true} />
      <main>
        <Hero />
        <Services />
        <Suspense fallback={<ProductsSkeleton />}>
          <Products dataPromise={dataPromise} />
        </Suspense>
        {/* <Clients /> */}
      </main>
      <Footer email={companyInfo.email} phone={companyInfo.phone} address={companyInfo.address} maintenanceOn={maintenanceOn} />
      {/* SEO: product/organisation structured data (shares the cached fetch) */}
      <Suspense fallback={null}>
        <ProductsJsonLd />
      </Suspense>
    </>
  );
}
