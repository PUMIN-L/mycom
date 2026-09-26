// The skeleton a product or content photo shows in its box while the photo
// itself is still loading — a light grey panel with a slow highlight sweeping
// across it. Without it the box sat empty (the card's text had arrived, the
// photo had not) and the photo popped in a moment later.
//
// It is painted as the <img>'s own background (next/image's `placeholder`,
// or ResponsiveImage's style), so it is in the server-rendered HTML from the
// first paint, needs no JavaScript to appear, and never hides the photo: the
// photo draws over it the instant it loads, and the background is dropped.
// Hiding the photo until a fade-in finished would have delayed Largest
// Contentful Paint.
//
// For the site's own fixed images (hero, about, logo) this is not wanted —
// they load with the page.

const W = 400;
const H = 300;

const SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
  `<defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="0">` +
  `<stop offset="0" stop-color="#e9ebef"/>` +
  `<stop offset="0.5" stop-color="#f6f7f9"/>` +
  `<stop offset="1" stop-color="#e9ebef"/>` +
  `</linearGradient></defs>` +
  `<rect width="${W}" height="${H}" fill="#e9ebef"/>` +
  `<rect width="${W}" height="${H}" fill="url(#g)">` +
  `<animate attributeName="x" from="-${W}" to="${W}" dur="1.4s" repeatCount="indefinite"/>` +
  `</rect>` +
  `</svg>`;

/** A `data:image/svg+xml` URL — next/image accepts it as `placeholder`. */
export const IMAGE_SKELETON: `data:image/${string}` = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(SVG)}`;
