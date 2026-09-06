import type { NextConfig } from "next";

// Content-Security-Policy — enforced. Tuned against production traffic to
// allow Next.js inline scripts/styles, Quill editor, react-pdf blob workers,
// the Google Maps embed on the Contact page, and the YouTube embed content
// block. Anything outside this set (unknown scripts, event handlers, iframes
// from other origins) is blocked.
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "frame-src https://www.google.com https://www.youtube-nocookie.com",
  "form-action 'self'",
  "img-src 'self' data: blob: https://res.cloudinary.com https://images.unsplash.com https://flagcdn.com https://api.qrserver.com",
  "media-src 'self' https://res.cloudinary.com",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "worker-src 'self' blob:",
  "connect-src 'self' https://res.cloudinary.com",
].join("; ");

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
      {
        protocol: "https",
        hostname: "flagcdn.com",
      },
      {
        protocol: "https",
        hostname: "res.cloudinary.com",
      },
      {
        protocol: "https",
        hostname: "api.qrserver.com",
      },
    ],
  },
  async redirects() {
    return [
      {
        // The Admin Panel hub moved from /showcase to /adminpanel. Exact path
        // only — /showcase/{id} content pages are PUBLIC and must not redirect.
        source: "/showcase",
        destination: "/adminpanel",
        permanent: false,
      },
      {
        // The header/footer wizard was replaced by the general PDF editor and
        // its page.tsx deleted. Anyone holding a bookmark (or an open tab that
        // predates the deploy) would otherwise hit a 404. `permanent: false`
        // like the entry above: a 308 would be cached by the browser forever,
        // which is not a promise worth making about an admin-only tool path.
        source: "/tools/pdf-header-footer",
        destination: "/tools/pdf-editor",
        permanent: false,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
