import { getProductsData } from "../lib/getProductsData";
import { getAllContentsMeta } from "../lib/contentStore";
import {
  SITE_NAME,
  SITE_URL,
  SITE_DESCRIPTION,
  SITE_LEGAL_NAME,
  BRAND_ALT_NAMES,
} from "../lib/site";
import { CONTACT_EMAIL, LINE_URL } from "../lib/contact";
import { stripHtml } from "../lib/stripHtml";

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
    // Tells Google the brand's other names/spellings (Thai transliterations +
    // legal name) so a Thai brand search can resolve to this entity.
    alternateName: BRAND_ALT_NAMES,
    legalName: SITE_LEGAL_NAME,
    url: SITE_URL,
    description: SITE_DESCRIPTION,
    logo: `${SITE_URL}/icon.png`,
    image: `${SITE_URL}/icon.png`,
    email: CONTACT_EMAIL,
    address: {
      "@type": "PostalAddress",
      streetAddress: "93 Soi Ngamwongwan 6 Yaek 19, Ngamwongwan Rd., Bang Khen",
      addressLocality: "Mueang Nonthaburi",
      addressRegion: "Nonthaburi",
      postalCode: "11000",
      addressCountry: "TH",
    },
    areaServed: "TH",
    sameAs: [LINE_URL],
    // Expertise areas — tells Google what this business knows about
    knowsAbout: [
      "เครื่องทดสอบแรงดึง (Tensile Tester / Universal Testing Machine)",
      "เครื่องทดสอบฟิล์ม (Film Testing Equipment)",
      "เครื่องทดสอบพลาสติก (Plastic Testing Equipment)",
      "เครื่องทดสอบบรรจุภัณฑ์ (Packaging Testing)",
      "เครื่องวัดค่า COF (Coefficient of Friction Tester)",
      "เครื่องทดสอบแรงปิดผนึก (Heat Seal Tester)",
      "เครื่องทดสอบแรงลอก (Peel Strength Tester)",
      "เครื่องทดสอบแรงกระแทก (Dart Impact Tester)",
      "เครื่องทดสอบ Melt Flow Index (MFI Tester)",
      "เครื่องวัดความหนาฟิล์ม (Film Thickness Gauge)",
      "เครื่องทดสอบการหดตัว (Shrinkage Tester)",
      "เครื่องวัดความหนืด (Viscometer)",
      "เครื่องวัดสี (Colorimeter / Spectrophotometer)",
      "เครื่องวัดความเงา (Gloss Meter)",
      "เครื่องวัดความแข็ง (Hardness Tester / Durometer)",
      "เครื่องชั่งวิเคราะห์ (Analytical Balance)",
      "เครื่องชั่งความละเอียดสูง (Precision Balance)",
      "ตู้อบลมร้อน (Laboratory Oven)",
      "ตู้อบสุญญากาศ (Vacuum Oven)",
      "เครื่องทดสอบการรั่วซึม (Leak Tester)",
      "เครื่องทดสอบยาง (Rubber Testing)",
      "เครื่องทดสอบสิ่งทอ (Textile Testing)",
      "เครื่องทดสอบกระดาษ (Paper Testing)",
      "สอบเทียบเครื่องมือวัด (Calibration)",
      "ซ่อมบำรุงเครื่องทดสอบ (Repair & Maintenance)",
      "ติดตั้งและสอนการใช้งาน (Installation & Training)",
      "สร้างห้องปฏิบัติการ (Laboratory Construction)",
    ],
    // Services offered
    hasOfferCatalog: {
      "@type": "OfferCatalog",
      name: "บริการของ Profin Lab Scale",
      itemListElement: [
        {
          "@type": "OfferCatalog",
          name: "จำหน่ายเครื่องมือวัดและทดสอบ",
          description: "จำหน่ายเครื่อง tensile tester, เครื่องทดสอบฟิล์ม, เครื่องทดสอบพลาสติก, เครื่องทดสอบ COF, เครื่องวัดสี, เครื่องชั่ง, ตู้อบ และอื่นๆ",
        },
        {
          "@type": "OfferCatalog",
          name: "สอบเทียบเครื่องมือวัด (Calibration)",
          description: "บริการสอบเทียบเครื่องมือวัดและเครื่องทดสอบตามมาตรฐานสากล",
        },
        {
          "@type": "OfferCatalog",
          name: "ติดตั้งและสอนการใช้งาน",
          description: "บริการติดตั้งเครื่องทดสอบและฝึกอบรมการใช้งานเครื่องมือวัดให้กับทีมงานของลูกค้า",
        },
        {
          "@type": "OfferCatalog",
          name: "ออกแบบและสร้างห้องปฏิบัติการ (Lab Construction)",
          description: "บริการออกแบบและสร้างห้อง Lab ตามมาตรฐานสากลสำหรับอุตสาหกรรม",
        },
      ],
    },
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
      const name = stripHtml(p.title_en || p.title_th || p.title_zh || "");
      const alternateName = [p.title_th, p.title_zh]
        .map(n => n ? stripHtml(n) : "")
        .filter((n): n is string => Boolean(n) && n !== name);
      return {
        "@type": "ListItem",
        position: i + 1,
        item: {
          "@type": "Product",
          name, // English-first so EN searches match
          alternateName: alternateName.length ? alternateName : undefined,
          description: stripHtml(p.desc_en || p.desc_th || p.desc_zh || "") || undefined,
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
