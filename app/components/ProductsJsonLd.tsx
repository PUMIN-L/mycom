import { getProductsData } from "../lib/getProductsData";
import { SITE_NAME, SITE_URL, SITE_DESCRIPTION } from "../lib/site";
import { CONTACT_EMAIL, LINE_URL } from "../lib/contact";

// Server component that emits JSON-LD structured data for the catalogue.
// Rendered into the (streamed) HTML so search engines can read the product
// list and organisation info. Shares getProductsData()'s cached result, so it
// does NOT trigger an extra DB query.
export default async function ProductsJsonLd() {
  const { products } = await getProductsData();

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
    itemListElement: products.map((p, i) => ({
      "@type": "ListItem",
      position: i + 1,
      item: {
        "@type": "Product",
        name: p.title_th || p.title_en || p.title_zh,
        description: p.desc_th || p.desc_en || p.desc_zh || undefined,
        image: p.image || undefined,
        url: `${SITE_URL}/showcase/product/${p.id}`,
      },
    })),
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
