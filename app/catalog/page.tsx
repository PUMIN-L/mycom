import type { Metadata } from "next";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import CatalogClient from "./CatalogClient";
import { getAllDocuments } from "../lib/documentStore";
import { SITE_URL } from "../lib/site";

export const revalidate = 60;

const title = "แคตตาล๊อคสินค้า (Product Catalogs) | Profin Lab Scale";
const description =
  "แคตตาล๊อคสินค้า โบรชัวร์ และเอกสารข้อมูลสำหรับเครื่องมือทดสอบคุณภาพจาก Profin Lab Scale";

export const metadata: Metadata = {
  title,
  description,
  // Without this the page inherits the root layout's canonical ("/") and tells
  // Google it's a duplicate of the homepage — dropping /catalog from the index.
  alternates: { canonical: "/catalog" },
  openGraph: { url: `${SITE_URL}/catalog`, title, description },
};

export default async function CatalogPage() {
  const documents = await getAllDocuments();
  
  return (
    <>
      <Navbar />
      <main className="bg-gray-50 min-h-screen pt-24 pb-20">
        <CatalogClient initialDocuments={documents} />
      </main>
      <Footer />
    </>
  );
}
