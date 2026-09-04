import { describe, it, expect } from 'vitest';
import { extractYoutubeVideoId, isValidYoutubeUrl } from '@/app/lib/youtube';

describe('extractYoutubeVideoId', () => {
  it('extracts the id from a standard watch URL', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts the id from a watch URL with extra query params', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30s&list=xyz')).toBe('dQw4w9WgXcQ');
  });

  it('extracts the id from a youtu.be short link', () => {
    expect(extractYoutubeVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts the id from a youtu.be link with a trailing query string', () => {
    expect(extractYoutubeVideoId('https://youtu.be/dQw4w9WgXcQ?t=5')).toBe('dQw4w9WgXcQ');
  });

  it('extracts the id from a /shorts/ URL', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts the id from an /embed/ URL', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts the id from a youtube-nocookie.com embed URL', () => {
    expect(extractYoutubeVideoId('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('works without the www. prefix', () => {
    expect(extractYoutubeVideoId('https://youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('returns null for a non-YouTube URL', () => {
    expect(extractYoutubeVideoId('https://vimeo.com/12345')).toBeNull();
  });

  it('returns null for a YouTube URL with no video id (e.g. the channel home)', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/watch')).toBeNull();
  });

  it('returns null for garbage input', () => {
    expect(extractYoutubeVideoId('not a url')).toBeNull();
  });

  it('returns null for empty/null/undefined', () => {
    expect(extractYoutubeVideoId('')).toBeNull();
    expect(extractYoutubeVideoId(null)).toBeNull();
    expect(extractYoutubeVideoId(undefined)).toBeNull();
  });
});

describe('isValidYoutubeUrl', () => {
  it('is true for a valid watch URL', () => {
    expect(isValidYoutubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true);
  });

  it('is false for a non-YouTube URL', () => {
    expect(isValidYoutubeUrl('https://example.com')).toBe(false);
  });
});
