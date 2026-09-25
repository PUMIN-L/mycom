import { getProductsData } from "../lib/getProductsData";
import { contentIdFor } from "../lib/productLinks";
import {
  SITE_NAME,
  SITE_URL,
  SITE_DESCRIPTION,
  SITE_LEGAL_NAME,
  BRAND_ALT_NAMES,
  OPENING_HOURS,
} from "../lib/site";
import { LINE_URL } from "../lib/contact";
import { toThaiE164 } from "../lib/settingsStore";
import { getCompanyInfo } from "../lib/companyInfo";
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
  // contentIdByProduct maps each product to its canonical, INDEXABLE content
  // page — the same map the home grid links with. It is best-effort inside
  // getProductsData: a failed content read leaves it empty, never breaks this.
  const [{ products, contentIdByProduct }, companyInfo] = await Promise.all([
    getProductsData(),
    getCompanyInfo(),
  ]);

  // undefined when the product has no content page yet. The only other URL it
  // could carry is /showcase/product/{id}, and that gateway sets
  // robots: noindex — naming it here tells Google "this item lives at a URL you
  // may not index", which is a contradiction, not a lead. `url` is optional on
  // a Thing, so the item still contributes its name, description and image;
  // it just stops pointing at a door marked closed. Writing a content page for
  // the product is what gives it a real destination.
  const productUrl = (id: string) => {
    const contentId = contentIdFor(id, contentIdByProduct);
    return contentId ? `${SITE_URL}/showcase/${contentId}` : undefined;
  };

  // Rich Organization + Store (a LocalBusiness subtype) node: logo, physical
  // address, contact + LINE, so a real B2B supplier is eligible for the Google
  // knowledge panel / local results, not just a bare name. Email/phone/address
  // are admin-editable from /settings (getContactEmail/getCompanyProfile) —
  // this used to read hardcoded constants that never reflected a Settings-page
  // change.
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
    email: companyInfo.email,
    telephone: toThaiE164(companyInfo.profile.phone),
    address: {
      "@type": "PostalAddress",
      streetAddress: companyInfo.profile.addressStreet,
      addressLocality: companyInfo.profile.addressLocality,
      addressRegion: companyInfo.profile.addressRegion,
      postalCode: companyInfo.profile.addressPostalCode,
      addressCountry: companyInfo.profile.addressCountry,
    },
    areaServed: "TH",
    // The same Google Maps search the Contact page links to, from the address
    // in Settings — a location signal for local results.
    hasMap: companyInfo.addressMapsQuery
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(companyInfo.addressMapsQuery)}`
      : undefined,
    openingHoursSpecification: [
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: [...OPENING_HOURS.days],
        opens: OPENING_HOURS.opens,
        closes: OPENING_HOURS.closes,
      },
    ],
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
        // Deliberately "Thing", not "Product": Google requires a Product to
        // carry offers/review/aggregateRating to avoid a Search Console
        // error, but this is a B2B catalog with no public pricing — every
        // item would need a fabricated price to qualify, which risks a
        // manual action for misleading structured data. "Thing" carries the
        // same name/description/image/url for crawlability with no such
        // requirement; it just isn't eligible for the Product rich snippet.
        item: {
          "@type": "Thing",
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
