// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// site.ts resolves SITE_URL from process.env AT IMPORT TIME, so each test must
// set env first, then dynamically import a fresh copy of the module.
const ENV_KEYS = [
  'NEXT_PUBLIC_SITE_URL',
  'VERCEL_PROJECT_PRODUCTION_URL',
  'VERCEL_URL',
] as const;

type SiteModule = typeof import('@/app/lib/site');

const saved: Record<string, string | undefined> = {};

async function loadSite(env: Partial<Record<(typeof ENV_KEYS)[number], string>>): Promise<SiteModule> {
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(env)) process.env[key] = value;
  vi.resetModules();
  return import('@/app/lib/site');
}

describe('site', () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) saved[key] = process.env[key];
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    vi.resetModules();
  });

  describe('resolveSiteUrl / SITE_URL', () => {
    it('prefers NEXT_PUBLIC_SITE_URL over every Vercel var', async () => {
      const { SITE_URL } = await loadSite({
        NEXT_PUBLIC_SITE_URL: 'https://custom.example.com',
        VERCEL_PROJECT_PRODUCTION_URL: 'prod.vercel.app',
        VERCEL_URL: 'preview.vercel.app',
      });
      expect(SITE_URL).toBe('https://custom.example.com');
    });

    it('strips a single trailing slash from the explicit override', async () => {
      const { SITE_URL } = await loadSite({ NEXT_PUBLIC_SITE_URL: 'https://custom.example.com/' });
      expect(SITE_URL).toBe('https://custom.example.com');
    });

    it('strips multiple trailing slashes', async () => {
      const { SITE_URL } = await loadSite({ NEXT_PUBLIC_SITE_URL: 'https://custom.example.com///' });
      expect(SITE_URL).toBe('https://custom.example.com');
    });

    it('prepends https:// when the override has no protocol', async () => {
      const { SITE_URL } = await loadSite({ NEXT_PUBLIC_SITE_URL: 'custom.example.com' });
      expect(SITE_URL).toBe('https://custom.example.com');
    });

    it('preserves an explicit http:// protocol (does not force https)', async () => {
      const { SITE_URL } = await loadSite({ NEXT_PUBLIC_SITE_URL: 'http://localhost:8080/' });
      expect(SITE_URL).toBe('http://localhost:8080');
    });

    it('falls back to VERCEL_PROJECT_PRODUCTION_URL (adding https) when the override is absent', async () => {
      const { SITE_URL } = await loadSite({
        VERCEL_PROJECT_PRODUCTION_URL: 'my-project.vercel.app',
        VERCEL_URL: 'preview.vercel.app',
      });
      expect(SITE_URL).toBe('https://my-project.vercel.app');
    });

    it('falls back to VERCEL_URL when the first two are absent', async () => {
      const { SITE_URL } = await loadSite({ VERCEL_URL: 'preview-abc123.vercel.app' });
      expect(SITE_URL).toBe('https://preview-abc123.vercel.app');
    });

    it('falls back to http://localhost:3000 when nothing is set', async () => {
      const { SITE_URL } = await loadSite({});
      expect(SITE_URL).toBe('http://localhost:3000');
    });
  });

  describe('static metadata constants', () => {
    it('exposes the site name, title, description and keywords', async () => {
      const mod = await loadSite({});
      expect(mod.SITE_NAME).toBe('Profin Lab Scale');
      expect(mod.SITE_TITLE).toBe('PROFIN | เครื่องมือทดสอบและสร้างห้องปฏิบัติการ');
      expect(mod.SITE_DESCRIPTION).toContain('Profin Lab scale');
      expect(Array.isArray(mod.SITE_KEYWORDS)).toBe(true);
      expect(mod.SITE_KEYWORDS).toContain('hardness tester');
      expect(mod.SITE_KEYWORDS.length).toBe(10);
    });
  });
});
