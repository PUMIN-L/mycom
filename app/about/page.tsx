import type { Metadata } from "next";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import AboutSection from "../components/AboutSection";
import { SITE_URL } from "../lib/site";
import { getCompanyInfo } from "../lib/companyInfo";

export const metadata: Metadata = {
  title: "เกี่ยวกับเรา",
  description:
    "ประวัติและความเชี่ยวชาญของ Profin Lab Scale — ผู้จำหน่าย ซ่อมบำรุง และสอบเทียบเครื่องมือทดสอบคุณภาพ พร้อมบริการออกแบบและสร้างห้องปฏิบัติการมาตรฐานสากล จ.นนทบุรี — Testing equipment supplier, calibration services & laboratory construction in Nonthaburi, Thailand",
  alternates: { canonical: "/about" },
};

const breadcrumbLd = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
    { "@type": "ListItem", position: 2, name: "เกี่ยวกับเรา", item: `${SITE_URL}/about` },
  ],
};

export default async function AboutPage() {
  const info = await getCompanyInfo();
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd).replace(/</g, '\\u003c') }}
      />
      <Navbar />
      <main className="bg-white">
        <AboutSection />
      </main>
      <Footer email={info.email} phone={info.phone} address={info.address} />
    </>
  );
}
