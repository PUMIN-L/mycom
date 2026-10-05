import type { Metadata } from "next";
import { Suspense } from "react";
import InventoryLabelsPage from "../../components/inventory/InventoryLabelsPage";

// Stickers for ทรัพย์สินบริษัท. Admin only (proxy.ts).
export const metadata: Metadata = { title: "พิมพ์สติกเกอร์ — ทรัพย์สินบริษัท", robots: { index: false, follow: false } };

export default function AssetsLabelsPage() {
  // useSearchParams (?ids=) needs a Suspense boundary.
  return (
    <Suspense>
      <InventoryLabelsPage kind="asset" />
    </Suspense>
  );
}
