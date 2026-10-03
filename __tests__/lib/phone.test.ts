// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { phoneParts, toThaiE164 } from '@/app/lib/phone';

const joined = (text: string) => phoneParts(text).map((p) => p.text).join('');
const links = (text: string) => phoneParts(text).filter((p) => p.href).map((p) => [p.text, p.href]);

describe('phoneParts — each number in the company phone becomes tap-to-call', () => {
  it('one number: one tel: link, in E.164', () => {
    expect(links('062-012-9895')).toEqual([['062-012-9895', 'tel:+66620129895']]);
  });

  it('two numbers: two links, the separator stays text', () => {
    expect(links('02-123-4567, 081-234-5678')).toEqual([
      ['02-123-4567', 'tel:+6621234567'],
      ['081-234-5678', 'tel:+66812345678'],
    ]);
    expect(links('02-123-4567 หรือ 081-234-5678')).toHaveLength(2);
  });

  it('gives the dialler no extension, but keeps it on screen', () => {
    expect(links('02-123-4567 ต่อ 12')).toEqual([['02-123-4567 ต่อ 12', 'tel:+6621234567']]);
  });

  it('"02-123-4567/8" links the first number and leaves "/8" as text', () => {
    expect(links('02-123-4567/8')).toEqual([['02-123-4567', 'tel:+6621234567']]);
  });

  it('a number already in international form is kept so', () => {
    expect(links('+66-62-012-9895')).toEqual([['+66-62-012-9895', 'tel:+66620129895']]);
  });

  it('anything that is not a phone number is not a link', () => {
    expect(links('โทร')).toEqual([]);
    expect(links('1234')).toEqual([]);
    expect(links('')).toEqual([]);
  });

  it.each(['02-123-4567, 081-234-5678', '02-123-4567/8', 'Tel. 02 123 4567 ต่อ 9', '+66-62-012-9895'])(
    'joined back, the parts are exactly what was typed: %p',
    (text) => {
      expect(joined(text)).toBe(text);
    }
  );

  it('toThaiE164 is still re-exported from settingsStore for its old importers', async () => {
    const store = await import('@/app/lib/settingsStore');
    expect(store.toThaiE164).toBe(toThaiE164);
  });
});

// A link must never dial a different number than the one on screen.
describe('phoneParts — only a number of the right shape is linked', () => {
  it.each([
    ['02-123-4567-8', 'a range written "4567-8": 10 digits from 2 would dial a wrong number'],
    ['081-234-567', 'a mobile number short by a digit'],
    ['02-1234-56789', 'a landline with digits to spare'],
    ['1800-123-456', 'a toll-free number, which is not +66 then the rest'],
  ])('%p stays text (%s)', (text) => {
    expect(links(text)).toEqual([]);
    expect(joined(text)).toBe(text);
  });

  it.each([
    ['053-123-456', 'tel:+6653123456'],
    ['099 999 9999', 'tel:+66999999999'],
    ['+1 415 555 0100', 'tel:+14155550100'],
  ])('%p is linked as %p', (text, href) => {
    expect(links(text)).toEqual([[text, href]]);
  });
});
