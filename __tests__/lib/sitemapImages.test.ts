// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { sitemapImages, MAX_SITEMAP_IMAGES_PER_URL } from '@/app/lib/sitemapImages';

const CLD = 'https://res.cloudinary.com/demo/image/upload/v1/mycom/a.jpg';

describe('sitemapImages', () => {
  it('keeps absolute http(s) URLs, once each', () => {
    expect(sitemapImages([CLD, CLD, 'http://example.com/b.png'])).toEqual([CLD, 'http://example.com/b.png']);
  });

  it('nothing worth listing is undefined — the entry gets no images key', () => {
    expect(sitemapImages([])).toBeUndefined();
    expect(sitemapImages(['', '   ', null, 5, 'relative/path.jpg', 'data:image/png;base64,AA=='])).toBeUndefined();
  });

  it('leaves out a URL Next would write into the XML unescaped (& < > " \')', () => {
    // One such character makes the WHOLE sitemap unreadable to Google.
    expect(sitemapImages(['https://x.com/a.jpg?w=1&h=2', "https://x.com/it's.jpg", CLD])).toEqual([CLD]);
  });

  it('normalises what the URL parser does (spaces and Thai are percent-encoded)', () => {
    const [url] = sitemapImages(['https://x.com/รูป ภาพ.jpg'])!;
    expect(url).toBe('https://x.com/%E0%B8%A3%E0%B8%B9%E0%B8%9B%20%E0%B8%A0%E0%B8%B2%E0%B8%9E.jpg');
  });

  it('stops at Google\'s 1,000 per URL', () => {
    const many = Array.from({ length: MAX_SITEMAP_IMAGES_PER_URL + 50 }, (_, i) => `https://x.com/${i}.jpg`);
    expect(sitemapImages(many)).toHaveLength(MAX_SITEMAP_IMAGES_PER_URL);
  });
});
