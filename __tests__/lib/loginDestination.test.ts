// @vitest-environment node
/**
 * Where /login sends someone once they are in (app/lib/loginDestination.ts):
 * the page they were sent away from — a sticker's QR, typically — when it is
 * a page of this site, and the admin panel otherwise. `next` comes from the
 * address bar, so nothing may lead to another site.
 */
import { describe, it, expect } from 'vitest';
import { loginDestination } from '@/app/lib/loginDestination';

describe('loginDestination', () => {
  it('follows a page of this site, keeping its query and hash', () => {
    expect(loginDestination('/stock/item/abc-123')).toBe('/stock/item/abc-123');
    expect(loginDestination('/assets/labels?ids=a,b#top')).toBe('/assets/labels?ids=a,b#top');
  });

  it('nothing given: the admin panel', () => {
    expect(loginDestination(null)).toBe('/adminpanel');
    expect(loginDestination('')).toBe('/adminpanel');
  });

  it.each([
    '//evil.example/x',
    '/\\evil.example/x',
    '/\t/evil.example',
    'https://evil.example/',
    'javascript:alert(1)',
    'stock/item/abc',
    '/login',
    '/login?next=/stock',
  ])('never %s', (next) => {
    expect(loginDestination(next)).toBe('/adminpanel');
  });
});
