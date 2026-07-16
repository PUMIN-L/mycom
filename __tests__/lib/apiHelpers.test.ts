// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiError, jsonError, requireAuth, withRoute } from '@/app/lib/apiHelpers';
import * as sessionModule from '@/app/lib/session';

// NOTE: next/server is intentionally NOT mocked — these tests assert against
// the REAL NextResponse (status, JSON body, content-type header) so the actual
// HTTP semantics are exercised, not a hand-rolled stub.

describe('apiHelpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('ApiError', () => {
    it('creates an error with a status and message', () => {
      const error = new ApiError(404, 'Not Found');
      expect(error.status).toBe(404);
      expect(error.message).toBe('Not Found');
      expect(error.name).toBe('ApiError');
    });
  });

  describe('jsonError', () => {
    it('returns a real JSON error response', async () => {
      const res = jsonError('Something went wrong', 400);
      expect(res.status).toBe(400);
      expect(res.headers.get('content-type')).toContain('application/json');
      expect(await res.json()).toEqual({ error: 'Something went wrong' });
    });

    it('includes details if provided', async () => {
      const res = jsonError('Error', 500, 'Detailed info');
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: 'Error', details: 'Detailed info' });
    });
  });

  describe('requireAuth', () => {
    it('throws ApiError 401 if no session exists', async () => {
      vi.spyOn(sessionModule, 'getSession').mockResolvedValue(null);
      await expect(requireAuth()).rejects.toThrow(ApiError);
      await expect(requireAuth()).rejects.toThrow('Unauthorized');
    });

    it('returns session if exists', async () => {
      const mockSession = { username: 'admin' } as any;
      vi.spyOn(sessionModule, 'getSession').mockResolvedValue(mockSession);
      const session = await requireAuth();
      expect(session).toEqual(mockSession);
    });
  });

  describe('withRoute', () => {
    const fallbackMessage = 'Server failed';

    it('returns handler result on success', async () => {
      const mockResponse = { status: 200, ok: true } as any;
      const handler = vi.fn().mockResolvedValue(mockResponse);
      const wrapped = withRoute(fallbackMessage, handler);

      const res = await wrapped({} as any);
      expect(res).toBe(mockResponse);
      expect(handler).toHaveBeenCalled();
    });

    it('catches ApiError and returns its status and message without console.error', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const handler = vi.fn().mockRejectedValue(new ApiError(403, 'Forbidden action'));
      const wrapped = withRoute(fallbackMessage, handler);

      const res = (await wrapped({} as any)) as Response;
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: 'Forbidden action' });
      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it('catches unknown Error and returns 500 with fallback message and details, and logs it', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const handler = vi.fn().mockRejectedValue(new Error('DB crash'));
      const wrapped = withRoute(fallbackMessage, handler);

      const res = (await wrapped({} as any)) as Response;
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: fallbackMessage, details: 'DB crash' });
      expect(consoleSpy).toHaveBeenCalledWith(`${fallbackMessage}:`, expect.any(Error));
    });

    it('catches non-Error throws and returns 500', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const handler = vi.fn().mockRejectedValue('String throw');
      const wrapped = withRoute(fallbackMessage, handler);

      const res = (await wrapped({} as any)) as Response;
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: fallbackMessage, details: 'String throw' });
    });

    it('refuses a cross-origin state-changing request with 403', async () => {
      const handler = vi.fn();
      const wrapped = withRoute(fallbackMessage, handler);
      const req = {
        method: 'POST',
        headers: new Headers({ origin: 'https://evil.example', host: 'localhost:3000' }),
      };

      const res = (await wrapped(req as any)) as Response;
      expect(res.status).toBe(403);
      expect(handler).not.toHaveBeenCalled();
    });

    it('allows a same-origin state-changing request', async () => {
      const mockResponse = { status: 201 } as any;
      const handler = vi.fn().mockResolvedValue(mockResponse);
      const wrapped = withRoute(fallbackMessage, handler);
      const req = {
        method: 'POST',
        headers: new Headers({ origin: 'https://localhost:3000', host: 'localhost:3000' }),
      };

      const res = await wrapped(req as any);
      expect(res).toBe(mockResponse);
      expect(handler).toHaveBeenCalled();
    });
  });
});
