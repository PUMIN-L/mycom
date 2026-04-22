import Navbar from "../components/Navbar";
import Contact from "../components/Contact";
import Footer from "../components/Footer";

export const metadata = {
  title: "ติดต่อเรา | I Don't Know Tech",
  description: "ติดต่อบริษัท I Don't Know Tech - จำหน่ายและบริการเครื่องมือทดสอบ, นนทบุรี ประเทศไทย",
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
