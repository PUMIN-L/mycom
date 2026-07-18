// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';

// The existing __tests__/lib/session.test.ts covers encrypt/decrypt/create/
// delete/getSession. This file targets the ONE remaining uncovered branch: the
// module-load guard `if (!secretKey) throw new Error("SESSION_SECRET is not set")`
// (session.ts line 6), which only fires when the env var is absent at import.
describe('session module-load guard', () => {
  const original = process.env.SESSION_SECRET;

  afterEach(() => {
    // Restore the env var (setup.ts sets it) and drop the throwing module copy
    // so it can never leak into another test file's registry.
    if (original === undefined) {
      delete process.env.SESSION_SECRET;
    } else {
      process.env.SESSION_SECRET = original;
    }
    vi.resetModules();
  });

  it('throws at import when SESSION_SECRET is absent', async () => {
    vi.resetModules();
    delete process.env.SESSION_SECRET;

    await expect(import('@/app/lib/session')).rejects.toThrow('SESSION_SECRET is not set');
  });

  it('imports cleanly once SESSION_SECRET is set again', async () => {
    vi.resetModules();
    process.env.SESSION_SECRET = 'a-freshly-restored-secret-0123456789';

    const mod = await import('@/app/lib/session');
    expect(typeof mod.encrypt).toBe('function');
    expect(typeof mod.decrypt).toBe('function');
  });
});
