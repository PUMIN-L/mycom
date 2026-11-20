/** The website's own logo — the file the site's header shows. */
export const SELLER_LOGO_SRC = "/images/profin-logo-3.png";

/**
 * The company logo in front of our company's name on every paper this module
 * prints — invoice / tax invoice, receipt, billing note, credit note (the
 * owner's request, 2026-11-20: the website's logo). A plain <img>, as on the
 * quotation's paper: a printed page wants the file itself, loaded at once,
 * not next/image's lazy, resized copy. Its width is fixed in millimetres, as
 * the quotation's is, so it prints the same size whatever the screen.
 */
export default function SellerLogo() {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={SELLER_LOGO_SRC}
      alt="โลโก้บริษัท"
      className="shrink-0 object-contain"
      style={{ width: "11mm", height: "auto" }}
    />
  );
}
