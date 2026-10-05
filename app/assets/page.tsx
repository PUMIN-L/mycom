import type { Metadata } from "next";
import InventoryListPage from "../components/inventory/InventoryListPage";

// ทรัพย์สินบริษัท — admin only (proxy.ts). Spec: openspec/changes/add-inventory-tracking.
export const metadata: Metadata = { title: "ทรัพย์สินบริษัท", robots: { index: false, follow: false } };

export default function AssetsPage() {
  return <InventoryListPage kind="asset" />;
}
