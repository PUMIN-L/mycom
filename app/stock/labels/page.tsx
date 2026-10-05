import type { Metadata } from "next";
import { Suspense } from "react";
import InventoryLabelsPage from "../../components/inventory/InventoryLabelsPage";

// Stickers for สต็อกสินค้า. Admin only (proxy.ts).
export const metadata: Metadata = { title: "พิมพ์สติกเกอร์ — สต็อกสินค้า", robots: { index: false, follow: false } };

export default function StockLabelsPage() {
  // useSearchParams (?ids=) needs a Suspense boundary.
  return (
    <Suspense>
      <InventoryLabelsPage kind="stock" />
    </Suspense>
  );
}
