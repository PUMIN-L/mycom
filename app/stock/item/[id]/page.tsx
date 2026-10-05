import type { Metadata } from "next";
import InventoryItemPage from "../../../components/inventory/InventoryItemPage";

// One piece of สต็อกสินค้า — the page its sticker QR opens. Admin only (proxy.ts).
export const metadata: Metadata = { title: "สต็อกสินค้า", robots: { index: false, follow: false } };

export default async function StockItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <InventoryItemPage kind="stock" id={id} />;
}
