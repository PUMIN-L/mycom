// @vitest-environment node
/**
 * Which remote images /_next/image will resize (next.config.ts). The endpoint
 * is public and every image it serves costs image-optimization quota, so it
 * takes the navbar's flags and nothing else — no Cloudinary URL at all (photos
 * are resized by Cloudinary through next/image's loader), no QR generator.
 * Checked with Next's own matcher, the one the optimizer runs.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { hasRemoteMatch } from "next/dist/shared/lib/match-remote-pattern";

async function patternsFor(cloudName: string | undefined) {
  vi.resetModules();
  vi.stubEnv("CLOUDINARY_CLOUD_NAME", cloudName);
  const config = (await import("../next.config")).default;
  return config.images!.remotePatterns! as Parameters<typeof hasRemoteMatch>[1];
}

const allowed = (patterns: Parameters<typeof hasRemoteMatch>[1], url: string) =>
  hasRemoteMatch([], patterns, new URL(url));

const root = path.resolve(__dirname, "..");

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("next.config.ts images.remotePatterns — Cloudinary", () => {
  // Even a pattern pinned to our own cloud's /image/upload/ let anyone mint
  // endless "new" images: Cloudinary accepts any transformation in front of a
  // real public id, and each such URL is a fresh optimization. Photos are
  // resized by Cloudinary instead (SkeletonImage's loader), so the optimizer
  // takes no Cloudinary URL at all — whatever the cloud name.
  it.each([undefined, "", "mycloud"])("accepts no Cloudinary URL (CLOUDINARY_CLOUD_NAME=%s)", async (cloud) => {
    const p = await patternsFor(cloud);
    expect(p.some((x) => "hostname" in x && String(x.hostname).includes("cloudinary"))).toBe(false);
    for (const url of [
      "https://res.cloudinary.com/mycloud/image/upload/v1712/samples/mycom/scale.jpg",
      "https://res.cloudinary.com/mycloud/image/upload/w_1/v1712/samples/mycom/scale.jpg",
      "https://res.cloudinary.com/mycloud/image/fetch/https://example.com/huge.jpg",
      "https://res.cloudinary.com/demo/image/upload/v1/sample.jpg",
    ]) {
      expect(allowed(p, url), url).toBe(false);
    }
  });
});

describe("next.config.ts images.remotePatterns — everything else", () => {
  it("takes every language flag the navbar shows", async () => {
    const p = await patternsFor("mycloud");
    const navbar = fs.readFileSync(path.join(root, "app/components/Navbar.tsx"), "utf8");
    const flags = navbar.match(/https:\/\/flagcdn\.com\/[^"'`\s]+/g) ?? [];
    expect(flags.length).toBeGreaterThan(0);
    for (const url of flags) expect(allowed(p, url)).toBe(true);
  });

  it("refuses other flag sizes and query strings", async () => {
    const p = await patternsFor("mycloud");
    expect(allowed(p, "https://flagcdn.com/w2560/th.png")).toBe(false);
    expect(allowed(p, "https://flagcdn.com/w40/th.png?1")).toBe(false);
  });

  it("refuses the QR generator and the unused Unsplash host", async () => {
    const p = await patternsFor("mycloud");
    expect(allowed(p, "https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=anything")).toBe(false);
    expect(allowed(p, "https://images.unsplash.com/photo-1?w=4000")).toBe(false);
  });

  // With api.qrserver.com out of remotePatterns, a LINE QR <Image> without
  // `unoptimized` would 400 in production (and throw in `next dev`).
  it("every LINE QR <Image> renders unoptimized", () => {
    const files = ["app/components/Contact.tsx", "app/components/LineQrModal.tsx", "app/showcase/product/[productId]/page.tsx"];
    let found = 0;
    for (const file of files) {
      const src = fs.readFileSync(path.join(root, file), "utf8");
      for (let i = src.indexOf("src={lineQrUrl("); i !== -1; i = src.indexOf("src={lineQrUrl(", i + 1)) {
        const element = src.slice(src.lastIndexOf("<Image", i), src.indexOf("/>", i));
        expect(element, file).toMatch(/\bunoptimized\b/);
        found++;
      }
    }
    expect(found).toBe(files.length);
  });
});
