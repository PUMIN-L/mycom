// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { withRoute } from '@/app/lib/apiHelpers';

// The existing __tests__/lib/apiHelpers.test.ts already covers ApiError,
// jsonError, requireAuth, withRoute happy/ApiError/unknown-error paths, the
// cross-origin (host-mismatch) refusal and the same-origin allow. This file
// fills the REMAINING branches of `crossOriginRejected` + the production error
// branch (apiHelpers.ts lines 79 and 106):
//   • non-Request-like first arg            → check skipped
//   • non-state-changing method (GET)       → check skipped
//   • missing Origin header on a mutation   → allowed
//   • valid Origin but missing Host header  → allowed
//   • malformed Origin header               → 403 "Invalid Origin header" (79)
//   • production non-ApiError               → 500 without details (106)

describe('apiHelpers — withRoute origin/production branches', () => {
  const fallbackMessage = 'Server failed';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips the origin check when the first arg is not Request-like', async () => {
    const mockResponse = { status: 200 } as any;
    const handler = vi.fn().mockResolvedValue(mockResponse);
    const wrapped = withRoute(fallbackMessage, handler);

    const res = await wrapped(undefined as any);
    expect(res).toBe(mockResponse);
    expect(handler).toHaveBeenCalled();
  });

  it('skips the origin check for a non-state-changing GET (even cross-origin)', async () => {
    const mockResponse = { status: 200 } as any;
    const handler = vi.fn().mockResolvedValue(mockResponse);
    const wrapped = withRoute(fallbackMessage, handler);
    const req = {
      method: 'GET',
      headers: new Headers({ origin: 'https://evil.example', host: 'localhost:3000' }),
    };

    const res = await wrapped(req as any);
    expect(res).toBe(mockResponse);
    expect(handler).toHaveBeenCalled();
  });

  it('allows a state-changing request that has no Origin header', async () => {
    const mockResponse = { status: 201 } as any;
    const handler = vi.fn().mockResolvedValue(mockResponse);
    const wrapped = withRoute(fallbackMessage, handler);
    const req = {
      method: 'POST',
      headers: new Headers({ host: 'localhost:3000' }),
    };

    const res = await wrapped(req as any);
    expect(res).toBe(mockResponse);
    expect(handler).toHaveBeenCalled();
  });

  it('allows a valid Origin when the Host header is absent', async () => {
    const mockResponse = { status: 200 } as any;
    const handler = vi.fn().mockResolvedValue(mockResponse);
    const wrapped = withRoute(fallbackMessage, handler);
    const req = {
      method: 'PUT',
      headers: new Headers({ origin: 'https://localhost:3000' }),
    };

    const res = await wrapped(req as any);
    expect(res).toBe(mockResponse);
    expect(handler).toHaveBeenCalled();
  });

  it('refuses a state-changing request with a malformed Origin header (403)', async () => {
    const handler = vi.fn();
    const wrapped = withRoute(fallbackMessage, handler);
    const req = {
      method: 'DELETE',
      headers: new Headers({ origin: 'not a url', host: 'localhost:3000' }),
    };

    const res = (await wrapped(req as any)) as Response;
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Invalid Origin header' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('in production returns 500 with only the fallback message (no leaked details)', async () => {
    const prev = process.env.NODE_ENV;
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const handler = vi.fn().mockRejectedValue(new Error('secret SQL fragment'));
      const wrapped = withRoute(fallbackMessage, handler);

      const res = (await wrapped({} as any)) as Response;
      expect(res.status).toBe(500);
      // Details are withheld in production — only the fallback message is sent.
      expect(await res.json()).toEqual({ error: fallbackMessage });
      expect(consoleSpy).toHaveBeenCalledWith(`${fallbackMessage}:`, expect.any(Error));
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = prev;
      consoleSpy.mockRestore();
    }
  });
});
