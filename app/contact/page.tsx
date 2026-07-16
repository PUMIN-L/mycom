import Navbar from "../components/Navbar";
import Contact from "../components/Contact";
import Footer from "../components/Footer";

export const metadata = {
  title: "ติดต่อเรา",
  description: "ติดต่อบริษัท Profin Lab Scale - จำหน่ายและบริการเครื่องมือทดสอบ, นนทบุรี ประเทศไทย",
  alternates: { canonical: "/contact" },
};

export default function ContactPage() {
  return (
    <>
      <Navbar />
      <main className="pt-20">
        <Contact />
      </main>
      <Footer />
    </>
  );
}
