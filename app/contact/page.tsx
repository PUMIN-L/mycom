import Navbar from "../components/Navbar";
import Contact from "../components/Contact";
import Footer from "../components/Footer";
import { SITE_URL } from "../lib/site";

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

export default function ContactPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd).replace(/</g, '\\u003c') }}
      />
      <Navbar />
      <main className="pt-20">
        <Contact />
      </main>
      <Footer />
    </>
  );
}
