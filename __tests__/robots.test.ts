// @vitest-environment node
import { describe, it, expect } from 'vitest';
import robots from '@/app/robots';
import { config as middlewareConfig } from '@/middleware';

// Regression guard for the exact bug this test file exists to prevent: /crm
// and /expenses were gated by middleware but missing from robots.ts's
// disallow list, so they stayed crawlable/indexable despite requiring login.
// Compares the two hand-maintained lists directly instead of hardcoding
// expected paths, so a FUTURE gated route added to one list without the
// other fails here too.
describe('robots.ts disallow list vs middleware matcher', () => {
  it('disallows every base path that middleware gates behind login', () => {
    const { rules } = robots();
    const singleRule = Array.isArray(rules) ? rules[0] : rules;
    const disallow = ([] as string[]).concat(singleRule?.disallow ?? []);

    // Reduce the matcher's ['/x', '/x/:path*', ...] pairs to base paths.
    const gatedBasePaths = Array.from(
      new Set(
        middlewareConfig.matcher
          .filter((m) => !m.includes(':path*'))
      )
    );

    for (const path of gatedBasePaths) {
      expect(disallow, `middleware gates ${path} but robots.ts does not disallow it`).toContain(path);
    }
  });
});
