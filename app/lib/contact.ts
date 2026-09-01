// Shared contact details — the single source of truth used by both the Contact
// section (app/components/Contact.tsx) and the product showcase pages, so the
// LINE / email shown everywhere stay in sync.
//
// Pure constants only — safe to import from server and client components.

export const LINE_ID = "@puminkmutnb";

/** LINE "add friend" deep link (also what the QR code encodes). */
export const LINE_URL = "https://line.me/ti/p/~puminkmutnb";

/** LINE direct protocol link to forcefully open the app instead of a web browser. */
export const LINE_APP_URL = "line://ti/p/~puminkmutnb";

export const CONTACT_EMAIL = "ampumin@gmail.com";

// Physical address — single source for the Organization JSON-LD
// (ProductsJsonLd.tsx) AND the Contact page's Google Maps link/embed, so the
// two can never drift out of sync again. (They previously did: the Maps link
// pointed at an unrelated shopping mall while this address was shown as text
// right next to it.)
export const COMPANY_ADDRESS = {
  streetAddress: "93 Soi Ngamwongwan 6 Yaek 19, Ngamwongwan Rd., Bang Khen",
  addressLocality: "Mueang Nonthaburi",
  addressRegion: "Nonthaburi",
  postalCode: "11000",
  addressCountry: "TH",
};

/** Single-line address for a Google Maps text-search query / embed. */
export const COMPANY_ADDRESS_QUERY = `${COMPANY_ADDRESS.streetAddress}, ${COMPANY_ADDRESS.addressLocality}, ${COMPANY_ADDRESS.addressRegion} ${COMPANY_ADDRESS.postalCode}, ${COMPANY_ADDRESS.addressCountry}`;

/** A scannable QR image (rendered via next/image, `unoptimized`) for LINE_URL. */
export function lineQrUrl(size = 220): string {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(
    LINE_URL
  )}`;
}
