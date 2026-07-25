import type { Metadata } from "next";
import { getAllDocuments } from "../lib/documentStore";
import { SITE_NAME } from "../lib/site";
import DocumentListClient from "./DocumentListClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "เอกสารดาวน์โหลด",
  description: `รวมเอกสารดาวน์โหลดทั้งหมดของ ${SITE_NAME}`,
  alternates: { canonical: "/documents" },
};

export default async function DocumentListPage() {
  const documents = await getAllDocuments();
  return <DocumentListClient initialDocuments={documents} />;
}
