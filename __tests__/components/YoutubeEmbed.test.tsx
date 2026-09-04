import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import YoutubeEmbed from '@/app/components/YoutubeEmbed';

// jsdom doesn't implement IntersectionObserver — stub it and capture the
// callback/instance so tests can fire an intersection manually.
let observedCallback: IntersectionObserverCallback | null = null;
let disconnectSpy = vi.fn();

class FakeIntersectionObserver {
  constructor(callback: IntersectionObserverCallback) {
    observedCallback = callback;
  }
  observe = vi.fn();
  disconnect = disconnectSpy;
  unobserve = vi.fn();
  takeRecords = vi.fn(() => []);
  root = null;
  rootMargin = '';
  thresholds = [];
}

function fireIntersection(isIntersecting: boolean) {
  act(() => {
    observedCallback!([{ isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver);
  });
}

beforeEach(() => {
  observedCallback = null;
  disconnectSpy = vi.fn();
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('YoutubeEmbed', () => {
  it('shows a placeholder for an invalid/non-YouTube URL', () => {
    render(<YoutubeEmbed url="https://example.com" />);
    expect(screen.getByText('ลิงก์ YouTube ไม่ถูกต้อง')).toBeInTheDocument();
    expect(screen.queryByTitle('YouTube video player')).not.toBeInTheDocument();
  });

  it('renders the embed without autoplay before it has scrolled into view', () => {
    render(<YoutubeEmbed url="https://www.youtube.com/watch?v=dQw4w9WgXcQ" />);
    const iframe = screen.getByTitle('YouTube video player') as HTMLIFrameElement;
    expect(iframe.src).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?enablejsapi=1');
  });

  it('loads with autoplay (muted) the first time it scrolls into view', () => {
    render(<YoutubeEmbed url="https://www.youtube.com/watch?v=dQw4w9WgXcQ" />);

    fireIntersection(true);

    const iframe = screen.getByTitle('YouTube video player') as HTMLIFrameElement;
    expect(iframe.src).toBe(
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?enablejsapi=1&autoplay=1&mute=1'
    );
  });

  it('does nothing when the observer reports it is still off-screen and never loaded', () => {
    render(<YoutubeEmbed url="https://www.youtube.com/watch?v=dQw4w9WgXcQ" />);

    fireIntersection(false);

    const iframe = screen.getByTitle('YouTube video player') as HTMLIFrameElement;
    expect(iframe.src).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?enablejsapi=1');
  });

  it('pauses (via postMessage, without reloading the iframe) when scrolled out of view after loading', () => {
    render(<YoutubeEmbed url="https://www.youtube.com/watch?v=dQw4w9WgXcQ" />);
    fireIntersection(true); // first entry: loads with autoplay

    const iframe = screen.getByTitle('YouTube video player') as HTMLIFrameElement;
    const postMessageSpy = vi.fn();
    Object.defineProperty(iframe, 'contentWindow', { value: { postMessage: postMessageSpy }, configurable: true });
    const srcAfterLoad = iframe.src;

    fireIntersection(false); // scrolled away

    expect(postMessageSpy).toHaveBeenCalledWith(
      JSON.stringify({ event: 'command', func: 'pauseVideo', args: [] }),
      '*'
    );
    // Pausing must not reload the iframe (that would restart the video).
    expect(iframe.src).toBe(srcAfterLoad);
  });

  it('resumes (via postMessage) when scrolled back into view instead of reloading', () => {
    render(<YoutubeEmbed url="https://www.youtube.com/watch?v=dQw4w9WgXcQ" />);
    fireIntersection(true); // loads with autoplay
    fireIntersection(false); // scrolls away

    const iframe = screen.getByTitle('YouTube video player') as HTMLIFrameElement;
    const postMessageSpy = vi.fn();
    Object.defineProperty(iframe, 'contentWindow', { value: { postMessage: postMessageSpy }, configurable: true });
    const srcBeforeResume = iframe.src;

    fireIntersection(true); // scrolls back

    expect(postMessageSpy).toHaveBeenCalledWith(
      JSON.stringify({ event: 'command', func: 'playVideo', args: [] }),
      '*'
    );
    expect(iframe.src).toBe(srcBeforeResume); // still not reloaded
  });

  it('keeps a single observer subscription alive across visibility changes (never disconnects early)', () => {
    render(<YoutubeEmbed url="https://www.youtube.com/watch?v=dQw4w9WgXcQ" />);
    fireIntersection(true);
    fireIntersection(false);
    fireIntersection(true);
    expect(disconnectSpy).not.toHaveBeenCalled();
  });
});
