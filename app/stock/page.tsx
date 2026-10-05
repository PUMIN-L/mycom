import type { Metadata } from "next";
import InventoryListPage from "../components/inventory/InventoryListPage";

// สต็อกสินค้า — admin only (proxy.ts). Spec: openspec/changes/add-inventory-tracking.
export const metadata: Metadata = { title: "สต็อกสินค้า", robots: { index: false, follow: false } };

export default function StockPage() {
  return <InventoryListPage kind="stock" />;
}
