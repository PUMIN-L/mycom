// @vitest-environment node
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

// Mock the external `cloudinary` package (NOT the module under test).
// cloudinaryHelper imports `{ v2 as cloudinary }` and, at IMPORT time, calls
// `cloudinary.config(...)`, so the mock must be in place before the SUT loads —
// vi.mock is hoisted above the imports, which satisfies that.
vi.mock('cloudinary', () => ({
  v2: {
    config: vi.fn(),
    uploader: {
      upload_stream: vi.fn(),
      destroy: vi.fn(),
    },
    url: vi.fn(),
  },
}));

import { v2 as cloudinary } from 'cloudinary';
import {
  uploadImage,
  extractPublicId,
  deleteCloudinaryImage,
  deleteCloudinaryImages,
  collectContentImageUrls,
  getPdfCoverUrl,
} from '@/app/lib/cloudinaryHelper';
import type { ContentData } from '@/app/lib/types';

const uploadStreamMock = cloudinary.uploader.upload_stream as unknown as Mock;
const destroyMock = cloudinary.uploader.destroy as unknown as Mock;

/**
 * Wire `upload_stream(options, cb)` to return a stream whose `.end(buffer)`
 * invokes the SUT-supplied callback with `(error, result)`.
 */
function stubUploadStream(error: unknown, result: unknown) {
  const end = vi.fn((_buffer: Buffer) => {});
  uploadStreamMock.mockImplementation((_options: unknown, cb: (e: unknown, r: unknown) => void) => {
    end.mockImplementation((_buffer: Buffer) => cb(error, result));
    return { end };
  });
  return end;
}

