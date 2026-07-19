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
    `${SITE_DESCRIPTION} — Digital calipers, micrometers, dial gauges, hardness testers (durometers), ` +
    `viscometers, COF & leak testers, colorimeters, spectrophotometers, gloss meters, ` +
    `analytical & precision balances, and industrial & laboratory drying ovens.`,
};

export default function Home() {
  // Start fetching on the server immediately, but DON'T await here — the promise
  // is handed to <Products> (which reads it with `use`) so the rest of the page
  // streams instantly and the skeleton shows only the products area while it loads.
  const dataPromise = getProductsData();

  return (
    <>
      <Navbar />
      <main>
        <Hero />
        <Services />
        <Suspense fallback={<ProductsSkeleton />}>
          <Products dataPromise={dataPromise} />
        </Suspense>
        {/* <Clients /> */}
      </main>
      <Footer />
      {/* SEO: product/organisation structured data (shares the cached fetch) */}
      <Suspense fallback={null}>
        <ProductsJsonLd />
      </Suspense>
    </>
  );
}
