import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import AboutSection from "../components/AboutSection";

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
