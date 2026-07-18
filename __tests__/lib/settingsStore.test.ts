// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the DB layer. `query()` resolves to a tuple `[rows|result, fields]`.
vi.mock('@/app/lib/db', () => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
  getDbConnection: vi.fn(),
}));
import { query } from '@/app/lib/db';

import {
  getSetting,
  setSetting,
  getContactEmail,
  CONTACT_EMAIL_SETTING,
} from '@/app/lib/settingsStore';
import { CONTACT_EMAIL } from '@/app/lib/contact';

describe('settingsStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('CONTACT_EMAIL_SETTING', () => {
    it('is the "contact_email" key', () => {
      expect(CONTACT_EMAIL_SETTING).toBe('contact_email');
    });
  });

  describe('getSetting', () => {
    it('returns the stored value when the row exists', async () => {
      vi.mocked(query).mockResolvedValue([[{ value: 'hello@x.com' }]] as any);

      const value = await getSetting('some_key');

      expect(value).toBe('hello@x.com');
      expect(vi.mocked(query).mock.calls[0][0]).toContain('SELECT value FROM settings');
      expect(vi.mocked(query).mock.calls[0][1]).toEqual(['some_key']);
    });

    it('coerces a non-string stored value to a string', async () => {
      vi.mocked(query).mockResolvedValue([[{ value: 123 }]] as any);
      expect(await getSetting('num')).toBe('123');
    });

    it('returns null when the setting is absent', async () => {
      vi.mocked(query).mockResolvedValue([[]] as any);
      expect(await getSetting('missing')).toBeNull();
    });
  });

  describe('setSetting', () => {
    it('upserts the name/value pair and resolves void', async () => {
      vi.mocked(query).mockResolvedValue([{ affectedRows: 1 }] as any);

      const result = await setSetting('contact_email', 'new@x.com');

      expect(result).toBeUndefined();
      expect(vi.mocked(query).mock.calls[0][0]).toContain(
        'ON DUPLICATE KEY UPDATE value = VALUES(value)'
      );
      expect(vi.mocked(query).mock.calls[0][1]).toEqual(['contact_email', 'new@x.com']);
    });
  });

  describe('getContactEmail', () => {
    it('returns the stored contact email when set', async () => {
      vi.mocked(query).mockResolvedValue([[{ value: 'custom@company.com' }]] as any);

      expect(await getContactEmail()).toBe('custom@company.com');
      // Reads the contact_email setting key.
      expect(vi.mocked(query).mock.calls[0][1]).toEqual([CONTACT_EMAIL_SETTING]);
    });

    it('falls back to the default constant when the setting is unset', async () => {
      vi.mocked(query).mockResolvedValue([[]] as any);
      expect(await getContactEmail()).toBe(CONTACT_EMAIL);
      expect(CONTACT_EMAIL).toBe('ampumin@gmail.com');
    });

    it('falls back to the default constant when the stored value is empty', async () => {
      vi.mocked(query).mockResolvedValue([[{ value: '' }]] as any);
      expect(await getContactEmail()).toBe(CONTACT_EMAIL);
    });
  });
});
