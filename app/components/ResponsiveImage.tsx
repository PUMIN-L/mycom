"use client";

// An <img> for a stored Cloudinary URL, delivered at the width the layout
// needs and in WebP/AVIF (lib/cloudinaryUrl.ts). Anything that is not a
// Cloudinary image renders exactly as before.
//
// If the resized URL fails — a Cloudinary account with "strict
// transformations" switched on refuses any transformation it was not told
// about in advance — the image falls back to the original URL rather than
// showing broken. Two paths reach the fallback: onError, and a check on mount
// for an image that already failed while the server-rendered HTML was
// loading, before React was listening.

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { cloudinaryResponsive } from "../lib/cloudinaryUrl";

export default function ResponsiveImage({
  src,
  alt,
  sizes,
  loading,
  className,
  style,
}: {
  src: string;
  alt: string;
  /** The rendered width, as the <img sizes> attribute. */
  sizes: string;
  loading?: "eager" | "lazy";
  className?: string;
  style?: CSSProperties;
}) {
  const responsive = cloudinaryResponsive(src);
  // Which src the resized delivery failed for — so a new image (an edit
  // replaced it) automatically gets a fresh try.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const ref = useRef<HTMLImageElement>(null);
  const optimized = responsive && failedSrc !== src ? responsive : null;

  useEffect(() => {
    const img = ref.current;
    // complete + no pixels + a source chosen = it errored before hydration.
    // (A lazy image not loaded yet has no currentSrc, so it is left alone.)
    if (optimized && img && img.complete && img.currentSrc && img.naturalWidth === 0) {
      setFailedSrc(src);
    }
  }, [optimized, src]);

  return (
    // eslint-disable-next-line @next/next/no-img-element -- sized by the block's width %, with no stored dimensions for next/image
    <img
      ref={ref}
      src={optimized ? optimized.src : src}
      srcSet={optimized ? optimized.srcSet : undefined}
      sizes={optimized ? sizes : undefined}
      alt={alt}
      loading={loading}
      decoding="async"
      className={className}
      style={style}
      onError={() => {
        if (optimized) setFailedSrc(src);
      }}
    />
  );
}
