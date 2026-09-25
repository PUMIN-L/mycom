import type { Metadata } from "next";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import AboutSection from "../components/AboutSection";
import { SITE_URL } from "../lib/site";
import { pageMetadata } from "../lib/pageMetadata";
import { getCompanyInfo } from "../lib/companyInfo";
import { isMaintenanceMode } from "../lib/settingsStore";

export const metadata: Metadata = pageMetadata({
  title: "เกี่ยวกับเรา",
  description:
    "ประวัติและความเชี่ยวชาญของ Profin Lab Scale ผู้จำหน่าย ซ่อมบำรุง และสอบเทียบเครื่องมือทดสอบ พร้อมออกแบบสร้างห้องปฏิบัติการมาตรฐานสากล จ.นนทบุรี",
  path: "/about",
});

const breadcrumbLd = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
    { "@type": "ListItem", position: 2, name: "เกี่ยวกับเรา", item: `${SITE_URL}/about` },
  ],
};

export default async function AboutPage() {
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
      <main className="bg-white">
        <AboutSection />
      </main>
      <Footer email={info.email} phone={info.phone} address={info.address} maintenanceOn={maintenanceOn} />
    </>
  );
}
