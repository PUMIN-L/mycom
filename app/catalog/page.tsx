import type { Metadata } from "next";
import CatalogClient from "./CatalogClient";
import { getAllDocuments } from "../lib/documentStore";
import { pageMetadata } from "../lib/pageMetadata";

export const revalidate = 60;

// The canonical matters: without one the page inherits the root layout's ("/")
// and tells Google it's a duplicate of the homepage — dropping /catalog from
// the index. No brand in the title: the root template appends it (it used to
// be written here too, so <title> ended "| Profin Lab Scale | Profin Lab Scale").
export const metadata: Metadata = pageMetadata({
  title: "แคตตาล็อกสินค้า (Product Catalogs)",
  description:
    "แคตตาล็อกสินค้า โบรชัวร์ และเอกสารข้อมูลเครื่องมือทดสอบจาก Profin Lab Scale — Download product catalogs, brochures & datasheets",
  path: "/catalog",
});

export default async function CatalogPage() {
  const documents = await getAllDocuments();
  // Navbar/main/Footer live in layout.tsx (shared with loading.tsx).
  return <CatalogClient initialDocuments={documents} />;
}
