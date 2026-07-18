// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/upload/route';
import { DELETE } from '@/app/api/upload/delete/route';

// Both routes go through cloudinaryHelper — keep Cloudinary inert.
vi.mock('@/app/lib/cloudinaryHelper', () => ({
  uploadImage: vi.fn(),
  deleteCloudinaryImage: vi.fn(),
}));
import { uploadImage, deleteCloudinaryImage } from '@/app/lib/cloudinaryHelper';

// Drive the REAL requireAuth by controlling getSession (null = anonymous).
vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }));
import { getSession } from '@/app/lib/session';

const adminSession = { userId: '1', username: 'admin', expiresAt: new Date() } as any;

// State-changing requests exercise the real withRoute same-origin guard:
// matching origin + host headers so the CSRF check passes.
const uploadRequest = (formData: FormData) =>
  new NextRequest('http://localhost:3000/api/upload', {
    method: 'POST',
    headers: { origin: 'http://localhost:3000', host: 'localhost:3000' },
    body: formData,
  });

const deleteRequest = (body: any) =>
  new NextRequest('http://localhost:3000/api/upload/delete', {
    method: 'DELETE',
    headers: { origin: 'http://localhost:3000', host: 'localhost:3000' },
    body: JSON.stringify(body),
  });

const imageFile = (type = 'image/png', name = 'pic.png') =>
  new File([new Uint8Array([1, 2, 3, 4])], name, { type });

describe('Upload API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSession).mockResolvedValue(null); // default: anonymous
  });

  describe('POST /api/upload', () => {
    it('rejects anonymous callers with 401 (real requireAuth path)', async () => {
      vi.mocked(getSession).mockResolvedValue(null);
      const fd = new FormData();
      fd.set('file', imageFile());

      const res = await POST(uploadRequest(fd));
      expect(res.status).toBe(401);
      expect((await res.json()).error).toBe('Unauthorized');
      expect(uploadImage).not.toHaveBeenCalled();
    });

    it('400s when no file is present', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      const fd = new FormData(); // no "file"

      const res = await POST(uploadRequest(fd));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('No file uploaded');
      expect(uploadImage).not.toHaveBeenCalled();
    });

    it('400s for an unsupported image type', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      const fd = new FormData();
      fd.set('file', imageFile('text/plain', 'note.txt'));

      const res = await POST(uploadRequest(fd));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain('Unsupported image type');
      expect(uploadImage).not.toHaveBeenCalled();
    });

    it('uploads an image and returns its secure_url', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      const secureUrl = 'https://res.cloudinary.com/demo/image/upload/v1/pic.png';
      vi.mocked(uploadImage).mockResolvedValue(secureUrl);

      const fd = new FormData();
      fd.set('file', imageFile('image/png'));

      const res = await POST(uploadRequest(fd));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ url: secureUrl });
      // resource_type is pinned to "image", never "auto".
      expect(uploadImage).toHaveBeenCalledWith(expect.any(Buffer), 'samples/mycom', 'image');
    });

    it('400s when a document upload is not a PDF', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      const fd = new FormData();
      fd.set('file', imageFile('text/plain', 'note.txt'));
      fd.set('isDocument', 'true');

      const res = await POST(uploadRequest(fd));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('Only PDF files are allowed for documents');
      expect(uploadImage).not.toHaveBeenCalled();
    });

    it('uploads a PDF twice (raw + cover) and returns url + coverUrl', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      const rawUrl = 'https://res.cloudinary.com/demo/raw/upload/v1/doc_x.pdf';
      const imageUrl = 'https://res.cloudinary.com/demo/image/upload/v1/doc_x.pdf';
      // The route fires both uploads in parallel; distinguish by resource_type.
      vi.mocked(uploadImage).mockImplementation((_buf, _folder, type) =>
        Promise.resolve(type === 'raw' ? rawUrl : imageUrl)
      );

      const fd = new FormData();
      fd.set('file', new File([new Uint8Array([37, 80, 68, 70])], 'doc.pdf', { type: 'application/pdf' }));
      fd.set('isDocument', 'true');

      const res = await POST(uploadRequest(fd));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        url: rawUrl,
        coverUrl: imageUrl.replace(/\.pdf$/i, '.jpg'),
      });
      expect(uploadImage).toHaveBeenCalledTimes(2);
    });
  });

  describe('DELETE /api/upload/delete', () => {
    it('rejects anonymous callers with 401 (real requireAuth path)', async () => {
      vi.mocked(getSession).mockResolvedValue(null);

      const res = await DELETE(deleteRequest({ imageUrl: 'https://res.cloudinary.com/x.png' }));
      expect(res.status).toBe(401);
      expect((await res.json()).error).toBe('Unauthorized');
      expect(deleteCloudinaryImage).not.toHaveBeenCalled();
    });

    it('400s when imageUrl is missing', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);

      const res = await DELETE(deleteRequest({}));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('imageUrl is required');
      expect(deleteCloudinaryImage).not.toHaveBeenCalled();
    });

    it('deletes the asset and returns success:true', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      vi.mocked(deleteCloudinaryImage).mockResolvedValue(true);
      const imageUrl = 'https://res.cloudinary.com/demo/image/upload/v1/pic.png';

      const res = await DELETE(deleteRequest({ imageUrl }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true });
      expect(deleteCloudinaryImage).toHaveBeenCalledWith(imageUrl);
    });

    it('returns success:false when the url is not a deletable Cloudinary asset', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      vi.mocked(deleteCloudinaryImage).mockResolvedValue(false); // e.g. unparseable url

      const res = await DELETE(deleteRequest({ imageUrl: 'https://example.com/not-cloudinary.png' }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: false });
    });
  });
});
