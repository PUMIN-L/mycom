// @vitest-environment jsdom
/**
 * Rich text is limited by its TEXT, the way the forms count it, and refused
 * when over — never cut by length of HTML. The cut ("…</span></stro") broke
 * the server-rendered page around it; the last block here renders the stored
 * value inside real page markup, as the server does, to prove it no longer can.
 */
import { describe, it, expect } from 'vitest';
import { cleanRichText, RichTextTooLongError, TITLE_LIMIT, DESCRIPTION_LIMIT } from '@/app/lib/richTextLimits';
import { repairTruncatedRichText, sanitizeRichText } from '@/app/lib/sanitizeHtml';
import { richTextHtml } from '@/app/lib/richTextDisplay';
import { stripHtml } from '@/app/lib/stripHtml';
import { ApiError } from '@/app/lib/apiHelpers';

// What the editor hands over for a bold, large title: every space as &nbsp;.
const editorTitle = (text: string) =>
  `<p><strong><span class="ql-size-large">${text.replace(/ /g, '&nbsp;')}</span></strong></p>`;
const BALANCE = 'Digital Analytical Balance 220g x 0.0001g with Internal Calibration';
const longTitle = (max: number) => {
  let text = '';
  while ((text + ' ' + BALANCE).length <= max) text = text ? `${text} ${BALANCE}` : BALANCE;
  return text;
};

describe('cleanRichText', () => {
  it('returns the whole sanitized HTML when the text fits, however long the HTML', () => {
    const raw = editorTitle(longTitle(203));
    const html = cleanRichText(raw, 'ชื่อสินค้า', TITLE_LIMIT);
    expect(html).toBe(sanitizeRichText(raw));
    expect(html.length).toBeGreaterThan(255);
    expect(stripHtml(html).length).toBe(203);
  });

  it('counts text exactly as the form does (stripHtml): &nbsp; and &amp; are one character each', () => {
    const raw = `<p>${'a&nbsp;&amp;'.repeat(85)}</p>`; // 255 characters typed
    expect(stripHtml(raw).length).toBe(255);
    expect(() => cleanRichText(raw, 'x', TITLE_LIMIT)).not.toThrow();
    expect(() => cleanRichText(`<p>${'a&nbsp;&amp;'.repeat(85)}b</p>`, 'x', TITLE_LIMIT)).toThrow(RichTextTooLongError);
  });

  it('refuses text over the limit with a 400 ApiError that names the field and the limit', () => {
    const attempt = () => cleanRichText(`<p>${'ก'.repeat(10_001)}</p>`, 'รายละเอียดสินค้า (ภาษาไทย)', DESCRIPTION_LIMIT);
    expect(attempt).toThrow(RichTextTooLongError);
    try {
      attempt();
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(400);
      expect((error as Error).message).toBe('รายละเอียดสินค้า (ภาษาไทย) ต้องมีความยาวไม่เกิน 10,000 ตัวอักษร');
    }
  });

  it('refuses HTML past what the column can hold, saying it is the formatting', () => {
    const raw = `<p>${'<strong>x</strong>'.repeat(200)}${'<em></em>'.repeat(2_000)}</p>`;
    expect(stripHtml(raw).length).toBe(200);
    expect(() => cleanRichText(raw, 'ชื่อสินค้า', TITLE_LIMIT)).toThrow(/จัดรูปแบบ.*มากเกินไป/);
  });

  it('keeps the HTML ceilings inside what a utf8mb4 TEXT / MEDIUMTEXT column holds', () => {
    expect(TITLE_LIMIT.html * 4).toBeLessThanOrEqual(65_535);
    expect(DESCRIPTION_LIMIT.html * 4).toBeLessThanOrEqual(16_777_215);
  });

  // TiDB refuses a row (an entry) over 6 MB. A product row — and its revision
  // snapshot — carries three titles and three descriptions, all at their
  // ceilings at once, with room left for everything else.
  it("keeps a whole product row, at every ceiling, well under TiDB's 6 MB entry limit", () => {
    const worstCaseBytes = 3 * TITLE_LIMIT.html * 4 + 3 * DESCRIPTION_LIMIT.html * 4;
    expect(worstCaseBytes).toBeLessThan(6 * 1024 * 1024 / 2);
  });

  it('turns empty or missing into "" (a cleared field), not an error', () => {
    expect(cleanRichText(undefined, 'x', TITLE_LIMIT)).toBe('');
    expect(cleanRichText('', 'x', DESCRIPTION_LIMIT)).toBe('');
  });
});

describe('repairTruncatedRichText', () => {
  it.each([
    ['a half-written closing tag', '<p><strong><span class="ql-size-large">Calibration</span></stro', '<p><strong><span class="ql-size-large">Calibration</span></strong></p>'],
    ['a half-written opening tag', '<p>A <a href="https://x.co" targ', '<p>A </p>'],
    ['elements left open', '<p><em>text', '<p><em>text</em></p>'],
    ['a half-written entity', '<p>A &amp; B &am', '<p>A &amp; B </p>'],
  ])('mends %s', (_label, stored, repaired) => {
    expect(repairTruncatedRichText(stored)).toBe(repaired);
  });

  // Stored titles keep the editor's &nbsp; as U+00A0 characters; sanitizing
  // again would turn them into spaces. That is not damage — null, no write.
  it('is null for well-formed stored HTML, U+00A0 included — the bootstrap leaves it alone', () => {
    const stored = sanitizeRichText(editorTitle(longTitle(180)));
    expect(stored).toContain(' ');
    expect(repairTruncatedRichText(stored)).toBeNull();
    expect(repairTruncatedRichText('<p>plain</p>')).toBeNull();
    expect(repairTruncatedRichText('Plain title, no tags')).toBeNull();
  });
});

// The symptom itself. The server renders the stored HTML between the page's
// own markup; a value cut mid-tag pulled what followed into the title.
describe('a stored title rendered inside the page', () => {
  const page = (stored: string) =>
    new DOMParser().parseFromString(
      `<main><h1 class="rich-text">${richTextHtml(stored)}</h1><p id="after">ราคาและสเปก</p><a id="contact" href="/contact">ติดต่อ</a></main>`,
      'text/html'
    );

  it('the OLD cut value swallows the rest of the page (what this fixes)', () => {
    const cut = sanitizeRichText(editorTitle(longTitle(203))).substring(0, 255);
    const doc = page(cut);
    expect(doc.querySelector('h1 #after')).not.toBeNull(); // pulled into the <h1>
  });

  it('what cleanRichText stores leaves the rest of the page alone', () => {
    const doc = page(cleanRichText(editorTitle(longTitle(203)), 'x', TITLE_LIMIT));
    expect(doc.querySelector('h1 #after')).toBeNull();
    expect(doc.querySelector('main > #after')).not.toBeNull();
    expect(doc.querySelector('#after strong')).toBeNull(); // no bold leaking out either
    expect(doc.querySelector('main > #contact')).not.toBeNull();
  });

  it('and so does an old cut value once the bootstrap has repaired it', () => {
    const cut = sanitizeRichText(editorTitle(longTitle(203))).substring(0, 255);
    const doc = page(repairTruncatedRichText(cut)!);
    expect(doc.querySelector('h1 #after')).toBeNull();
    expect(doc.querySelector('main > #after')).not.toBeNull();
  });
});
