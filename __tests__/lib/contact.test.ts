// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { LINE_ID, LINE_URL, CONTACT_EMAIL, lineQrUrl } from '@/app/lib/contact';

describe('contact', () => {
  describe('constants', () => {
    it('exposes the LINE id, deep link and contact email', () => {
      expect(LINE_ID).toBe('@puminkmutnb');
      expect(LINE_URL).toBe('https://line.me/ti/p/~puminkmutnb');
      expect(CONTACT_EMAIL).toBe('ampumin@gmail.com');
    });
  });

  describe('lineQrUrl', () => {
    it('defaults to a 220x220 QR that encodes LINE_URL', () => {
      const url = lineQrUrl();
      expect(url).toBe(
        `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(LINE_URL)}`
      );
    });

    it('produces a well-formed URL whose data param decodes back to LINE_URL', () => {
      const u = new URL(lineQrUrl());
      expect(u.protocol).toBe('https:');
      expect(u.hostname).toBe('api.qrserver.com');
      expect(u.pathname).toBe('/v1/create-qr-code/');
      expect(u.searchParams.get('size')).toBe('220x220');
      // URLSearchParams decodes the percent-encoding, so it must round-trip.
      expect(u.searchParams.get('data')).toBe(LINE_URL);
    });

    it('honours a custom size', () => {
      const url = lineQrUrl(500);
      expect(url).toBe(
        `https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=${encodeURIComponent(LINE_URL)}`
      );

      const u = new URL(url);
      expect(u.searchParams.get('size')).toBe('500x500');
      expect(u.searchParams.get('data')).toBe(LINE_URL);
    });

    it('percent-encodes the reserved characters of LINE_URL in the query string', () => {
      const url = lineQrUrl();
      // ':' and '/' must be escaped inside the query so the QR encodes the exact link.
      expect(url).toContain('data=https%3A%2F%2Fline.me%2Fti%2Fp%2F~puminkmutnb');
      expect(url).not.toContain('data=https://line.me');
    });
  });
});
