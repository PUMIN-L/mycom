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

/** Infer the Cloudinary resource_type from a delivery URL. */
function detectResourceType(url: string): "image" | "raw" | "video" {
  if (url.includes("/raw/upload/")) return "raw";
  if (url.includes("/video/upload/")) return "video";
  return "image";
}

/**
 * Extract the Cloudinary public_id from a secure URL.
 * e.g. https://res.cloudinary.com/demo/image/upload/v1234567/samples/mycom/abc.jpg
 *      → samples/mycom/abc
 * Handles optional transformation segments and a query string, and (for raw
 * assets like PDFs, whose public_id includes the extension) can keep it.
 */
export function extractPublicId(imageUrl: string, keepExtension = false): string | null {
  try {
    const noQuery = imageUrl.split("?")[0];
    const uploadIndex = noQuery.indexOf("/upload/");
    if (uploadIndex === -1) return null;
    const afterUpload = noQuery.slice(uploadIndex + "/upload/".length);
    // Drop any transformation segment(s) and the version, keeping only the
    // path after "v<digits>/" (or the whole remainder if there is no version).
    const segments = afterUpload.split("/");
    const versionIdx = segments.findIndex((s) => /^v\d+$/.test(s));
    let path = (versionIdx !== -1 ? segments.slice(versionIdx + 1) : segments).join("/");
    if (!keepExtension) {
      const dotIndex = path.lastIndexOf(".");
      if (dotIndex !== -1) path = path.slice(0, dotIndex);
    }
    return path || null;
  } catch {
    return null;
  }
}

/**
 * Delete a single asset from Cloudinary by its URL.
 * Returns true if deleted (or already gone), false otherwise.
 */
export async function deleteCloudinaryImage(imageUrl: string): Promise<boolean> {
  const resourceType = detectResourceType(imageUrl);
  // Raw assets (e.g. PDFs) store the extension as part of the public_id, so it
  // must be preserved; images store the public_id without an extension. The
  // destroy call must also target the correct resource_type, otherwise the
  // asset is never actually removed.
  const publicId = extractPublicId(imageUrl, resourceType === "raw");
  if (!publicId) return false;
  try {
    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType,
    });
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
 * A block can carry a single `imageUrl` (`image`/`text-image` blocks) AND/OR an
 * `imageUrls[]` array (`gallery` blocks), so we collect BOTH rather than keying
 * off the block type — otherwise gallery images (or any block that only fills
 * `imageUrls`) would be orphaned on Cloudinary when their content/product is
 * deleted. Returns a de-duplicated list.
 */
export function collectContentImageUrls(content: ContentData): string[] {
  const urls = new Set<string>();
  for (const b of content.blocks) {
    if (typeof b.imageUrl === "string" && b.imageUrl) urls.add(b.imageUrl);
    if (Array.isArray(b.imageUrls)) {
      for (const u of b.imageUrls) if (typeof u === "string" && u) urls.add(u);
    }
  }
  return [...urls];
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
