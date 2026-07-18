// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { localize } from '@/app/lib/localize';

// These cases target branches the existing __tests__/lib/localize.test.ts does
// NOT exercise: unknown field names, non-string column values, and the
// distinction between a MISSING column and an explicit empty-string column.
describe('localize (branch gaps)', () => {
  describe('unknown field name', () => {
    const record = { title_th: 'TH', title_en: 'EN', title_zh: 'ZH' };

    it('returns "" for every language when no column matches the field', () => {
      expect(localize(record, 'subtitle', 'th')).toBe('');
      expect(localize(record, 'subtitle', 'en')).toBe('');
      expect(localize(record, 'subtitle', 'zh')).toBe('');
    });
  });

  describe('explicit empty-string columns still fall back', () => {
    it('zh: empty zh falls through to en then th', () => {
      expect(localize({ title_zh: '', title_en: 'EN', title_th: 'TH' }, 'title', 'zh')).toBe('EN');
      expect(localize({ title_zh: '', title_en: '', title_th: 'TH' }, 'title', 'zh')).toBe('TH');
    });

    it('en: empty en falls through to th', () => {
      expect(localize({ title_en: '', title_th: 'TH' }, 'title', 'en')).toBe('TH');
    });

    it('th: empty th falls through to en then zh', () => {
      expect(localize({ title_th: '', title_en: 'EN' }, 'title', 'th')).toBe('EN');
      expect(localize({ title_th: '', title_en: '', title_zh: 'ZH' }, 'title', 'th')).toBe('ZH');
    });
  });

  describe('non-string column values', () => {
    it('treats falsy non-strings (0) as absent and falls back', () => {
      expect(localize({ title_en: 0, title_th: 'TH' } as unknown as object, 'title', 'en')).toBe('TH');
      // All falsy -> empty string.
      expect(localize({ title_th: 0, title_en: 0, title_zh: 0 } as unknown as object, 'title', 'zh')).toBe('');
    });

    it('coerces a truthy non-string value to a string (honours the string return type)', () => {
      // A truthy number/boolean is stringified via String(v) rather than leaking
      // through the cast, so the `: string` signature always holds.
      expect(localize({ title_en: 42 } as unknown as object, 'title', 'en')).toBe('42');
      expect(localize({ title_th: true } as unknown as object, 'title', 'th')).toBe('true');
    });
  });
});
