import type { Metadata } from "next";
import { Suspense } from "react";
import { SITE_DESCRIPTION } from "./lib/site";
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

// Product data is admin-editable, so we use ISR (revalidate) to serve from cache
// and refresh in the background when needed, instead of force-dynamic.
export const revalidate = 60;

// The homepage owns the site-root canonical (moved off the layout so other pages
// don't inherit it). The description keeps the Thai brand line but appends the
// ENGLISH equipment categories customers actually search for, so the homepage
// itself ranks for "hardness tester", "viscometer", etc. — not just Thai terms.
export const metadata: Metadata = {
  alternates: { canonical: "/" },
  description:
    `${SITE_DESCRIPTION} — เครื่องทดสอบแรงดึง (Tensile tester), เครื่องทดสอบฟิล์ม, ` +
    `เครื่องทดสอบพลาสติก, เครื่องวัดค่า COF, เครื่องวัดความหนืด (Viscometer), ` +
    `เครื่องวัดสี (Colorimeter), เครื่องชั่งวิเคราะห์, ตู้อบลมร้อน, เครื่องวัดความแข็ง (Hardness tester), ` +
    `เครื่องทดสอบการรั่วซึม (Leak tester) — สอบเทียบ ติดตั้ง สอนการใช้งาน`,
};

export default async function Home() {
  // Start fetching on the server immediately, but DON'T await here — the promise
  // is handed to <Products> (which reads it with `use`) so the rest of the page
  // streams instantly and the skeleton shows only the products area while it loads.
  const dataPromise = getProductsData();
  // Company info is cached (unstable_cache) so this resolves near-instantly
  // except on a cold cache — safe to await plainly rather than needing its
  // own Suspense boundary like the (uncached, potentially slow) product data.
  const companyInfo = await getCompanyInfo();

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
      <Footer email={companyInfo.email} phone={companyInfo.phone} address={companyInfo.address} />
      {/* SEO: product/organisation structured data (shares the cached fetch) */}
      <Suspense fallback={null}>
        <ProductsJsonLd />
      </Suspense>
    </>
  );
}
