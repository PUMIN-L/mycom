// What may be uploaded, and where it goes. Pure — shared by the upload route
// (app/api/upload), the signing route (app/api/upload/sign) and the browser
// helper that picks between them (lib/uploadClient.ts), so the three can never
// disagree about a limit.

/** The Cloudinary folder every upload lands in (the orphan scanner lists it). */
export const UPLOAD_FOLDER = "samples/mycom";

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_PDF_BYTES = 25 * 1024 * 1024; // 25 MB

export const ALLOWED_IMAGE_TYPES: readonly string[] = ["image/jpeg", "image/png", "image/webp", "image/gif"];

/** Cloudinary's names for the same image types, for a signed upload's
 *  `allowed_formats` — Cloudinary refuses anything else. */
export const ALLOWED_IMAGE_FORMATS = "jpg,jpeg,png,webp,gif";

/**
 * Files larger than this go from the browser STRAIGHT to Cloudinary (a signed
 * upload) instead of through /api/upload.
 *
 * Vercel refuses a request body over 4.5 MB before it reaches the function
 * (413 FUNCTION_PAYLOAD_TOO_LARGE), so through the route a 6 MB catalog PDF
 * could never arrive, whatever limit the route itself allowed. 4 MB leaves
 * room for the multipart envelope. Smaller files keep the route — and the
 * server-side checks it makes.
 */
export const DIRECT_UPLOAD_THRESHOLD = 4 * 1024 * 1024;

export function isPdfFile(file: { name: string; type: string }): boolean {
  return file.name.toLowerCase().endsWith(".pdf") && file.type === "application/pdf";
}
