"use client";
import { useEffect, useRef, useState } from "react";
import { extractYoutubeVideoId } from "../lib/youtube";

interface YoutubeEmbedProps {
  url: string;
  className?: string;
}

function postPlayerCommand(iframe: HTMLIFrameElement | null, func: "playVideo" | "pauseVideo") {
  iframe?.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args: [] }), "*");
}

/**
 * Responsive 16:9 YouTube embed that starts playing (muted, autoplay only
 * works muted without a user gesture) the first time it scrolls into view,
 * pauses when it scrolls back out, and resumes on re-entry — never resets to
 * the start once it has loaded.
 */
export default function YoutubeEmbed({ url, className = "" }: YoutubeEmbedProps) {
  const videoId = extractYoutubeVideoId(url);
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
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

  return (
    <div ref={containerRef} className={`aspect-video w-full rounded-lg overflow-hidden bg-black ${className}`}>
      <iframe
        ref={iframeRef}
        className="w-full h-full"
        // enablejsapi=1 lets the play/pauseVideo postMessage commands above
        // reach the player once it has loaded.
        src={`https://www.youtube-nocookie.com/embed/${videoId}?enablejsapi=1${hasLoaded ? "&autoplay=1&mute=1" : ""}`}
        title="YouTube video player"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
      />
    </div>
  );
}
