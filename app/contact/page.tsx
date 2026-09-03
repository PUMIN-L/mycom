import Navbar from "../components/Navbar";
import Contact from "../components/Contact";
import Footer from "../components/Footer";
import { SITE_URL } from "../lib/site";
import { getCompanyInfo } from "../lib/companyInfo";

export const metadata = {
  title: "ติดต่อเรา",
  description: "ติดต่อบริษัท Profin Lab Scale — จำหน่ายและบริการเครื่องมือทดสอบ, นนทบุรี ประเทศไทย — Contact us for testing instruments, calibration & lab solutions in Thailand",
  alternates: { canonical: "/contact" },
};

const breadcrumbLd = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
    { "@type": "ListItem", position: 2, name: "ติดต่อเรา", item: `${SITE_URL}/contact` },
  ],
};

export default async function ContactPage() {
  const info = await getCompanyInfo();
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
      <Footer email={info.email} phone={info.phone} address={info.address} />
    </>
  );
}
