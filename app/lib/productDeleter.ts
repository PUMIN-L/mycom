import { getProduct, deleteProduct } from "./productStore";
import { getAllContents, deleteContent } from "./contentStore";
import { collectContentImageUrls } from "./cloudinaryHelper";
import { query } from "./db";
import type { RowDataPacket } from "mysql2";

/**
 * Perform a hard delete on a product.
 * This deletes all associated showcase contents and the product record itself.
 * Returns an array of Cloudinary image URLs that are no longer referenced
 * (the caller should show a confirmation dialog before deleting them).
 * Returns null if the product was not found.
 */
export async function hardDeleteProduct(id: string): Promise<string[] | null> {
  const product = await getProduct(id);
  if (!product) return null;

  const orphanedImages: string[] = [];

  // 1. Delete linked contents first (collect their images)
  const allContents = await getAllContents();
  const linkedContents = allContents.filter((c) => c.productId === id);
  for (const content of linkedContents) {
    const imageUrls = collectContentImageUrls(content);
    for (const url of imageUrls) {
      if (url.includes("cloudinary.com")) orphanedImages.push(url);
    }
    await deleteContent(content.id);
  }

  // 2. Delete the product from the DB
  const deleted = await deleteProduct(id);
  if (!deleted) return null;

  // 3. Collect the product's own image (don't delete from Cloudinary)
  if (product.image && product.image.includes("cloudinary.com")) {
    orphanedImages.push(product.image);
  }

  return orphanedImages;
}

let isCleaningUp = false;
let lastCleanupTime = 0;
const CLEANUP_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Background task to find products that have been in "pendingDeleteAt"
 * for more than 24 hours, and perform a hard delete on them.
 * This is debounced to run at most once per 15 minutes per instance to prevent DoS.
 */
export async function cleanupExpiredProducts(): Promise<void> {
  if (isCleaningUp) return;
  if (Date.now() - lastCleanupTime < CLEANUP_COOLDOWN_MS) return;

  isCleaningUp = true;
  try {
    // Find products where pendingDeleteAt is older than 24 hours ago
    const [rows] = await query<RowDataPacket[]>(
      "SELECT id FROM products WHERE pendingDeleteAt IS NOT NULL AND pendingDeleteAt < ?",
      [new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()]
    );
    
    if (rows.length === 0) {
      lastCleanupTime = Date.now();
      return;
    }

    console.log(`[Cleanup] Found ${rows.length} products to hard delete.`);
    for (const row of rows) {
      const orphanedImages = await hardDeleteProduct(row.id);
      if (orphanedImages) {
        // Images are NOT auto-deleted — they'll appear in the Orphan Scanner
        // for manual review. Log them for auditability.
        console.log(`[Cleanup] Hard deleted product: ${row.id}, orphaned images: ${orphanedImages.length}`);
      } else {
        console.error(`[Cleanup] Failed to hard delete product: ${row.id}`);
      }
    }
    
    lastCleanupTime = Date.now();
  } catch (error) {
    console.error("[Cleanup] Failed to run expired products cleanup:", error);
  } finally {
    isCleaningUp = false;
  }
}
