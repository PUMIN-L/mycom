// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// getSession()/createSession() read the session epoch ("log out other devices").
// Pinned here so these tests never reach the real settings store.
vi.mock('@/app/lib/settingsStore', () => ({ getSessionEpoch: vi.fn(async () => 0) }));
import { ApiError, INVALID_JSON_BODY_MESSAGE, jsonError, requireAuth, withRoute } from '@/app/lib/apiHelpers';
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

  // A body the handler cannot use is the caller's mistake — a 400 — not a
  // crash inside the handler reported (and logged) as a 500.
  describe('withRoute — request.json() refuses an unusable body', () => {
    const post = (body: string) =>
      new Request('http://localhost:3000/api/x', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      });
    const readsName = withRoute('Failed', async (req: Request) => {
      const body = await req.json();
      return Response.json({ name: body.name ?? null });
    });

    it.each([
      ['not JSON at all', '{"name": '],
      ['empty', ''],
      ['JSON null', 'null'],
    ])('answers 400, not 500, for a body that is %s — and logs nothing', async (_label, raw) => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const res = await readsName(post(raw));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe(INVALID_JSON_BODY_MESSAGE);
      expect(errorSpy).not.toHaveBeenCalled();
      errorSpy.mockRestore();
    });

    it('hands a good body through untouched — objects and arrays alike', async () => {
      expect(await (await readsName(post('{"name":"ก"}'))).json()).toEqual({ name: 'ก' });
      const echo = withRoute('Failed', async (req: Request) => Response.json(await req.json()));
      expect(await (await echo(post('[1,2]'))).json()).toEqual([1, 2]);
    });

    // In production Next hands a route (without `export const dynamic`) its
    // request wrapped in a Proxy (proxyNextRequest in app-route/module.js)
    // whose get trap returns methods bound to the real request through
    // ReflectAdapter. The guard must work through that, not just on a bare
    // Request.
    it("works through the Proxy Next wraps the request in", async () => {
      const { ReflectAdapter } = await import("next/dist/server/web/spec-extension/adapters/reflect");
      const nextLike = (req: Request) =>
        new Proxy(req, { get: (target, prop) => ReflectAdapter.get(target, prop, target) });

      const bad = await readsName(nextLike(post("null")));
      expect(bad.status).toBe(400);
      expect((await bad.json()).error).toBe(INVALID_JSON_BODY_MESSAGE);
      const good = await readsName(nextLike(post('{"name":"ข"}')));
      expect(await good.json()).toEqual({ name: "ข" });
    });

    it("still runs the handler when the request refuses the override", async () => {
      const sealed = new Proxy(post('{"name":"ค"}'), {
        defineProperty: () => false, // Object.defineProperty then throws
        get: (target, prop) => {
          const v = Reflect.get(target, prop, target);
          return typeof v === "function" ? v.bind(target) : v;
        },
      });
      const res = await readsName(sealed);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ name: "ค" });
    });

    it("leaves a route's own .catch() fallback in charge", async () => {
      const lenient = withRoute('Failed', async (req: Request) => {
        const body = await req.json().catch(() => ({ fallback: true }));
        return Response.json(body);
      });
      expect(await (await lenient(post('null'))).json()).toEqual({ fallback: true });
      expect(await (await lenient(post('nope'))).json()).toEqual({ fallback: true });
    });
  });
});
