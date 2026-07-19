import Navbar from "../components/Navbar";
import Footer from "../components/Footer";

// Chrome lives in the layout (not the page) so Navbar + Footer stay mounted
// across the loading.tsx Suspense boundary — otherwise the skeleton would render
// with no navbar and it would pop in when the page resolves.
export default function CatalogLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <Navbar />
      <main className="bg-gray-50 min-h-screen pt-24 pb-20">{children}</main>
      <Footer />
    </>
  );
}
