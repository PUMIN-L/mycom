// @vitest-environment node
import { describe, it, expect } from "vitest";
import { cloudinaryResized, cloudinaryResponsive, RESPONSIVE_WIDTHS } from "@/app/lib/cloudinaryUrl";

const BASE = "https://res.cloudinary.com/demo/image/upload";

describe("cloudinaryResized", () => {
  it("asks Cloudinary for a width-limited, auto-format, auto-quality copy", () => {
    expect(cloudinaryResized(`${BASE}/v1712/samples/mycom/x.jpg`, 800)).toBe(
      `${BASE}/f_auto,q_auto,c_limit,w_800/v1712/samples/mycom/x.jpg`
    );
  });

  it("works without a version segment, and keeps a query string", () => {
    expect(cloudinaryResized(`${BASE}/samples/x.png?_a=1`, 480)).toBe(
      `${BASE}/f_auto,q_auto,c_limit,w_480/samples/x.png?_a=1`
    );
  });

  it("leaves a URL that already carries a transformation alone", () => {
    expect(cloudinaryResized(`${BASE}/w_800,f_jpg/v1/x.jpg`, 800)).toBeNull();
    expect(cloudinaryResized(`${BASE}/c_fill,h_200,w_200/x.jpg`, 800)).toBeNull();
  });

  it("only touches images on Cloudinary", () => {
    expect(cloudinaryResized("https://res.cloudinary.com/demo/raw/upload/v1/doc.pdf", 800)).toBeNull();
    expect(cloudinaryResized("/images/hero-bg.jpg", 800)).toBeNull();
    expect(cloudinaryResized("http://res.cloudinary.com/demo/image/upload/v1/x.jpg", 800)).toBeNull();
    expect(cloudinaryResized("https://example.com/demo/image/upload/v1/x.jpg", 800)).toBeNull();
    expect(cloudinaryResized("not a url", 800)).toBeNull();
  });
});

describe("cloudinaryResponsive", () => {
  it("offers every width in srcset, with a 1200 src", () => {
    const r = cloudinaryResponsive(`${BASE}/v1/x.jpg`)!;
    expect(r.src).toBe(`${BASE}/f_auto,q_auto,c_limit,w_1200/v1/x.jpg`);
    expect(r.srcSet.split(", ")).toEqual(
      RESPONSIVE_WIDTHS.map((w) => `${BASE}/f_auto,q_auto,c_limit,w_${w}/v1/x.jpg ${w}w`)
    );
  });

  it("is null for anything else", () => {
    expect(cloudinaryResponsive("/images/x.png")).toBeNull();
  });
});
