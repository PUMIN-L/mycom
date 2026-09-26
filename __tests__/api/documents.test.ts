// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/documents/route';
import { DELETE, PUT } from '@/app/api/documents/[id]/route';
import { GET as PROXY_GET } from '@/app/api/documents/proxy/route';

// Document store — every function the two collection/item handlers touch.
vi.mock('@/app/lib/documentStore', () => ({
  getAllDocuments: vi.fn(),
  getDocument: vi.fn(),
  addDocument: vi.fn(),
  updateDocument: vi.fn(),
  deleteDocument: vi.fn(),
}));
import {
  getAllDocuments,
  getDocument,
  addDocument,
  updateDocument,
  deleteDocument,
} from '@/app/lib/documentStore';

// DELETE purges the PDF + cover from Cloudinary via the helper.
vi.mock('@/app/lib/cloudinaryHelper', () => ({
  deleteCloudinaryImage: vi.fn(),
}));
vi.mock('@/app/lib/imageUsageHelper', () => ({
  safeDeleteCloudinaryImage: vi.fn(),
}));
import { safeDeleteCloudinaryImage } from '@/app/lib/imageUsageHelper';

// Neither documents handler imports next/cache, but honor the shared mock list.
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));

// Drive the REAL requireAuth by controlling getSession (null = anonymous).
vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }));
import { getSession } from '@/app/lib/session';

const adminSession = { userId: '1', username: 'admin', expiresAt: new Date() } as any;

