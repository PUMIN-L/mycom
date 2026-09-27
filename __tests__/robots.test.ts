// @vitest-environment node
import { describe, it, expect } from 'vitest';
import robots from '@/app/robots';
import { config as proxyConfig } from '@/proxy';

// Regression guard for the exact bug this test file exists to prevent: /crm
// and /expenses were gated by proxy.ts (then middleware.ts) but missing from robots.ts's
// disallow list, so they stayed crawlable/indexable despite requiring login.
// Compares the two hand-maintained lists directly instead of hardcoding
// expected paths, so a FUTURE gated route added to one list without the
// other fails here too.
describe('robots.ts disallow list vs proxy.ts matcher', () => {
  it('disallows every base path that proxy.ts gates behind login', () => {
    const { rules } = robots();
    const singleRule = Array.isArray(rules) ? rules[0] : rules;
    const disallow = ([] as string[]).concat(singleRule?.disallow ?? []);

    // Reduce the matcher's ['/x', '/x/:path*', ...] pairs to base paths.
    const gatedBasePaths = Array.from(
      new Set(
        proxyConfig.matcher
          .filter((m) => !m.includes(':path*'))
      )
    );

    for (const path of gatedBasePaths) {
      expect(disallow, `proxy.ts gates ${path} but robots.ts does not disallow it`).toContain(path);
    }
  });
});

describe('robots.ts — PDF catalogs', () => {
  it('lets crawlers read the PDF proxy while the rest of /api/ stays blocked', () => {
    const rules = robots().rules;
    const rule = Array.isArray(rules) ? rules[0] : rules;
    expect(([] as string[]).concat(rule?.allow ?? [])).toContain('/api/documents/proxy');
    expect(([] as string[]).concat(rule?.disallow ?? [])).toContain('/api/');
  });
});
