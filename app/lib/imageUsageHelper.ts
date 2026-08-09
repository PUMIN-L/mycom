import { query } from "./db";
import { RowDataPacket } from "mysql2";
import { deleteCloudinaryImage, extractPublicId } from "./cloudinaryHelper";

export type ExcludeSource = {
  type: "product" | "content" | "document";
  id: string;
};

/**
 * Checks if a given Cloudinary image URL is still referenced by any product,
 * content block, or document in the database.
 * @param imageUrl The URL to check
 * @param excludeSource The entity currently being deleted (to ignore it in the check)
 */
export async function isCloudinaryImageInUse(
  imageUrl: string,
  excludeSource?: ExcludeSource
): Promise<boolean> {
  if (!imageUrl || !imageUrl.includes("cloudinary.com")) return false;

  // 1. Check products table (Strict Equality)
  let productSql = "SELECT id FROM products WHERE image = ?";
  const productParams: any[] = [imageUrl];
  if (excludeSource?.type === "product") {
    productSql += " AND id != ?";
    productParams.push(excludeSource.id);
  }
  productSql += " LIMIT 1";
  const [productRows] = await query<RowDataPacket[]>(productSql, productParams);
  if (productRows.length > 0) return true;

  // 2. Check documents table (Strict Equality)
  let docSql = "SELECT id FROM documents WHERE (pdfUrl = ? OR coverUrl = ?)";
  const docParams: any[] = [imageUrl, imageUrl];
  if (excludeSource?.type === "document") {
    docSql += " AND id != ?";
    docParams.push(excludeSource.id);
  }
  docSql += " LIMIT 1";
  const [docRows] = await query<RowDataPacket[]>(docSql, docParams);
  if (docRows.length > 0) return true;

  // 3. Check contents table (JSON_SEARCH for exact match inside JSON array, prevents OOM and substring errors)
  let contentSql = "SELECT id FROM contents WHERE JSON_SEARCH(blocks, 'one', ?) IS NOT NULL";
  const contentParams: any[] = [imageUrl];
  if (excludeSource?.type === "content") {
    contentSql += " AND id != ?";
    contentParams.push(excludeSource.id);
  }
  contentSql += " LIMIT 1";
  const [contentRows] = await query<RowDataPacket[]>(contentSql, contentParams);
  if (contentRows.length > 0) return true;

  return false;
}

/**
 * Deletes an image from Cloudinary ONLY if it is not referenced by any other
 * product, content, or document.
 */
export async function safeDeleteCloudinaryImage(
  imageUrl: string,
  excludeSource?: ExcludeSource
): Promise<boolean> {
  if (!imageUrl || !imageUrl.includes("cloudinary.com")) return false;

  const inUse = await isCloudinaryImageInUse(imageUrl, excludeSource);
  if (inUse) {
    console.log(`[SafeDelete] Image ${imageUrl} is still in use. Skipping Cloudinary deletion.`);
    return false;
  }
  
  return await deleteCloudinaryImage(imageUrl);
}

/**
 * Deletes multiple images from Cloudinary ONLY if they are not referenced
 * elsewhere in the database.
 */
export async function safeDeleteCloudinaryImages(
  imageUrls: string[],
  excludeSource?: ExcludeSource
): Promise<void> {
  // We process these sequentially to avoid hammering the DB/Cloudinary,
  // but they could be parallelized if needed.
  for (const url of imageUrls) {
    await safeDeleteCloudinaryImage(url, excludeSource);
  }
}
