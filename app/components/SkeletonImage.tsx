// next/image for a PRODUCT or CONTENT photo: the box shows a loading skeleton
// (lib/imageSkeleton.ts) until the photo has loaded, instead of sitting empty.
// next/image drops the skeleton itself on load — including for a photo that
// finished loading before React hydrated — and on error.
//
// Use it for every product / content photo. The site's own fixed images
// (hero, about, logo, the LINE QR) load with the page and stay plain <Image>.

import Image, { type ImageProps } from "next/image";
import { IMAGE_SKELETON } from "../lib/imageSkeleton";

export default function SkeletonImage({ alt, placeholder, ...props }: ImageProps) {
  return <Image alt={alt} placeholder={placeholder ?? IMAGE_SKELETON} {...props} />;
}
