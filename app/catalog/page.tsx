import type { Metadata } from "next";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import CatalogClient from "./CatalogClient";
import { getAllDocuments } from "../lib/documentStore";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "แคตตาล๊อคสินค้า (Product Catalogs) | Profin Lab Scale",
  description: "แคตตาล๊อคสินค้า โบรชัวร์ และเอกสารข้อมูลสำหรับเครื่องมือทดสอบคุณภาพจาก Profin Lab Scale",
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