// State-changing requests exercise the real withRoute same-origin guard:
// matching origin + host headers so the CSRF check passes.
const mutatingRequest = (method: string, body?: any) =>
  new NextRequest('http://localhost:3000/api/documents/1', {
    method,
    headers: { origin: 'http://localhost:3000', host: 'localhost:3000' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

const validDoc = {
  id: 'doc-1',
  title: 'Brochure',
  description: 'A brochure',
  pdfUrl: 'https://res.cloudinary.com/demo/raw/upload/v1/doc.pdf',
  coverUrl: 'https://res.cloudinary.com/demo/image/upload/v1/doc.jpg',
  sortOrder: 3,
};

describe('Documents API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSession).mockResolvedValue(null); // default: anonymous
  });

  describe('GET /api/documents', () => {
    it('returns the document list (public, 200)', async () => {
      const docs = [{ id: 'a' }, { id: 'b' }];
      vi.mocked(getAllDocuments).mockResolvedValue(docs as any);

      const res = await GET();
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(docs);
    });

    it('surfaces a store failure as a 500 (error path)', async () => {
      vi.mocked(getAllDocuments).mockRejectedValue(new Error('db down'));

      const res = await GET();
      expect(res.status).toBe(500);
      expect((await res.json()).error).toBe('โหลดเอกสารไม่สำเร็จ');
    });
  });

  describe('POST /api/documents', () => {
    it('rejects anonymous callers with 401 (real requireAuth path)', async () => {
      vi.mocked(getSession).mockResolvedValue(null);

      const res = await POST(mutatingRequest('POST', validDoc));
      expect(res.status).toBe(401);
      expect((await res.json()).error).toBe('Unauthorized');
      expect(addDocument).not.toHaveBeenCalled();
    });

    it('rejects an authenticated request missing required fields with 400', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);

      const res = await POST(mutatingRequest('POST', { title: 'Only a title' }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('กรุณากรอกข้อมูลให้ครบ');
      expect(addDocument).not.toHaveBeenCalled();
    });

    it('creates a document with a server-assigned createdAt and returns 201', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      vi.mocked(addDocument).mockResolvedValue(undefined as any);

      const res = await POST(mutatingRequest('POST', validDoc));
      expect(res.status).toBe(201);

      const body = await res.json();
      expect(body.id).toBe('doc-1');
      expect(body.title).toBe('Brochure');
      expect(body.pdfUrl).toBe(validDoc.pdfUrl);
      expect(body.coverUrl).toBe(validDoc.coverUrl);
      expect(body.sortOrder).toBe(3);
      expect(typeof body.createdAt).toBe('string');

      expect(addDocument).toHaveBeenCalledTimes(1);
      const passed = vi.mocked(addDocument).mock.calls[0][0];
      expect(passed.id).toBe('doc-1');
      expect(typeof passed.createdAt).toBe('string'); // assigned server-side
    });
  });

  describe('DELETE /api/documents/[id]', () => {
    it('rejects anonymous callers with 401 (real requireAuth path)', async () => {
      vi.mocked(getSession).mockResolvedValue(null);

      const res = await DELETE(mutatingRequest('DELETE'), ctx('doc-1'));
      expect(res.status).toBe(401);
      expect((await res.json()).error).toBe('Unauthorized');
      expect(deleteDocument).not.toHaveBeenCalled();
      expect(safeDeleteCloudinaryImage).not.toHaveBeenCalled();
    });

    it('returns 404 when the document does not exist', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      vi.mocked(getDocument).mockResolvedValue(null);

      const res = await DELETE(mutatingRequest('DELETE'), ctx('missing'));
      expect(res.status).toBe(404);
      expect((await res.json()).error).toBe('ไม่พบเอกสารนี้');
      expect(deleteDocument).not.toHaveBeenCalled();
      expect(safeDeleteCloudinaryImage).not.toHaveBeenCalled();
    });

    it('returns orphanedImages URLs, deletes the row, and returns success', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      vi.mocked(getDocument).mockResolvedValue(validDoc as any);
      vi.mocked(deleteDocument).mockResolvedValue(undefined as any);

      const res = await DELETE(mutatingRequest('DELETE'), ctx('doc-1'));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.orphanedImages).toEqual([validDoc.pdfUrl, validDoc.coverUrl]);

      // Should NOT auto-delete from Cloudinary
      expect(safeDeleteCloudinaryImage).not.toHaveBeenCalled();
      expect(deleteDocument).toHaveBeenCalledWith('doc-1');
    });
  });

  describe('PUT /api/documents/[id]', () => {
    it('rejects anonymous callers with 401 (real requireAuth path)', async () => {
      vi.mocked(getSession).mockResolvedValue(null);

      const res = await PUT(mutatingRequest('PUT', { title: 'New' }), ctx('doc-1'));
      expect(res.status).toBe(401);
      expect((await res.json()).error).toBe('Unauthorized');
      expect(updateDocument).not.toHaveBeenCalled();
    });

    it('returns 404 when the document to update is not found', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      vi.mocked(getDocument).mockResolvedValue(null);

      const res = await PUT(mutatingRequest('PUT', { title: 'New' }), ctx('missing'));
      expect(res.status).toBe(404);
      expect((await res.json()).error).toBe('ไม่พบเอกสารนี้');
      expect(updateDocument).not.toHaveBeenCalled();
    });

    it('rejects an update with a missing title with 400', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      vi.mocked(getDocument).mockResolvedValue(validDoc as any);

      const res = await PUT(mutatingRequest('PUT', { description: 'no title' }), ctx('doc-1'));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('กรุณากรอกชื่อเอกสาร');
      expect(updateDocument).not.toHaveBeenCalled();
    });

    it('updates title + description and returns success', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      vi.mocked(getDocument).mockResolvedValue(validDoc as any);
      vi.mocked(updateDocument).mockResolvedValue(undefined as any);

      const res = await PUT(
        mutatingRequest('PUT', { title: 'Updated', description: 'desc' }),
        ctx('doc-1')
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true });
      expect(updateDocument).toHaveBeenCalledWith('doc-1', {
        title: 'Updated',
        description: 'desc',
      });
    });
  });

  // The proxy is a public GET (no auth, not withRoute-wrapped) that streams a
  // remote PDF. It only reaches out to res.cloudinary.com — mock global fetch.
  describe('GET /api/documents/proxy', () => {
    const fetchMock = vi.fn();
    const proxyRequest = (raw?: string, download = false) => {
      const params = new URLSearchParams();
      if (raw !== undefined) params.set('url', raw);
      if (download) params.set('download', '1');
      const qs = params.toString();
      return new NextRequest(
        'http://localhost:3000/api/documents/proxy' + (qs ? `?${qs}` : '')
      );
    };
    const cloudUrl = 'https://res.cloudinary.com/demo/raw/upload/v1/doc.pdf';
    let prevCloud: string | undefined;

    beforeEach(() => {
      fetchMock.mockReset();
      global.fetch = fetchMock as any;
      // Cloudinary is multi-tenant (shared hostname, cloud distinguished by
      // path segment) — pin this to match `cloudUrl`'s "demo" segment so the
      // success-path tests below exercise our own cloud, not "any cloud".
      prevCloud = process.env.CLOUDINARY_CLOUD_NAME;
      process.env.CLOUDINARY_CLOUD_NAME = 'demo';
    });

    afterEach(() => {
      if (prevCloud === undefined) delete process.env.CLOUDINARY_CLOUD_NAME;
      else process.env.CLOUDINARY_CLOUD_NAME = prevCloud;
    });

    it('400s when the url param is missing', async () => {
      const res = await PROXY_GET(proxyRequest());
      expect(res.status).toBe(400);
      expect(await res.text()).toBe('Missing URL');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('400s for a host outside the allowlist (SSRF guard)', async () => {
      const res = await PROXY_GET(proxyRequest('https://evil.example.com/x.pdf'));
      expect(res.status).toBe(400);
      expect(await res.text()).toBe('URL not allowed');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('400s for a non-https url even on an allowed host', async () => {
      const res = await PROXY_GET(proxyRequest('http://res.cloudinary.com/x.pdf'));
      expect(res.status).toBe(400);
      expect(await res.text()).toBe('URL not allowed');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('400s for a URL on a DIFFERENT Cloudinary cloud (cross-tenant proxy guard)', async () => {
      const res = await PROXY_GET(
        proxyRequest('https://res.cloudinary.com/someone-elses-cloud/raw/upload/v1/x.pdf')
      );
      expect(res.status).toBe(400);
      expect(await res.text()).toBe('URL not allowed');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('400s when CLOUDINARY_CLOUD_NAME is not configured (fail closed)', async () => {
      delete process.env.CLOUDINARY_CLOUD_NAME;
      const res = await PROXY_GET(proxyRequest(cloudUrl));
      expect(res.status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('streams the PDF inline on success', async () => {
      fetchMock.mockResolvedValue({ status: 200, ok: true, body: null } as any);

      const res = await PROXY_GET(proxyRequest(cloudUrl));
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('application/pdf');
      expect(res.headers.get('content-disposition')).toBe('inline; filename="document.pdf"');
    });

    it('serves the PDF as an attachment when download=1', async () => {
      fetchMock.mockResolvedValue({ status: 200, ok: true, body: null } as any);

      const res = await PROXY_GET(proxyRequest(cloudUrl, true));
      expect(res.status).toBe(200);
      expect(res.headers.get('content-disposition')).toBe('attachment; filename="document.pdf"');
      // The same file as the inline URL — only that one may be indexed.
      expect(res.headers.get('x-robots-tag')).toBe('noindex');
    });

    it("names the file after the document's title (every PDF used to be document.pdf)", async () => {
      fetchMock.mockResolvedValue({ status: 200, ok: true, body: null } as never);
      const named = (download: boolean) => {
        const req = proxyRequest(cloudUrl, download);
        req.nextUrl.searchParams.set('name', 'แคตตาล็อก Ohaus 2026');
        return new NextRequest(req.nextUrl);
      };

      const inline = await PROXY_GET(named(false));
      expect(inline.headers.get('content-disposition')).toBe(
        `inline; filename="Ohaus 2026.pdf"; filename*=UTF-8''${encodeURIComponent('แคตตาล็อก Ohaus 2026.pdf')}`
      );
      const attachment = await PROXY_GET(named(true));
      expect(attachment.headers.get('content-disposition')).toMatch(/^attachment; filename="Ohaus 2026\.pdf"; filename\*=UTF-8''/);
    });

    it('leaves the inline PDF indexable (robots.txt allows crawling it)', async () => {
      fetchMock.mockResolvedValue({ status: 200, ok: true, body: null } as never);

      const res = await PROXY_GET(proxyRequest(cloudUrl));
      expect(res.headers.get('x-robots-tag')).toBeNull();
    });

    it('refuses to follow an upstream redirect (502)', async () => {
      fetchMock.mockResolvedValue({ status: 302, ok: false, body: null } as any);

      const res = await PROXY_GET(proxyRequest(cloudUrl));
      expect(res.status).toBe(502);
      expect(await res.text()).toBe('Refusing to follow redirect');
    });

    it('propagates an upstream failure status', async () => {
      fetchMock.mockResolvedValue({ status: 404, ok: false, body: null } as any);

      const res = await PROXY_GET(proxyRequest(cloudUrl));
      expect(res.status).toBe(404);
      expect(await res.text()).toBe('Failed to fetch document');
    });

    it('500s when the upstream fetch throws', async () => {
      fetchMock.mockRejectedValue(new Error('network'));

      const res = await PROXY_GET(proxyRequest(cloudUrl));
      expect(res.status).toBe(500);
      expect(await res.text()).toBe('Internal Server Error');
    });

    it('pins the content type AND tells the browser not to sniff it', async () => {
      fetchMock.mockResolvedValue({ status: 200, ok: true, body: null } as any);

      const res = await PROXY_GET(proxyRequest(cloudUrl));
      expect(res.headers.get('content-type')).toBe('application/pdf');
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    });

    // Bandwidth (cost) control, not access control — the route stays public.
    // Keyed on its own x-forwarded-for so the flood cannot spill into the
    // tests above, which all share the "unknown" bucket.
    const CEILING = 300;

    it('429s a single IP that floods it, without an upstream fetch', async () => {
      fetchMock.mockResolvedValue({ status: 200, ok: true, body: null } as any);
      const flood = (n: number) =>
        PROXY_GET(
          new NextRequest(
            `http://localhost:3000/api/documents/proxy?url=${encodeURIComponent(cloudUrl)}&n=${n}`,
            { headers: { 'x-forwarded-for': '203.0.113.7' } }
          )
        );

      for (let i = 0; i < CEILING; i++) expect((await flood(i)).status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(CEILING);

      const blocked = await flood(CEILING);
      expect(blocked.status).toBe(429);
      expect(await blocked.text()).toBe('Too many requests');
      expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
      // The point of the limit: the expensive upstream call never happened.
      expect(fetchMock).toHaveBeenCalledTimes(CEILING);
    });

    // Regression guard on the CEILING itself. The limiter keys on an IP, and an
    // IP is a whole CGNAT/campus egress here, not one person — so the ceiling
    // has to clear a realistic shared address by a wide margin. One PDF open is
    // 1 request (pdf.js gets no Accept-Ranges from the fresh header set, so it
    // does not switch to chunked range requests) plus 1 if download is clicked.
    it('leaves a busy shared (NAT) address far below the limit', async () => {
      fetchMock.mockResolvedValue({ status: 200, ok: true, body: null } as any);
      // 20 unrelated readers behind one address, each opening 6 datasheets and
      // downloading 3 of them, inside the same five-minute window.
      const readers = 20;
      const requestsPerReader = 6 + 3;
      const realisticPeak = readers * requestsPerReader; // 180
      expect(realisticPeak).toBeLessThan(CEILING);

      const office = (n: number) =>
        PROXY_GET(
          new NextRequest(
            `http://localhost:3000/api/documents/proxy?url=${encodeURIComponent(cloudUrl)}&n=${n}`,
            { headers: { 'x-forwarded-for': '198.51.100.42' } }
          )
        );
      for (let i = 0; i < realisticPeak; i++) {
        expect((await office(i)).status).toBe(200);
      }
    });

    // A second address is unaffected by the first one's exhausted quota —
    // otherwise one abuser would take the public catalog down for everyone.
    it('does not let one flooding IP block a different IP', async () => {
      fetchMock.mockResolvedValue({ status: 200, ok: true, body: null } as any);
      const from = (ip: string, n: number) =>
        PROXY_GET(
          new NextRequest(
            `http://localhost:3000/api/documents/proxy?url=${encodeURIComponent(cloudUrl)}&n=${n}`,
            { headers: { 'x-forwarded-for': ip } }
          )
        );

      for (let i = 0; i < CEILING; i++) await from('203.0.113.9', i);
      expect((await from('203.0.113.9', CEILING)).status).toBe(429);
      // Innocent bystander, still served.
      expect((await from('203.0.113.10', 0)).status).toBe(200);
    });

    // A spoofed multi-value header must not widen the allowance: only the first
    // entry is the key, so the extra values buy the caller nothing.
    it('keys on the first x-forwarded-for entry when several are supplied', async () => {
      fetchMock.mockResolvedValue({ status: 200, ok: true, body: null } as any);
      const spoof = (n: number) =>
        PROXY_GET(
          new NextRequest(
            `http://localhost:3000/api/documents/proxy?url=${encodeURIComponent(cloudUrl)}&n=${n}`,
            { headers: { 'x-forwarded-for': `203.0.113.11, 10.0.0.${n % 250}` } }
          )
        );

      for (let i = 0; i < CEILING; i++) await spoof(i);
      expect((await spoof(CEILING)).status).toBe(429);
    });
  });
});
