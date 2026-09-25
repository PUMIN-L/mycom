import Navbar from "../components/Navbar";
import Contact from "../components/Contact";
import Footer from "../components/Footer";
import type { Metadata } from "next";
import { SITE_URL } from "../lib/site";
import { pageMetadata } from "../lib/pageMetadata";
import { getCompanyInfo } from "../lib/companyInfo";
import { isMaintenanceMode } from "../lib/settingsStore";

export const metadata: Metadata = pageMetadata({
  title: "ติดต่อเรา",
  description: "ติดต่อบริษัท Profin Lab Scale — จำหน่ายและบริการเครื่องมือทดสอบ, นนทบุรี ประเทศไทย — Contact us for testing instruments, calibration & lab solutions in Thailand",
  path: "/contact",
});

const breadcrumbLd = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
    { "@type": "ListItem", position: 2, name: "ติดต่อเรา", item: `${SITE_URL}/contact` },
  ],
};

export default async function ContactPage() {
  const [info, maintenanceOn] = await Promise.all([
    getCompanyInfo(),
    isMaintenanceMode(),
  ]);
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd).replace(/</g, '\\u003c') }}
      />
      <Navbar />
      <main className="pt-20">
        <Contact
          email={info.email}
          phone={info.phone}
          address={info.address}
          addressMapsQuery={info.addressMapsQuery}
        />
      </main>
      <Footer email={info.email} phone={info.phone} address={info.address} maintenanceOn={maintenanceOn} />
    </>
  );
}
