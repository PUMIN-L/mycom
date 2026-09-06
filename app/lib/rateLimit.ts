// Small in-memory rate limiter, extracted from the copy-pasted Map + prune
// block that app/api/contact/route.ts, app/api/auth/login/route.ts and
// app/api/upload/route.ts each carry their own version of. Those three are
// deliberately NOT migrated yet (login's copy sits next to the security-critical
// lockout); this is the shared implementation new call sites should use.
//
// ── THE HONEST LIMITATION ───────────────────────────────────────────────────
// This counts in the process's own memory. On Vercel every serverless instance
// gets its OWN memory, so the counter is PER INSTANCE, not global: with N warm
// instances the real ceiling a distributed caller sees is roughly (limit × N),
// and an instance that scales to zero forgets every counter it held. It is
// therefore NOT a security boundary and must never be the only thing standing
// between an attacker and something expensive or destructive.
//
// What it does buy, for zero infrastructure: it stops a naive single-source
// flood — one script looping one endpoint from one IP — which is the realistic
// abuse for the public routes here. That is the whole claim.
//
// A genuinely global limit needs shared state. In this project the two options
// are (a) a counter table in the existing TiDB/MySQL via app/lib/db.ts — no new
// vendor, but a DB round-trip on every request to the limited route — or
// (b) Upstash Redis (@upstash/ratelimit), which is the usual Vercel answer and
// is fast, but adds a service and two env vars. Pick one deliberately when a
// route actually needs a hard global cap; do not assume this file provides it.

export interface RateLimitResult {
  /** False when the caller has already used its full allowance this window. */
  allowed: boolean;
  /** Attempts left in the current window after this one (0 when blocked). */
  remaining: number;
  /**
   * Whole seconds until the caller's window resets. 0 when allowed — meant for
   * the `Retry-After` header on a 429.
   */
  retryAfterSeconds: number;
}

export interface RateLimiter {
  /**
   * Record an attempt for `key` (typically a client IP or user id) and say
   * whether it is allowed. An allowed call CONSUMES one unit of the allowance;
   * a blocked call does not extend the window, so a caller that keeps hammering
   * is still released on schedule.
   *
   * `now` is injectable purely so tests can advance the clock without fake
   * timers; production callers omit it.
   */
  check(key: string, now?: number): RateLimitResult;
  /** Number of keys currently tracked. Exposed for tests/diagnostics. */
  size(): number;
  /** Drop all counters. Test helper; nothing in the app calls it. */
  reset(): void;
}

export interface RateLimitOptions {
  /** Allowed attempts per key per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /**
   * Hard cap on tracked keys, so a flood of distinct keys (spoofed
   * x-forwarded-for, say) cannot grow the Map without bound and OOM the
   * instance. Expired entries are pruned first; if that is not enough, the
   * oldest-inserted keys are evicted. Eviction means a hostile key-flood can
   * push a real caller's counter out — accepted, because a bounded map that
   * occasionally forgets beats an unbounded one that crashes the process.
   */
  maxTracked?: number;
}

const DEFAULT_MAX_TRACKED = 10_000;

export function createRateLimiter({
  limit,
  windowMs,
  maxTracked = DEFAULT_MAX_TRACKED,
}: RateLimitOptions): RateLimiter {
  const hits = new Map<string, { count: number; expiresAt: number }>();

  // Pruning is done per request rather than on a timer: a serverless instance
  // can be frozen between requests, so a setInterval would be unreliable and
  // would also keep the instance alive.
  function prune(now: number) {
    for (const [key, rec] of hits) {
      if (rec.expiresAt <= now) hits.delete(key);
    }
    if (hits.size > maxTracked) {
      let excess = hits.size - maxTracked;
      // Map iterates in insertion order, so this drops the oldest keys first.
      for (const key of hits.keys()) {
        if (excess-- <= 0) break;
        hits.delete(key);
      }
    }
  }

  return {
    check(key: string, now: number = Date.now()): RateLimitResult {
      prune(now);
      const rec = hits.get(key);
      const live = rec && rec.expiresAt > now ? rec : undefined;

      if (live && live.count >= limit) {
        return {
          allowed: false,
          remaining: 0,
          retryAfterSeconds: Math.max(1, Math.ceil((live.expiresAt - now) / 1000)),
        };
      }

      const count = (live?.count ?? 0) + 1;
      // The window starts at the FIRST attempt and is not extended by later
      // ones: a fixed window, so a blocked caller always gets out eventually.
      const expiresAt = live?.expiresAt ?? now + windowMs;
      hits.set(key, { count, expiresAt });
      return { allowed: true, remaining: limit - count, retryAfterSeconds: 0 };
    },
    size() {
      return hits.size;
    },
    reset() {
      hits.clear();
    },
  };
}

/**
 * Best-effort client identity for rate-limiting: the first x-forwarded-for
 * entry, then x-real-ip, else the shared "unknown" bucket.
 *
 * NOT identity, and not to be treated as such. x-forwarded-for is a
 * client-settable header in the general case; Vercel overwrites it at the edge,
 * but nothing inside this process can verify that, and the same code runs in
 * local dev and behind any other proxy. app/api/contact/route.ts states the
 * same caveat about its own copy — keep the two honest with each other.
 *
 * Two consequences that matter when choosing a `limit`:
 *  - One key can be MANY people. Carrier-grade NAT and corporate egress put
 *    hundreds of unrelated visitors behind a single address, so a tight ceiling
 *    on a public route rejects real users, not just abusers.
 *  - Everything that resolves to "unknown" shares ONE bucket. If a deploy ever
 *    stops setting these headers, every visitor lands in that single bucket and
 *    a public route rate-limits itself into an outage. x-real-ip (also set by
 *    Vercel) is consulted as a second source specifically to make that harder.
 */
export function clientKey(request: { headers: Headers }): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  const real = request.headers.get("x-real-ip")?.trim();
  if (real) return real;
  return "unknown";
}
