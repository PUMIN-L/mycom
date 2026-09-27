// @vitest-environment node
/**
 * Which remote images /_next/image will resize (next.config.ts). The endpoint
 * is public and every image it serves costs image-optimization quota, so it
 * must take this site's own photos and flags — not any Cloudinary account's
 * images, not a Cloudinary fetch of an arbitrary URL, not a QR generator.
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
  it("takes photos uploaded to our cloud, with or without a transformation", async () => {
    const p = await patternsFor("mycloud");
    expect(allowed(p, "https://res.cloudinary.com/mycloud/image/upload/v1712/samples/mycom/scale.jpg")).toBe(true);
    expect(allowed(p, "https://res.cloudinary.com/mycloud/image/upload/w_800,f_jpg,pg_1/v1712/doc.pdf")).toBe(true);
  });

  it("refuses another Cloudinary account's images", async () => {
    const p = await patternsFor("mycloud");
    expect(allowed(p, "https://res.cloudinary.com/demo/image/upload/v1/sample.jpg")).toBe(false);
    expect(allowed(p, "https://res.cloudinary.com/mycloud-evil/image/upload/v1/x.jpg")).toBe(false);
  });

  it("refuses our cloud's fetch / other delivery types — they pull in arbitrary web images", async () => {
    const p = await patternsFor("mycloud");
    expect(allowed(p, "https://res.cloudinary.com/mycloud/image/fetch/https://example.com/huge.jpg")).toBe(false);
    expect(allowed(p, "https://res.cloudinary.com/mycloud/video/upload/v1/clip.jpg")).toBe(false);
    expect(allowed(p, "https://res.cloudinary.com/mycloud/raw/upload/v1/file.pdf")).toBe(false);
  });

  it("refuses a query string — one photo would otherwise become unlimited optimizations", async () => {
    const p = await patternsFor("mycloud");
    expect(allowed(p, "https://res.cloudinary.com/mycloud/image/upload/v1/x.jpg?1")).toBe(false);
  });

  it("refuses plain http", async () => {
    const p = await patternsFor("mycloud");
    expect(allowed(p, "http://res.cloudinary.com/mycloud/image/upload/v1/x.jpg")).toBe(false);
  });

  it("fails closed with no cloud name, or one that would be read as a glob", async () => {
    for (const name of [undefined, "", "*", "my*cloud", "{a,b}"]) {
      const p = await patternsFor(name);
      expect(p.some((x) => "hostname" in x && x.hostname === "res.cloudinary.com")).toBe(false);
      expect(allowed(p, "https://res.cloudinary.com/mycloud/image/upload/v1/x.jpg")).toBe(false);
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
