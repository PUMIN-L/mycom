// Shared contact details — the single source of truth used by both the Contact
// section (app/components/Contact.tsx) and the product showcase pages, so the
// LINE / email shown everywhere stay in sync.
//
// Pure constants only — safe to import from server and client components.

export const LINE_ID = "@puminkmutnb";

/** LINE "add friend" deep link (also what the QR code encodes). */
export const LINE_URL = "https://line.me/ti/p/~puminkmutnb";

export const CONTACT_EMAIL = "ampumin@gmail.com";

/** A scannable QR image (rendered via next/image, `unoptimized`) for LINE_URL. */
export function lineQrUrl(size = 220): string {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(
    LINE_URL
  )}`;
}
