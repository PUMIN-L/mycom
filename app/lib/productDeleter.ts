import { getProduct, deleteProduct, getAllProducts } from "./productStore";
import { getAllContents, deleteContent } from "./contentStore";
import {
  deleteCloudinaryImage,
  deleteCloudinaryImages,
  collectContentImageUrls,
} from "./cloudinaryHelper";
import { query } from "./db";
import type { RowDataPacket } from "mysql2";
import type { ProductData } from "./types";

/**
 * Perform a hard delete on a product.
 * This deletes all associated showcase contents, their images from Cloudinary,
 * the product's own image, and finally the product record itself.
 */
export async function hardDeleteProduct(id: string): Promise<boolean> {
  const product = await getProduct(id);
  if (!product) return false;

  // 1. Delete linked contents first (and their images)
  const allContents = await getAllContents();
  const linkedContents = allContents.filter((c) => c.productId === id);
  for (const content of linkedContents) {
    const imageUrls = collectContentImageUrls(content);
    if (imageUrls.length > 0) {
      await deleteCloudinaryImages(imageUrls);
    }
    await deleteContent(content.id);
  }

  // 2. Delete the product from the DB
  const deleted = await deleteProduct(id);
  if (!deleted) return false;

  // 3. Delete the product's own image if it lives on Cloudinary
  if (product.image && product.image.includes("cloudinary.com")) {
    await deleteCloudinaryImage(product.image);
  }

  return true;
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
      const success = await hardDeleteProduct(row.id);
      if (success) {
        console.log(`[Cleanup] Hard deleted product: ${row.id}`);
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
