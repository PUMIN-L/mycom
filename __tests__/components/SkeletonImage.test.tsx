/**
 * A product or content photo shows a loading skeleton in its box until the
 * photo has loaded — next/image's `placeholder`, painted as the <img>'s own
 * background, so it is in the first HTML and never hides the photo.
 */
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import SkeletonImage from "@/app/components/SkeletonImage";

afterEach(cleanup);

const hasSkeleton = (img: HTMLImageElement) => img.style.backgroundImage.includes("data:image/svg+xml");

describe("SkeletonImage", () => {
  it("paints the skeleton behind the photo until it loads, then drops it", async () => {
    const { container } = render(
      <div style={{ position: "relative", width: 200, height: 200 }}>
        <SkeletonImage src="https://res.cloudinary.com/demo/image/upload/v1/p.jpg" alt="เครื่องชั่ง" fill sizes="200px" />
      </div>
    );
    const img = container.querySelector("img")!;
    expect(img.getAttribute("alt")).toBe("เครื่องชั่ง");
    expect(hasSkeleton(img)).toBe(true);
    expect(img.style.opacity).not.toBe("0"); // the photo itself is never hidden

    fireEvent.load(img);
    await waitFor(() => expect(hasSkeleton(container.querySelector("img")!)).toBe(false));
  });

  // Server-rendered HTML: the photo can finish before React hydrates, and then
  // no load event comes. Left behind, the skeleton would show through a
  // transparent PNG for good.
  it("drops it for a photo that had loaded before React was listening", async () => {
    const proto = HTMLImageElement.prototype;
    const original = Object.getOwnPropertyDescriptor(proto, "complete");
    Object.defineProperty(proto, "complete", { configurable: true, get: () => true });
    try {
      const { container } = render(
        <div style={{ position: "relative", width: 200, height: 200 }}>
          <SkeletonImage src="https://res.cloudinary.com/demo/image/upload/v1/cached.jpg" alt="x" fill sizes="200px" />
        </div>
      );
      await waitFor(() => expect(hasSkeleton(container.querySelector("img")!)).toBe(false));
    } finally {
      if (original) Object.defineProperty(proto, "complete", original);
      else delete (proto as never as Record<string, unknown>).complete;
    }
  });

  it("drops it when the photo fails, instead of shimmering for ever", async () => {
    const { container } = render(
      <div style={{ position: "relative", width: 200, height: 200 }}>
        <SkeletonImage src="https://res.cloudinary.com/demo/image/upload/v1/gone.jpg" alt="x" fill sizes="200px" />
      </div>
    );
    fireEvent.error(container.querySelector("img")!);
    await waitFor(() => expect(hasSkeleton(container.querySelector("img")!)).toBe(false));
  });
});

// Cloudinary photos are resized by CLOUDINARY, never by Vercel's /_next/image:
// res.cloudinary.com is not in images.remotePatterns at all (next.config.ts),
// because a pattern there let anyone mint endless "new" images to optimize.
describe("SkeletonImage — who resizes the photo", () => {
  const PHOTO = "https://res.cloudinary.com/demo/image/upload/v1712/samples/mycom/scale.jpg";
  const box = (node: React.ReactNode) => (
    <div style={{ position: "relative", width: 200, height: 200 }}>{node}</div>
  );

  it("asks Cloudinary for every width, and never /_next/image", () => {
    const { container } = render(box(<SkeletonImage src={PHOTO} alt="x" fill sizes="200px" />));
    const img = container.querySelector("img")!;
    // srcset entries are ", "-separated; the URLs themselves contain bare commas
    const urls = [img.getAttribute("src")!, ...(img.getAttribute("srcset") ?? "").split(", ").map((s) => s.trim().split(" ")[0])];
    expect(urls.length).toBeGreaterThan(1);
    for (const url of urls) {
      expect(url).not.toContain("/_next/image");
      expect(url).toMatch(/^https:\/\/res\.cloudinary\.com\/demo\/image\/upload\/f_auto,q_auto,c_limit,w_\d+\/v1712\/samples\/mycom\/scale\.jpg$/);
    }
  });

  it("shows a Cloudinary URL that already carries a transformation exactly as it is", () => {
    const transformed = "https://res.cloudinary.com/demo/image/upload/w_800,f_jpg/v1/doc.jpg";
    const { container } = render(box(<SkeletonImage src={transformed} alt="x" fill sizes="200px" />));
    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toBe(transformed);
    expect(img.getAttribute("srcset")).toBeNull();
  });

  it("leaves the site's own images to next/image as before", () => {
    const { container } = render(box(<SkeletonImage src="/images/hero-bg.jpg" alt="x" fill sizes="200px" />));
    expect(container.querySelector("img")!.getAttribute("src")).toContain("/_next/image");
  });

  // An account with "strict transformations" on refuses resizes it was not
  // told about: fall back to the original rather than show a broken photo.
  it("falls back to the original URL when the resized one fails, and still tells the caller", async () => {
    const onError = vi.fn();
    const { container } = render(box(<SkeletonImage src={PHOTO} alt="x" fill sizes="200px" onError={onError} />));
    fireEvent.error(container.querySelector("img")!);
    await waitFor(() => expect(container.querySelector("img")!.getAttribute("src")).toBe(PHOTO));
    expect(container.querySelector("img")!.getAttribute("srcset")).toBeNull();
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

// Every product / content photo on the display pages goes through
// SkeletonImage (or ResponsiveImage, which has its own). A plain next/image
// there would be a photo popping into an empty box again.
describe("product and content photos use the skeleton", () => {
  it.each([
    "app/components/Products.tsx",
    "app/components/ProductCatalogView.tsx",
    "app/catalog/CatalogClient.tsx",
    "app/showcase/[id]/ShowcaseClient.tsx",
  ])("%s has no plain next/image", (file) => {
    const src = fs.readFileSync(path.resolve(__dirname, "../..", file), "utf8");
    expect(src).not.toMatch(/from ["']next\/image["']/);
    expect(src).toContain("SkeletonImage");
  });
});
