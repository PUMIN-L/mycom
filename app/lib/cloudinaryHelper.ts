import { v2 as cloudinary } from "cloudinary";
import type { ContentData } from "./types";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/**
 * Upload an image buffer to Cloudinary and return its secure URL.
 * Centralizes the upload-stream dance so route handlers don't re-implement it.
 */
export function uploadImage(
  buffer: Buffer,
  folder = "samples/mycom",
  resourceType: "auto" | "image" | "raw" | "video" = "auto",
  publicId?: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const options: any = { folder, resource_type: resourceType };
    if (publicId) options.public_id = publicId;

    const stream = cloudinary.uploader.upload_stream(
      options,
      (error, result) => {
        if (error || !result) {
          reject(error ?? new Error("Cloudinary upload returned no result"));
        } else {
          resolve(result.secure_url);
        }
      }
    );
    stream.end(buffer);
  });
}

/**
 * Extract the Cloudinary public_id from a secure URL.
 * e.g. https://res.cloudinary.com/demo/image/upload/v1234567/samples/mycom/abc.jpg
 *      → samples/mycom/abc
 */
export function extractPublicId(imageUrl: string): string | null {
  try {
    const uploadIndex = imageUrl.indexOf("/upload/");
    if (uploadIndex === -1) return null;
    // everything after /upload/
    let path = imageUrl.slice(uploadIndex + "/upload/".length);
    // strip optional version segment e.g. "v1234567/"
    path = path.replace(/^v\d+\//, "");
    // strip file extension
    const dotIndex = path.lastIndexOf(".");
    if (dotIndex !== -1) {
      path = path.slice(0, dotIndex);
    }
    return path;
  } catch {
    return null;
  }
}

/**
 * Delete a single image from Cloudinary by its URL.
 * Returns true if deleted, false otherwise.
 */
export async function deleteCloudinaryImage(imageUrl: string): Promise<boolean> {
  const publicId = extractPublicId(imageUrl);
  if (!publicId) return false;
  try {
    const result = await cloudinary.uploader.destroy(publicId);
    return result.result === "ok" || result.result === "not found";
  } catch (err) {
    console.error("Cloudinary delete error:", err);
    return false;
  }
}

/**
 * Delete multiple images from Cloudinary by their URLs.
 */
export async function deleteCloudinaryImages(imageUrls: string[]): Promise<void> {
  await Promise.all(imageUrls.map(deleteCloudinaryImage));
}

/**
 * Collect every Cloudinary image URL referenced by a content's blocks.
 *
 * Both `image` and `text-image` blocks can carry an `imageUrl`, so we key off
 * the presence of `imageUrl` rather than the block type — otherwise images in
 * `text-image` blocks would be orphaned on Cloudinary when their content/product
 * is deleted.
 */
export function collectContentImageUrls(content: ContentData): string[] {
  return content.blocks
    .filter((b) => b.imageUrl)
    .map((b) => b.imageUrl as string);
}

/**
 * Automatically generate a cover image URL from a Cloudinary PDF URL.
 * It changes the extension to .jpg and can append page number params.
 */
export function getPdfCoverUrl(pdfUrl: string): string {
  // e.g. https://res.cloudinary.com/.../upload/v123/file.pdf
  // -> https://res.cloudinary.com/.../upload/w_800,f_jpg,pg_1/v123/file.pdf
  // Or simply changing the extension to .jpg:
  return pdfUrl.replace(/\.pdf$/i, ".jpg");
}
