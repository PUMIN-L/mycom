import { getProduct, deleteProduct } from "./productStore";
import { getAllContents, deleteContent } from "./contentStore";
import { collectContentImageUrls } from "./cloudinaryHelper";

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
