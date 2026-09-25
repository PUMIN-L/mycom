// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/app/lib/getProductsData', () => ({ getProductsData: vi.fn() }));
vi.mock('@/app/lib/companyInfo', () => ({ getCompanyInfo: vi.fn() }));

import ProductsJsonLd from '@/app/components/ProductsJsonLd';
import { getProductsData } from '@/app/lib/getProductsData';
import { getCompanyInfo } from '@/app/lib/companyInfo';
import { SITE_URL } from '@/app/lib/site';

// The component returns a fragment of <script> tags whose payload is a JSON
// string; pull those strings out rather than rendering to a DOM.
async function renderedJsonLd(): Promise<string[]> {
  const element: any = await (ProductsJsonLd as any)();
  const scripts = element.props.children.flat().filter(Boolean);
  return scripts
    .filter((s: any) => s && s.props?.dangerouslySetInnerHTML)
    .map((s: any) => s.props.dangerouslySetInnerHTML.__html);
}

const product = (id: string) => ({
  id,
  title_en: `Tester ${id}`,
  title_th: '',
  title_zh: '',
  desc_en: 'desc',
  image: '/images/x.png',
});

describe('ProductsJsonLd — ItemList URLs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCompanyInfo).mockResolvedValue({
      email: 'info@example.com',
      profile: {
        phone: '021234567',
        addressStreet: 'ถนนทดสอบ',
        addressLocality: 'เขตทดสอบ',
        addressRegion: 'กรุงเทพมหานคร',
        addressPostalCode: '10000',
        addressCountry: 'TH',
      },
    } as any);
  });

  it('never points a structured-data item at the noindex gateway', async () => {
    // /showcase/product/{id} sets robots: noindex. Naming it here would tell
    // Google "this item lives at a URL you may not index" — a contradiction that
    // wastes the only crawlable channel these products have. This is the exact
    // regression to catch: restoring that fallback looks harmless in a diff.
    vi.mocked(getProductsData).mockResolvedValue({
      products: [product('p-with'), product('p-without')],
      categories: [],
      contentIdByProduct: { 'p-with': 'c-1' },
    } as any);

    const payloads = await renderedJsonLd();
    const itemList = payloads.map((p) => JSON.parse(p)).find((j) => j['@type'] === 'ItemList');

    expect(itemList).toBeDefined();
    expect(JSON.stringify(itemList)).not.toContain('/showcase/product/');
  });

  it('keeps a product that has no content page, minus the url', async () => {
    // Dropping the product entirely would lose the only structured-data record
    // of it; `url` is optional on a Thing, so the name/description/image stay.
    vi.mocked(getProductsData).mockResolvedValue({
      products: [product('p-with'), product('p-without')],
      categories: [],
      contentIdByProduct: { 'p-with': 'c-1' },
    } as any);

    const payloads = await renderedJsonLd();
    const itemList: any = payloads
      .map((p) => JSON.parse(p))
      .find((j) => j['@type'] === 'ItemList');

    expect(itemList.itemListElement).toHaveLength(2);
    const [withContent, withoutContent] = itemList.itemListElement;
    expect(withContent.item.url).toBe(`${SITE_URL}/showcase/c-1`);
    expect(withoutContent.item.url).toBeUndefined();
    expect(withoutContent.item.name).toBe('Tester p-without');
  });

  it('emits items without urls when no product has a content page', async () => {
    // Also what a failed content read looks like: getProductsData degrades to
    // an empty map (tested there). It must not put gateway URLs back in.
    vi.mocked(getProductsData).mockResolvedValue({
      products: [product('p-1')],
      categories: [],
      contentIdByProduct: {},
    } as any);

    const payloads = await renderedJsonLd();
    expect(payloads.join(' ')).not.toContain('/showcase/product/');
  });
});

describe('ProductsJsonLd — Organization location', () => {
  const company = (addressMapsQuery: string) => ({
    email: 'info@example.com',
    addressMapsQuery,
    profile: {
      phone: '021234567',
      addressStreet: '93 ซอยงามวงศ์วาน 6',
      addressLocality: 'บางเขน',
      addressRegion: 'นนทบุรี',
      addressPostalCode: '11000',
      addressCountry: 'TH',
    },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getProductsData).mockResolvedValue({ products: [], categories: [], contentIdByProduct: {} } as never);
  });

  it('links the Google Maps search for the address in Settings (hasMap)', async () => {
    vi.mocked(getCompanyInfo).mockResolvedValue(company('93 ซอยงามวงศ์วาน 6, บางเขน, นนทบุรี 11000, TH') as never);
    const org = (await renderedJsonLd()).map((p) => JSON.parse(p)).find((j) => j['@id']?.endsWith('#organization'));
    expect(org.hasMap).toBe(
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('93 ซอยงามวงศ์วาน 6, บางเขน, นนทบุรี 11000, TH')}`
    );
  });

  it('states the business hours: Monday to Friday, 08:30 to 17:00', async () => {
    vi.mocked(getCompanyInfo).mockResolvedValue(company('') as never);
    const org = (await renderedJsonLd()).map((p) => JSON.parse(p)).find((j) => j['@id']?.endsWith('#organization'));
    expect(org.openingHoursSpecification).toEqual([
      {
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
        opens: '08:30',
        closes: '17:00',
      },
    ]);
  });

  it('leaves hasMap out when there is no address', async () => {
    vi.mocked(getCompanyInfo).mockResolvedValue(company('') as never);
    const org = (await renderedJsonLd()).map((p) => JSON.parse(p)).find((j) => j['@id']?.endsWith('#organization'));
    expect(org).not.toHaveProperty('hasMap');
  });
});
