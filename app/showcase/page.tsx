import type { Metadata } from "next";
import { getAllContents } from "../lib/contentStore";
import { getAllDocuments } from "../lib/documentStore";
import { SITE_NAME } from "../lib/site";
import ShowcaseListClient from "./ShowcaseListClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "All Content",
  description: `รวมบทความและรายละเอียดสินค้าทั้งหมดของ ${SITE_NAME}`,
  alternates: { canonical: "/showcase" },
};

export default async function ShowcaseListPage() {
  // Parallel — these two reads are independent (was serial, one extra round trip).
  const [contents, documents] = await Promise.all([
    getAllContents(),
    getAllDocuments(),
  ]);
  return <ShowcaseListClient initialContents={contents} initialDocuments={documents} />;
}
