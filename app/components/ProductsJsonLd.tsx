import { getProductsData } from "../lib/getProductsData";
import { getAllContentsMeta } from "../lib/contentStore";
import { SITE_NAME, SITE_URL, SITE_DESCRIPTION } from "../lib/site";
import { CONTACT_EMAIL, LINE_URL } from "../lib/contact";

// Absolute URL for structured data (relative /images/... and Cloudinary URLs).
function absUrl(u: string): string {
  return /^https?:\/\//.test(u) ? u : `${SITE_URL}${u.startsWith("/") ? "" : "/"}${u}`;
}

// Server component that emits JSON-LD structured data for the catalogue.
// Rendered into the (streamed) HTML so search engines can read the product
// list and organisation info. Product names are emitted ENGLISH-FIRST (with the
// Thai/Chinese names as alternateName) because customers — including Thai B2B
// buyers — search equipment by its English name, and the JSON-LD is the reliable
// crawlable channel (the visible grid streams in client-side).
export default async function ProductsJsonLd() {
  // getContentsMeta is best-effort enrichment (deep-links); a failure must never
  // break the page, so fall back to an empty map (→ gateway URLs).
  const [{ products }, contentsMeta] = await Promise.all([
    getProductsData(),
    getAllContentsMeta().catch(() => []),
  ]);

  // Map each product to its canonical, INDEXABLE content page so the ItemList
  // links to a real destination instead of the noindex /showcase/product gateway.
  const contentByProduct = new Map<string, string>();
  for (const c of contentsMeta) {
    if (c.productId && !contentByProduct.has(c.productId)) {
      contentByProduct.set(c.productId, c.id);
    }
  }
  const productUrl = (id: string) => {
    const contentId = contentByProduct.get(id);
    return contentId
      ? `${SITE_URL}/showcase/${contentId}`
      : `${SITE_URL}/showcase/product/${id}`;
  };

  // Rich Organization + Store (a LocalBusiness subtype) node: logo, physical
  // address, contact + LINE, so a real B2B supplier is eligible for the Google
  // knowledge panel / local results, not just a bare name. (Phone is omitted —
  // the stored number is still a placeholder; a wrong tel in structured data is
  // worse than none.)
  const organization = {
    "@context": "https://schema.org",
    "@type": ["Organization", "Store"],
    "@id": `${SITE_URL}/#organization`,
    name: SITE_NAME,
    url: SITE_URL,
    description: SITE_DESCRIPTION,
    logo: `${SITE_URL}/icon.png`,
    image: `${SITE_URL}/icon.png`,
    email: CONTACT_EMAIL,
    address: {
      "@type": "PostalAddress",
      streetAddress: "89/99 Tiwanon Rd., Bang Kra Sor",
      addressLocality: "Mueang Nonthaburi",
      addressRegion: "Nonthaburi",
      postalCode: "11000",
      addressCountry: "TH",
    },
    areaServed: "TH",
    sameAs: [LINE_URL],
  };

  const website = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${SITE_URL}/#website`,
    name: SITE_NAME,
    url: SITE_URL,
    publisher: { "@id": `${SITE_URL}/#organization` },
    inLanguage: ["th", "en", "zh"],
  };

  const itemList = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Products",
    numberOfItems: products.length,
    itemListElement: products.map((p, i) => {
      const name = p.title_en || p.title_th || p.title_zh;
      const alternateName = [p.title_th, p.title_zh].filter(
        (n): n is string => Boolean(n) && n !== name
      );
      return {
        "@type": "ListItem",
        position: i + 1,
        item: {
          "@type": "Product",
          name, // English-first so EN searches match
          alternateName: alternateName.length ? alternateName : undefined,
          description: p.desc_en || p.desc_th || p.desc_zh || undefined,
          image: p.image ? absUrl(p.image) : undefined,
          url: productUrl(p.id),
        },
      };
    }),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organization).replace(/</g, '\\u003c') }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(website).replace(/</g, '\\u003c') }}
      />
      {products.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(itemList).replace(/</g, '\\u003c') }}
        />
      )}
    </>
  );
}
