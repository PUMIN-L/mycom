import { getProduct, deleteProduct } from "./productStore";
import { getContentsByProductId, deleteContent } from "./contentStore";
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

  // 1. Claim the product row BEFORE destroying anything. `DELETE ... WHERE
  //    id = ?` reporting affectedRows > 0 is an atomic claim: when two
  //    hard-deletes race, exactly one gets true and the loser returns null
  //    having deleted nothing at all.
  //
  //    This used to run AFTER the content loop below, which made a lost race
  //    silently destructive: the linked contents were already gone, and
  //    `return null` — which the caller reads as "product not found" (it maps
  //    it to a 500) — threw away the orphaned-image list with it, so those
  //    Cloudinary images could never be cleaned up by anyone.
  //
  //    Ordering is the only protection available: db.ts DOES export
  //    withTransaction(), but it hands the callback a connection and these
  //    three store functions all go through the shared query() instead of
  //    taking one, so wrapping this would run them outside the transaction.
  //    Making it truly atomic means threading a connection through
  //    productStore and contentStore first.
  //
  //    What that leaves: if a content delete below fails midway, the product
  //    row is already gone and the remaining contents stay publicly reachable
  //    (isHiddenFromAnonymous only hides content whose product EXISTS and is
  //    not public) until an admin deletes them from the content UI. That is
  //    visible and recoverable, unlike the lost-race case above, which
  //    stranded images with nothing left pointing at them.
  const deleted = await deleteProduct(id);
  if (!deleted) return null;

  const orphanedImages: string[] = [];

  // 2. The product's own image (collected, not deleted from Cloudinary — the
  //    caller confirms before that happens).
  if (product.image && product.image.includes("cloudinary.com")) {
    orphanedImages.push(product.image);
  }

  // 3. Linked showcase contents. Images are collected per content as it is
  //    deleted, not all up front: a URL must only be reported as orphaned once
  //    the row referencing it is actually gone, so a failure partway through
  //    cannot tell the caller to delete images that are still in use.
  const linkedContents = await getContentsByProductId(id);
  for (const content of linkedContents) {
    const imageUrls = collectContentImageUrls(content);
    for (const url of imageUrls) {
      if (url.includes("cloudinary.com")) orphanedImages.push(url);
    }
    await deleteContent(content.id);
  }

  return orphanedImages;
}