describe('cloudinaryHelper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('extractPublicId', () => {
    it('extracts the public_id from an upload URL WITH a version', () => {
      const url = 'https://res.cloudinary.com/demo/image/upload/v1234567/samples/mycom/abc.jpg';
      expect(extractPublicId(url)).toBe('samples/mycom/abc');
    });

    it('extracts the public_id from an upload URL WITHOUT a version', () => {
      const url = 'https://res.cloudinary.com/demo/image/upload/samples/mycom/abc.jpg';
      expect(extractPublicId(url)).toBe('samples/mycom/abc');
    });

    it('drops transformation segments that precede the version', () => {
      const url = 'https://res.cloudinary.com/demo/image/upload/w_800,f_auto/v42/folder/file.png';
      expect(extractPublicId(url)).toBe('folder/file');
    });

    it('strips a trailing query string before parsing', () => {
      const url = 'https://res.cloudinary.com/demo/image/upload/v1/folder/file.jpg?_a=BAMAH';
      expect(extractPublicId(url)).toBe('folder/file');
    });

    it('keeps the extension when keepExtension = true (raw/PDF assets)', () => {
      const url = 'https://res.cloudinary.com/demo/raw/upload/v99/docs/manual.pdf';
      expect(extractPublicId(url, true)).toBe('docs/manual.pdf');
    });

    it('removes the extension by default (keepExtension = false)', () => {
      const url = 'https://res.cloudinary.com/demo/raw/upload/v99/docs/manual.pdf';
      expect(extractPublicId(url, false)).toBe('docs/manual');
    });

    it('returns null for a non-Cloudinary URL (no /upload/ segment)', () => {
      expect(extractPublicId('https://example.com/images/photo.jpg')).toBeNull();
    });

    it('returns null for a garbage string', () => {
      expect(extractPublicId('not-a-url-at-all')).toBeNull();
    });

    it('returns null when there is nothing after /upload/ (empty path)', () => {
      expect(extractPublicId('https://res.cloudinary.com/demo/image/upload/')).toBeNull();
    });

    it('returns null (via the catch) when passed a non-string', () => {
      // Exercises the try/catch guard — `.split` throws on a non-string input.
      expect(extractPublicId(null as unknown as string)).toBeNull();
    });
  });

  describe('collectContentImageUrls', () => {
    const makeContent = (blocks: ContentData['blocks']): ContentData => ({
      id: 'c1',
      title: 'Test',
      blocks,
      createdAt: '2026-01-01',
    });

    it('collects imageUrl from every block that has one', () => {
      const content = makeContent([
        { id: 'b1', type: 'image', imageUrl: 'https://res.cloudinary.com/a/image/upload/v1/x.jpg' },
        { id: 'b2', type: 'text-image', imageUrl: 'https://res.cloudinary.com/a/image/upload/v1/y.jpg' },
      ]);
      expect(collectContentImageUrls(content)).toEqual([
        'https://res.cloudinary.com/a/image/upload/v1/x.jpg',
        'https://res.cloudinary.com/a/image/upload/v1/y.jpg',
      ]);
    });

    it('skips blocks without an imageUrl (mixed)', () => {
      const content = makeContent([
        { id: 'b1', type: 'text', content: 'hello' },
        { id: 'b2', type: 'image', imageUrl: 'https://res.cloudinary.com/a/image/upload/v1/x.jpg' },
        { id: 'b3', type: 'text', content: 'world' },
      ]);
      expect(collectContentImageUrls(content)).toEqual([
        'https://res.cloudinary.com/a/image/upload/v1/x.jpg',
      ]);
    });

    it('returns an empty array when no block has an imageUrl', () => {
      const content = makeContent([
        { id: 'b1', type: 'text', content: 'only text' },
      ]);
      expect(collectContentImageUrls(content)).toEqual([]);
    });

    it('returns an empty array for a content with no blocks', () => {
      expect(collectContentImageUrls(makeContent([]))).toEqual([]);
    });

    it('collects gallery imageUrls[] arrays (so gallery assets are not orphaned)', () => {
      const content = makeContent([
        {
          id: 'b1',
          type: 'gallery',
          imageUrls: [
            'https://res.cloudinary.com/a/image/upload/v1/g1.jpg',
            'https://res.cloudinary.com/a/image/upload/v1/g2.jpg',
          ],
        },
      ]);
      expect(collectContentImageUrls(content)).toEqual([
        'https://res.cloudinary.com/a/image/upload/v1/g1.jpg',
        'https://res.cloudinary.com/a/image/upload/v1/g2.jpg',
      ]);
    });

    it('collects both a singular imageUrl and an imageUrls[] on the same block', () => {
      const content = makeContent([
        {
          id: 'b1',
          type: 'gallery',
          imageUrl: 'https://res.cloudinary.com/a/image/upload/v1/cover.jpg',
          imageUrls: ['https://res.cloudinary.com/a/image/upload/v1/g1.jpg'],
        },
      ]);
      expect(collectContentImageUrls(content)).toEqual([
        'https://res.cloudinary.com/a/image/upload/v1/cover.jpg',
        'https://res.cloudinary.com/a/image/upload/v1/g1.jpg',
      ]);
    });

    it('de-duplicates a URL that appears in both imageUrl and imageUrls[] or across blocks', () => {
      const dup = 'https://res.cloudinary.com/a/image/upload/v1/same.jpg';
      const content = makeContent([
        { id: 'b1', type: 'image', imageUrl: dup },
        { id: 'b2', type: 'gallery', imageUrls: [dup, 'https://res.cloudinary.com/a/image/upload/v1/other.jpg'] },
      ]);
      expect(collectContentImageUrls(content)).toEqual([
        dup,
        'https://res.cloudinary.com/a/image/upload/v1/other.jpg',
      ]);
    });
  });

  describe('getPdfCoverUrl', () => {
    it('swaps a .pdf extension for .jpg', () => {
      const url = 'https://res.cloudinary.com/demo/raw/upload/v123/file.pdf';
      expect(getPdfCoverUrl(url)).toBe('https://res.cloudinary.com/demo/raw/upload/v123/file.jpg');
    });

    it('is case-insensitive on the extension', () => {
      expect(getPdfCoverUrl('https://x/file.PDF')).toBe('https://x/file.jpg');
    });

    it('leaves a non-pdf URL unchanged', () => {
      expect(getPdfCoverUrl('https://x/file.png')).toBe('https://x/file.png');
    });
  });

  describe('uploadImage', () => {
    it('resolves with secure_url on success and uses default folder/resource_type', async () => {
      const end = stubUploadStream(null, { secure_url: 'https://res.cloudinary.com/a/image/upload/v1/ok.jpg' });
      const buffer = Buffer.from('image-bytes');

      const url = await uploadImage(buffer);

      expect(url).toBe('https://res.cloudinary.com/a/image/upload/v1/ok.jpg');
      expect(end).toHaveBeenCalledWith(buffer);
      const options = uploadStreamMock.mock.calls[0][0];
      expect(options).toEqual({ folder: 'samples/mycom', resource_type: 'auto' });
      // No public_id supplied → key must be absent.
      expect(options).not.toHaveProperty('public_id');
    });

    it('passes custom folder, resource_type and public_id through to upload_stream', async () => {
      stubUploadStream(null, { secure_url: 'https://res.cloudinary.com/a/raw/upload/v1/doc.pdf' });

      await uploadImage(Buffer.from('x'), 'custom/folder', 'raw', 'my-id');

      expect(uploadStreamMock.mock.calls[0][0]).toEqual({
        folder: 'custom/folder',
        resource_type: 'raw',
        public_id: 'my-id',
      });
    });

    it('rejects with the error when upload_stream reports one', async () => {
      const boom = new Error('upload failed');
      stubUploadStream(boom, null);
      await expect(uploadImage(Buffer.from('x'))).rejects.toThrow('upload failed');
    });

    it('rejects with a synthetic error when there is neither error nor result', async () => {
      stubUploadStream(null, null);
      await expect(uploadImage(Buffer.from('x'))).rejects.toThrow('Cloudinary upload returned no result');
    });
  });

  describe('deleteCloudinaryImage', () => {
    it('deletes an image asset and returns true on result "ok"', async () => {
      destroyMock.mockResolvedValue({ result: 'ok' });
      const url = 'https://res.cloudinary.com/demo/image/upload/v1/folder/pic.jpg';

      const ok = await deleteCloudinaryImage(url);

      expect(ok).toBe(true);
      expect(destroyMock).toHaveBeenCalledWith('folder/pic', { resource_type: 'image' });
    });

    it('treats "not found" as success (already gone)', async () => {
      destroyMock.mockResolvedValue({ result: 'not found' });
      const ok = await deleteCloudinaryImage('https://res.cloudinary.com/demo/image/upload/v1/pic.jpg');
      expect(ok).toBe(true);
    });

    it('returns false for any other destroy result', async () => {
      destroyMock.mockResolvedValue({ result: 'error' });
      const ok = await deleteCloudinaryImage('https://res.cloudinary.com/demo/image/upload/v1/pic.jpg');
      expect(ok).toBe(false);
    });

    it('preserves the extension and targets resource_type "raw" for PDF URLs', async () => {
      destroyMock.mockResolvedValue({ result: 'ok' });
      const url = 'https://res.cloudinary.com/demo/raw/upload/v1/docs/manual.pdf';

      await deleteCloudinaryImage(url);

      expect(destroyMock).toHaveBeenCalledWith('docs/manual.pdf', { resource_type: 'raw' });
    });

    it('targets resource_type "video" for video URLs', async () => {
      destroyMock.mockResolvedValue({ result: 'ok' });
      const url = 'https://res.cloudinary.com/demo/video/upload/v1/clips/intro.mp4';

      await deleteCloudinaryImage(url);

      expect(destroyMock).toHaveBeenCalledWith('clips/intro', { resource_type: 'video' });
    });

    it('returns false WITHOUT calling destroy when the public_id cannot be extracted', async () => {
      const ok = await deleteCloudinaryImage('https://example.com/not-cloudinary.jpg');
      expect(ok).toBe(false);
      expect(destroyMock).not.toHaveBeenCalled();
    });

    it('returns false and logs when destroy throws', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      destroyMock.mockRejectedValue(new Error('network down'));

      const ok = await deleteCloudinaryImage('https://res.cloudinary.com/demo/image/upload/v1/pic.jpg');

      expect(ok).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith('Cloudinary delete error:', expect.any(Error));
    });
  });

  describe('deleteCloudinaryImages', () => {
    it('deletes every URL in the array', async () => {
      destroyMock.mockResolvedValue({ result: 'ok' });
      const urls = [
        'https://res.cloudinary.com/demo/image/upload/v1/a.jpg',
        'https://res.cloudinary.com/demo/image/upload/v1/b.jpg',
      ];

      await expect(deleteCloudinaryImages(urls)).resolves.toBeUndefined();
      expect(destroyMock).toHaveBeenCalledTimes(2);
      expect(destroyMock).toHaveBeenNthCalledWith(1, 'a', { resource_type: 'image' });
      expect(destroyMock).toHaveBeenNthCalledWith(2, 'b', { resource_type: 'image' });
    });

    it('resolves and calls nothing for an empty array', async () => {
      await expect(deleteCloudinaryImages([])).resolves.toBeUndefined();
      expect(destroyMock).not.toHaveBeenCalled();
    });
  });
});
