// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiError, jsonError, requireAuth, withRoute } from '@/app/lib/apiHelpers';
import * as sessionModule from '@/app/lib/session';

// Mock NextResponse
vi.mock('next/server', () => {
  return {
    NextResponse: {
      json: vi.fn((body, init) => {
        return {
          status: init?.status || 200,
          json: async () => body,
        };
      }),
    },
  };
});

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
    it('returns a standard error response', async () => {
      const res = jsonError('Something went wrong', 400);
      expect(res.status).toBe(400);
      const body = await (res as any).json();
      expect(body).toEqual({ error: 'Something went wrong' });
    });

    it('includes details if provided', async () => {
      const res = jsonError('Error', 500, 'Detailed info');
      expect(res.status).toBe(500);
      const body = await (res as any).json();
      expect(body).toEqual({ error: 'Error', details: 'Detailed info' });
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
      
      const res = await wrapped({} as any) as any;
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body).toEqual({ error: 'Forbidden action' });
      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it('catches unknown Error and returns 500 with fallback message and details, and logs it', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const handler = vi.fn().mockRejectedValue(new Error('DB crash'));
      const wrapped = withRoute(fallbackMessage, handler);
      
      const res = await wrapped({} as any) as any;
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body).toEqual({ error: fallbackMessage, details: 'DB crash' });
      expect(consoleSpy).toHaveBeenCalledWith(`${fallbackMessage}:`, expect.any(Error));
    });

    it('catches non-Error throws and returns 500', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const handler = vi.fn().mockRejectedValue('String throw');
      const wrapped = withRoute(fallbackMessage, handler);
      
      const res = await wrapped({} as any) as any;
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body).toEqual({ error: fallbackMessage, details: 'String throw' });
    });
  });
});
