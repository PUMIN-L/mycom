"use client";
import { useEffect, useRef, useState } from "react";
import { extractYoutubeVideoId } from "../lib/youtube";

interface YoutubeEmbedProps {
  url: string;
  className?: string;
}

type PlayerCommand = "playVideo" | "pauseVideo" | "mute" | "unMute";

function postPlayerCommand(iframe: HTMLIFrameElement | null, func: PlayerCommand) {
  iframe?.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args: [] }), "*");
}

/**
 * Responsive 16:9 YouTube embed that starts playing (muted — browsers block
 * autoplay with sound until the visitor has already interacted with the
 * site, no URL param or JS trick can override that) the first time it
 * scrolls into view, pauses when it scrolls back out, and resumes on
 * re-entry — never resets to the start once it has loaded. A floating
 * speaker button lets the visitor turn sound on with one click.
 */
export default function YoutubeEmbed({ url, className = "" }: YoutubeEmbedProps) {
  const videoId = extractYoutubeVideoId(url);
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  // Mirrors `hasLoaded` for the observer callback below, which is set up once
  // per videoId (not re-subscribed on every hasLoaded flip) and so would
  // otherwise only ever see the `false` it closed over.
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    if (!videoId) return;
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        if (entry.isIntersecting) {
          if (!hasLoadedRef.current) {
            // First time in view: mount the iframe with autoplay so it loads
            // already playing, instead of loading paused then commanding play
            // (fragile — the player may not be ready to receive it yet).
            hasLoadedRef.current = true;
            setHasLoaded(true);
          } else {
            postPlayerCommand(iframeRef.current, "playVideo");
          }
        } else if (hasLoadedRef.current) {
          postPlayerCommand(iframeRef.current, "pauseVideo");
        }
      },
      { threshold: 0.5 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [videoId]);

  if (!videoId) {
    return (
      <div
        className={`aspect-video w-full rounded-lg bg-gray-100 border border-dashed border-gray-300 flex items-center justify-center text-sm text-gray-400 ${className}`}
      >
        ลิงก์ YouTube ไม่ถูกต้อง
      </div>
    );
  }

  function toggleMute() {
    const next = !isMuted;
    postPlayerCommand(iframeRef.current, next ? "mute" : "unMute");
    setIsMuted(next);
  }

  return (
    <div ref={containerRef} className={`relative aspect-video w-full rounded-lg overflow-hidden bg-black ${className}`}>
      <iframe
        ref={iframeRef}
        className="w-full h-full"
        // enablejsapi=1 lets the play/pauseVideo/mute/unMute postMessage
        // commands above reach the player once it has loaded.
        src={`https://www.youtube-nocookie.com/embed/${videoId}?enablejsapi=1${hasLoaded ? "&autoplay=1&mute=1" : ""}`}
        title="YouTube video player"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
      />
      {hasLoaded && (
        <button
          type="button"
          onClick={toggleMute}
          aria-label={isMuted ? "เปิดเสียง" : "ปิดเสียง"}
          title={isMuted ? "เปิดเสียง" : "ปิดเสียง"}
          className="absolute bottom-3 right-3 z-10 w-9 h-9 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center transition"
        >
          {isMuted ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <line x1="23" y1="9" x2="17" y2="15" />
              <line x1="17" y1="9" x2="23" y2="15" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
            </svg>
          )}
        </button>
      )}
    </div>
  );
}
