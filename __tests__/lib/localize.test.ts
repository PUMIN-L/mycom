import { describe, it, expect } from 'vitest';
import { localize } from '@/app/lib/localize';

describe('localize', () => {
  const mockRecord = {
    title_th: 'ภาษาไทย',
    title_en: 'English',
    title_zh: '中文',
  };

  it('should return the requested language if it exists', () => {
    expect(localize(mockRecord, 'title', 'th')).toBe('ภาษาไทย');
    expect(localize(mockRecord, 'title', 'en')).toBe('English');
    expect(localize(mockRecord, 'title', 'zh')).toBe('中文');
  });

  it('should fallback correctly for "zh"', () => {
    // Missing zh, should fallback to en -> th
    expect(localize({ title_en: 'English', title_th: 'ภาษาไทย' }, 'title', 'zh')).toBe('English');
    expect(localize({ title_th: 'ภาษาไทย' }, 'title', 'zh')).toBe('ภาษาไทย');
    // Missing all, return empty string
    expect(localize({}, 'title', 'zh')).toBe('');
  });

  it('should fallback correctly for "en"', () => {
    // Missing en, should fallback to th
    expect(localize({ title_th: 'ภาษาไทย', title_zh: '中文' }, 'title', 'en')).toBe('ภาษาไทย');
    // Missing all, return empty string
    expect(localize({}, 'title', 'en')).toBe('');
  });

  it('should fallback correctly for "th"', () => {
    // Missing th, should fallback to en -> zh
    expect(localize({ title_en: 'English', title_zh: '中文' }, 'title', 'th')).toBe('English');
    expect(localize({ title_zh: '中文' }, 'title', 'th')).toBe('中文');
    // Missing all, return empty string
    expect(localize({}, 'title', 'th')).toBe('');
  });

  it('handles unexpected types safely (e.g. nulls as empty)', () => {
    expect(localize({ title_th: null, title_en: undefined }, 'title', 'th')).toBe('');
  });
});
