"use client";

// next/image for a PRODUCT or CONTENT photo: the box shows a loading skeleton
// (lib/imageSkeleton.ts) until the photo has loaded, instead of sitting empty.
// next/image drops the skeleton itself on load — including for a photo that
// finished loading before React hydrated — and on error.
//
// Use it for every product / content photo. The site's own fixed images
// (hero, about, logo, the LINE QR) load with the page and stay plain <Image>.
//
// CLOUDINARY PHOTOS ARE RESIZED BY CLOUDINARY (cloudinaryImageLoader), never
// by Vercel's /_next/image — res.cloudinary.com is deliberately not in
// images.remotePatterns (next.config.ts explains why). Two fall-backs:
//   * a Cloudinary URL that already carries a transformation is shown as it
//     is (`unoptimized`) rather than handed to an optimizer that refuses it;
//   * if the resized delivery fails — an account with "strict
//     transformations" on refuses transformations it was not told about —
//     the photo is shown from its original URL, as ResponsiveImage does.

import { useState } from "react";
import Image, { type ImageProps } from "next/image";
import { IMAGE_SKELETON } from "../lib/imageSkeleton";
import { cloudinaryImageLoader, cloudinaryResized } from "../lib/cloudinaryUrl";

const CLOUDINARY_PREFIX = "https://res.cloudinary.com/";

export default function SkeletonImage({ alt, placeholder, src, onError, ...props }: ImageProps) {
  // The src whose resized delivery failed — a new src starts over.
  const [resizeFailedFor, setResizeFailedFor] = useState<string | null>(null);

  const url = typeof src === "string" ? src : null;
  const onCloudinary = url !== null && url.startsWith(CLOUDINARY_PREFIX);
  const resizable = onCloudinary && cloudinaryResized(url, 1) !== null;
  const useLoader = resizable && resizeFailedFor !== url;

  return (
    <Image
      alt={alt}
      src={src}
      placeholder={placeholder ?? IMAGE_SKELETON}
      {...(useLoader ? { loader: cloudinaryImageLoader } : onCloudinary ? { unoptimized: true } : {})}
      onError={(event) => {
        if (useLoader) setResizeFailedFor(url);
        onError?.(event);
      }}
      {...props}
    />
  );
}
