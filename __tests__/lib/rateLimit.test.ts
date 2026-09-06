// @vitest-environment node
//
// The shared in-memory limiter (app/lib/rateLimit.ts). Time is injected via
// check()'s `now` argument, so these tests never touch real clocks or timers.
import { describe, it, expect } from 'vitest';
import { createRateLimiter, clientKey } from '@/app/lib/rateLimit';

const WINDOW = 60_000;

describe('createRateLimiter', () => {
  it('allows exactly `limit` attempts inside one window', () => {
    const rl = createRateLimiter({ limit: 3, windowMs: WINDOW });

    const results = [rl.check('ip', 0), rl.check('ip', 1), rl.check('ip', 2)];
    expect(results.map((r) => r.allowed)).toEqual([true, true, true]);
    // `remaining` counts down to zero on the last allowed attempt.
    expect(results.map((r) => r.remaining)).toEqual([2, 1, 0]);
    expect(results.every((r) => r.retryAfterSeconds === 0)).toBe(true);
  });

  it('blocks the attempt past the ceiling and reports Retry-After', () => {
    const rl = createRateLimiter({ limit: 2, windowMs: WINDOW });
    rl.check('ip', 0);
    rl.check('ip', 0);

    const blocked = rl.check('ip', 0);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    // Whole seconds left in the window — what goes in the Retry-After header.
    expect(blocked.retryAfterSeconds).toBe(60);
  });

  it('never reports Retry-After 0 while blocked (a 0 would invite an instant retry)', () => {
    const rl = createRateLimiter({ limit: 1, windowMs: WINDOW });
    rl.check('ip', 0);
    // 1ms before the window expires: rounds up to 1s, not down to 0.
    expect(rl.check('ip', WINDOW - 1).retryAfterSeconds).toBe(1);
  });

  it('does not extend the window when a blocked caller keeps hammering', () => {
    const rl = createRateLimiter({ limit: 1, windowMs: WINDOW });
    rl.check('ip', 0);
    rl.check('ip', 30_000); // blocked, must not push expiry to 90_000
    expect(rl.check('ip', 59_999).allowed).toBe(false);
    expect(rl.check('ip', 60_000).allowed).toBe(true);
  });

  it('lets the caller through again once the window expires', () => {
    const rl = createRateLimiter({ limit: 2, windowMs: WINDOW });
    rl.check('ip', 0);
    rl.check('ip', 0);
    expect(rl.check('ip', WINDOW - 1).allowed).toBe(false);

    // At expiry the counter is gone and a full fresh allowance starts.
    const first = rl.check('ip', WINDOW);
    expect(first.allowed).toBe(true);
    expect(first.remaining).toBe(1);
    expect(rl.check('ip', WINDOW).allowed).toBe(true);
    expect(rl.check('ip', WINDOW).allowed).toBe(false);
  });

  it('keeps separate keys independent', () => {
    const rl = createRateLimiter({ limit: 1, windowMs: WINDOW });
    expect(rl.check('1.1.1.1', 0).allowed).toBe(true);
    expect(rl.check('1.1.1.1', 0).allowed).toBe(false);
    // A different IP is untouched by the first one's exhausted quota.
    expect(rl.check('2.2.2.2', 0).allowed).toBe(true);
    expect(rl.check('', 0).allowed).toBe(true);
    expect(rl.size()).toBe(3);
  });

  it('prunes expired entries so idle keys do not accumulate', () => {
    const rl = createRateLimiter({ limit: 5, windowMs: WINDOW });
    for (let i = 0; i < 50; i++) rl.check(`ip-${i}`, 0);
    expect(rl.size()).toBe(50);

    // One request after the window: everything expired is swept, leaving only
    // the key that just called.
    rl.check('late', WINDOW);
    expect(rl.size()).toBe(1);
  });

  it('bounds the map at maxTracked even with a flood of distinct live keys', () => {
    const rl = createRateLimiter({ limit: 5, windowMs: WINDOW, maxTracked: 10 });
    // 500 distinct keys inside one window — nothing is prunable by expiry, so
    // only the hard cap can hold the map down.
    for (let i = 0; i < 500; i++) rl.check(`flood-${i}`, 0);
    expect(rl.size()).toBeLessThanOrEqual(11); // cap, plus the key just inserted
    // The oldest keys are the ones evicted; the newest survive.
    expect(rl.check('flood-499', 0).remaining).toBe(3); // 2nd hit on a live entry
    expect(rl.check('flood-0', 0).remaining).toBe(4); // evicted → counted as new
  });

  it('reset() clears every counter', () => {
    const rl = createRateLimiter({ limit: 1, windowMs: WINDOW });
    rl.check('ip', 0);
    expect(rl.check('ip', 0).allowed).toBe(false);
    rl.reset();
    expect(rl.size()).toBe(0);
    expect(rl.check('ip', 0).allowed).toBe(true);
  });

  it('defaults `now` to the real clock when the caller omits it', () => {
    const rl = createRateLimiter({ limit: 1, windowMs: WINDOW });
    expect(rl.check('ip').allowed).toBe(true);
    expect(rl.check('ip').allowed).toBe(false);
  });
});

describe('clientKey', () => {
  it('uses the first x-forwarded-for entry', () => {
    const headers = new Headers({ 'x-forwarded-for': ' 9.9.9.9 , 10.0.0.1' });
    expect(clientKey({ headers })).toBe('9.9.9.9');
  });

  it('ignores the extra entries a spoofed multi-value header adds', () => {
    // Only the first entry is the key, so appending values cannot mint new
    // buckets and dodge the limit.
    const a = clientKey({
      headers: new Headers({ 'x-forwarded-for': '9.9.9.9, 10.0.0.1' }),
    });
    const b = clientKey({
      headers: new Headers({ 'x-forwarded-for': '9.9.9.9, 10.0.0.2, 10.0.0.3' }),
    });
    expect(a).toBe(b);
  });

  it('falls back to x-real-ip when x-forwarded-for is missing or empty', () => {
    // Keeps a header hiccup from collapsing every visitor into one shared
    // bucket, which on a public route is a self-inflicted outage.
    expect(clientKey({ headers: new Headers({ 'x-real-ip': '7.7.7.7' }) })).toBe(
      '7.7.7.7'
    );
    expect(
      clientKey({
        headers: new Headers({ 'x-forwarded-for': '  ', 'x-real-ip': ' 7.7.7.7 ' }),
      })
    ).toBe('7.7.7.7');
  });

  it('prefers x-forwarded-for over x-real-ip when both are present', () => {
    expect(
      clientKey({
        headers: new Headers({
          'x-forwarded-for': '9.9.9.9',
          'x-real-ip': '7.7.7.7',
        }),
      })
    ).toBe('9.9.9.9');
  });

  it('falls back to "unknown" only when no source header is usable', () => {
    expect(clientKey({ headers: new Headers() })).toBe('unknown');
    expect(clientKey({ headers: new Headers({ 'x-forwarded-for': '' }) })).toBe(
      'unknown'
    );
    expect(
      clientKey({
        headers: new Headers({ 'x-forwarded-for': '  ', 'x-real-ip': '' }),
      })
    ).toBe('unknown');
  });
});
