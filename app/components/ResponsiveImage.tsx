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
//
// Until the photo has loaded, its box shows the loading skeleton
// (lib/imageSkeleton.ts) as the <img>'s own background. The box has no size
// of its own before then — no stored dimensions, just a width % — so it also
// gets `aspect-ratio: auto 4 / 3`: a 4:3 box while the photo's shape is
// unknown, and the photo's own shape the moment it is known (that is what
// `auto` means), without any JavaScript. The mount check also catches a photo
// that loaded before hydration, when no onLoad will come.

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { cloudinaryResponsive } from "../lib/cloudinaryUrl";
import { IMAGE_SKELETON } from "../lib/imageSkeleton";

const LOADING_STYLE: CSSProperties = {
  aspectRatio: "auto 4 / 3",
  backgroundImage: `url("${IMAGE_SKELETON}")`,
  backgroundSize: "cover",
  backgroundPosition: "50% 50%",
  backgroundRepeat: "no-repeat",
};

interface LoadResult {
  /** The stored URL this result is about — a new image starts over. */
  src: string;
  /** The resized delivery failed, so the original URL is shown instead. */
  resizedFailed: boolean;
  /** Loaded, or failed for good: the skeleton is gone either way. */
  settled: boolean;
}

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
  const [result, setResult] = useState<LoadResult | null>(null);
  const current = result?.src === src ? result : null;
  const resizedFailed = current?.resizedFailed ?? false;
  const optimized = responsive && !resizedFailed ? responsive : null;
  const settled = current?.settled ?? false;
  const ref = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const img = ref.current;
    // Not finished (or lazy and not started — no currentSrc yet): onLoad /
    // onError will report it.
    if (settled || !img || !img.complete || !img.currentSrc) return;
    if (img.naturalWidth > 0) {
      // Loaded before React was listening.
      setResult({ src, resizedFailed, settled: true });
    } else {
      // Failed before React was listening: retry the original, or give up.
      setResult(optimized ? { src, resizedFailed: true, settled: false } : { src, resizedFailed, settled: true });
    }
  }, [optimized, resizedFailed, settled, src]);

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
      style={settled ? style : { ...LOADING_STYLE, ...style }}
      onLoad={() => setResult({ src, resizedFailed, settled: true })}
      onError={() =>
        setResult(optimized ? { src, resizedFailed: true, settled: false } : { src, resizedFailed, settled: true })
      }
    />
  );
}
