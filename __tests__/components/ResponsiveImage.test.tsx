/**
 * Content images are delivered resized by Cloudinary — and fall back to the
 * original file if that delivery fails (e.g. an account with strict
 * transformations), rather than showing a broken image.
 */
import { render, cleanup, fireEvent } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import ResponsiveImage from "@/app/components/ResponsiveImage";

afterEach(cleanup);

const ORIGINAL = "https://res.cloudinary.com/demo/image/upload/v1/x.jpg";

describe("ResponsiveImage", () => {
  it("serves a resized Cloudinary copy with srcset and sizes", () => {
    const { container } = render(<ResponsiveImage src={ORIGINAL} alt="GM-4" sizes="800px" />);
    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toBe(
      "https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,c_limit,w_1200/v1/x.jpg"
    );
    expect(img.getAttribute("srcset")).toContain("w_480/v1/x.jpg 480w");
    expect(img.getAttribute("sizes")).toBe("800px");
    expect(img.getAttribute("alt")).toBe("GM-4");
  });

  it("falls back to the original file when the resized one fails", () => {
    const { container } = render(<ResponsiveImage src={ORIGINAL} alt="GM-4" sizes="800px" />);
    fireEvent.error(container.querySelector("img")!);
    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toBe(ORIGINAL);
    expect(img.hasAttribute("srcset")).toBe(false);
    expect(img.hasAttribute("sizes")).toBe(false);
  });

  it("also falls back when the resized copy failed before React hydrated (no onError then)", () => {
    // What the browser reports for an <img> whose load already failed.
    const proto = HTMLImageElement.prototype;
    const restore = (["complete", "currentSrc", "naturalWidth"] as const).map((key) => {
      const original = Object.getOwnPropertyDescriptor(proto, key);
      const value = { complete: true, currentSrc: "https://res.cloudinary.com/x", naturalWidth: 0 }[key];
      Object.defineProperty(proto, key, { configurable: true, get: () => value });
      return () => (original ? Object.defineProperty(proto, key, original) : delete (proto as never)[key]);
    });
    try {
      const { container } = render(<ResponsiveImage src={ORIGINAL} alt="GM-4" sizes="800px" />);
      expect(container.querySelector("img")!.getAttribute("src")).toBe(ORIGINAL);
    } finally {
      restore.forEach((r) => r());
    }
  });

  it("gives a new image a fresh try after an earlier one failed", () => {
    const { container, rerender } = render(<ResponsiveImage src={ORIGINAL} alt="a" sizes="800px" />);
    fireEvent.error(container.querySelector("img")!);
    const next = "https://res.cloudinary.com/demo/image/upload/v2/y.jpg";
    rerender(<ResponsiveImage src={next} alt="a" sizes="800px" />);
    expect(container.querySelector("img")!.getAttribute("src")).toContain("w_1200/v2/y.jpg");
  });

  it("renders anything that is not a Cloudinary image exactly as given", () => {
    const { container } = render(<ResponsiveImage src="/images/x.png" alt="x" sizes="800px" />);
    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("/images/x.png");
    expect(img.hasAttribute("srcset")).toBe(false);
    // An error on an unoptimized image changes nothing (there is no fallback).
    fireEvent.error(img);
    expect(container.querySelector("img")!.getAttribute("src")).toBe("/images/x.png");
  });
});

// Until the photo has loaded, its box shows the loading skeleton (the <img>'s
// own background) in a 4:3 box — it has no size of its own before then. It
// used to sit empty and the photo popped in.
describe("ResponsiveImage — the loading skeleton", () => {
  const isLoading = (img: HTMLImageElement) => img.style.backgroundImage.includes("data:image/svg+xml");

  it("shows the skeleton while the photo loads, keeping the width it was given", () => {
    const { container } = render(
      <ResponsiveImage src={ORIGINAL} alt="a" sizes="800px" style={{ width: "60%" }} />
    );
    const img = container.querySelector("img")!;
    expect(isLoading(img)).toBe(true);
    expect(img.getAttribute("style")).toContain("aspect-ratio");
    expect(img.style.width).toBe("60%");
  });

  it("drops it once the photo has loaded", () => {
    const { container } = render(
      <ResponsiveImage src={ORIGINAL} alt="a" sizes="800px" style={{ width: "60%" }} />
    );
    fireEvent.load(container.querySelector("img")!);
    const img = container.querySelector("img")!;
    expect(isLoading(img)).toBe(false);
    expect(img.getAttribute("style")).not.toContain("aspect-ratio");
    expect(img.style.width).toBe("60%");
  });

  it("keeps it while the original is tried after the resized copy failed, then drops it if that fails too", () => {
    const { container } = render(<ResponsiveImage src={ORIGINAL} alt="a" sizes="800px" />);
    fireEvent.error(container.querySelector("img")!);
    expect(isLoading(container.querySelector("img")!)).toBe(true);
    fireEvent.error(container.querySelector("img")!);
    expect(isLoading(container.querySelector("img")!)).toBe(false);
  });

  it("drops it for a photo that had loaded before React hydrated (no onLoad then)", () => {
    const proto = HTMLImageElement.prototype;
    const restore = (["complete", "currentSrc", "naturalWidth"] as const).map((key) => {
      const original = Object.getOwnPropertyDescriptor(proto, key);
      const value = { complete: true, currentSrc: "https://res.cloudinary.com/x", naturalWidth: 800 }[key];
      Object.defineProperty(proto, key, { configurable: true, get: () => value });
      return () => (original ? Object.defineProperty(proto, key, original) : delete (proto as never)[key]);
    });
    try {
      const { container } = render(<ResponsiveImage src={ORIGINAL} alt="a" sizes="800px" />);
      expect(isLoading(container.querySelector("img")!)).toBe(false);
    } finally {
      restore.forEach((r) => r());
    }
  });

  it("shows it again for a new photo", () => {
    const { container, rerender } = render(<ResponsiveImage src={ORIGINAL} alt="a" sizes="800px" />);
    fireEvent.load(container.querySelector("img")!);
    rerender(<ResponsiveImage src="https://res.cloudinary.com/demo/image/upload/v2/y.jpg" alt="a" sizes="800px" />);
    expect(isLoading(container.querySelector("img")!)).toBe(true);
  });
});
