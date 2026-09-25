// Delivery URLs for Cloudinary images, resized and re-encoded by Cloudinary
// itself. Pure — used by client components.
//
// Content images (the /showcase pages' image and text-image blocks) were sent
// as the ORIGINAL upload: full resolution, whatever format it was uploaded
// in, to a phone as much as to a desktop. Cloudinary serves any width and a
// modern format (WebP/AVIF, `f_auto`) at the right quality (`q_auto`) from
// the same asset when the URL asks for it — nothing is re-uploaded, and the
// stored URL (what edits and deletes compare against) never changes.

const IMAGE_UPLOAD = "/image/upload/";
// A transformation component already in the URL ("w_800,f_jpg"): each
// parameter is a short lower-case key, an underscore, a value.
const TRANSFORMATION = /^[a-z]{1,4}_[^/]*$/;

/** Widths offered in srcset; the browser picks by `sizes` and pixel density. */
export const RESPONSIVE_WIDTHS = [480, 800, 1200, 1600] as const;

/**
 * `url` resized to at most `width` pixels wide (never enlarged: c_limit), in
 * the best format the browser accepts — or null when `url` is not an image on
 * Cloudinary, or already carries a transformation (left exactly as it is).
 */
export function cloudinaryResized(url: string, width: number): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "res.cloudinary.com") return null;
  const at = parsed.pathname.indexOf(IMAGE_UPLOAD);
  if (at < 0) return null;
  const head = parsed.pathname.slice(0, at + IMAGE_UPLOAD.length);
  const rest = parsed.pathname.slice(at + IMAGE_UPLOAD.length);
  const first = rest.split("/")[0];
  if (first.split(",").every((part) => TRANSFORMATION.test(part))) return null;
  parsed.pathname = `${head}f_auto,q_auto,c_limit,w_${Math.round(width)}/${rest}`;
  return parsed.toString();
}

/** src (1200 wide) + srcset for an <img>, or null for a non-Cloudinary url. */
export function cloudinaryResponsive(url: string): { src: string; srcSet: string } | null {
  const src = cloudinaryResized(url, 1200);
  if (!src) return null;
  return {
    src,
    srcSet: RESPONSIVE_WIDTHS.map((w) => `${cloudinaryResized(url, w)} ${w}w`).join(", "),
  };
}
