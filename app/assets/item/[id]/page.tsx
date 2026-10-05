import type { Metadata } from "next";
import InventoryItemPage from "../../../components/inventory/InventoryItemPage";

// One piece of ทรัพย์สินบริษัท — the page its sticker QR opens. Admin only (proxy.ts).
export const metadata: Metadata = { title: "ทรัพย์สินบริษัท", robots: { index: false, follow: false } };

export default async function AssetsItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <InventoryItemPage kind="asset" id={id} />;
}
