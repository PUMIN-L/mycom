import { getProductsData } from "../lib/getProductsData";
import { SITE_NAME, SITE_URL, SITE_DESCRIPTION } from "../lib/site";

// Server component that emits JSON-LD structured data for the catalogue.
// Rendered into the (streamed) HTML so search engines can read the product
// list and organisation info. Shares getProductsData()'s cached result, so it
// does NOT trigger an extra DB query.
export default async function ProductsJsonLd() {
  const { products } = await getProductsData();

  const organization = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    url: SITE_URL,
    description: SITE_DESCRIPTION,
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
      {products.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(itemList).replace(/</g, '\\u003c') }}
        />
      )}
    </>
  );
}
