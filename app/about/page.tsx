import type { Metadata } from "next";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import AboutSection from "../components/AboutSection";

export const metadata: Metadata = {
  title: "เกี่ยวกับเรา",
  description:
    "ประวัติและความเชี่ยวชาญของ Profin Lab Scale — ผู้จำหน่าย ซ่อมบำรุง และสอบเทียบเครื่องมือทดสอบคุณภาพ พร้อมบริการออกแบบและสร้างห้องปฏิบัติการมาตรฐานสากล จ.นนทบุรี",
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  return (
    <>
      <Navbar />
      <main className="bg-white">
        <AboutSection />
      </main>
      <Footer />
    </>
  );
}
