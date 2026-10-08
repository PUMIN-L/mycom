/**
 * Showcase gallery — picking a thumbnail shows its picture at once.
 *
 * The big box used to hold ONE <img> whose src changed on click, so a
 * picture's large size was first requested at that moment (only its 96px
 * thumbnail had been fetched) and the box sat on the loading skeleton every
 * time. Every picture now has its own large <img>, stacked; a click only
 * changes which one is visible. The others are mounted once the visible one
 * has loaded, so the first picture (the page's LCP) never competes with them.
 */

import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";

vi.setConfig({ testTimeout: 30_000 });

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => "/showcase/c1",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/app/context/AuthContext", () => ({
  useAuth: () => ({ isLoggedIn: false }),
}));
vi.mock("@/app/i18n/LanguageContext", () => ({
  useLanguage: () => ({ lang: "th", setLang: vi.fn() }),
  useT: () => (o: { th: string } | undefined) => o?.th ?? "",
}));
vi.mock("@/app/components/Navbar", () => ({ default: () => null }));
vi.mock("@/app/components/Footer", () => ({ default: () => null }));

import ShowcaseClient from "@/app/showcase/[id]/ShowcaseClient";
import type { ContentBlock } from "@/app/lib/types";

const URLS = [
  "https://res.cloudinary.com/demo/image/upload/v1/mycom/spec.jpg",
  "https://res.cloudinary.com/demo/image/upload/v1/mycom/front.jpg",
  "https://res.cloudinary.com/demo/image/upload/v1/mycom/side.jpg",
];

function renderGallery() {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })));
  render(
    <ShowcaseClient
      initialContent={{
        id: "c1",
        title: "เครื่องชั่ง PR224",
        blocks: [{ id: "g1", type: "gallery", imageUrls: URLS, selectedImageIndex: 0 } as ContentBlock],
        createdAt: "2026-09-01",
        productId: null,
      }}
      initialAllContents={[]}
      initialProducts={[]}
      initialCategories={[]}
      companyInfo={{ email: "x@y.z", phone: "0", address: "ที่อยู่" }}
      maintenanceOn={false}
      adminView={false}
    />
  );
}

/** The big box's pictures — the thumbnails are the 96px ones. */
const largeImages = () =>
  Array.from(document.querySelectorAll("img")).filter((img) => img.getAttribute("sizes") !== "96px" && /mycom\/(spec|front|side)/.test(img.getAttribute("src") ?? ""));
const visibleLarge = () => largeImages().filter((img) => !img.className.includes("opacity-0"));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("showcase gallery — switching pictures", () => {
  it("renders the chosen picture alone until it has loaded", () => {
    renderGallery();
    expect(largeImages()).toHaveLength(1);
    expect(largeImages()[0].getAttribute("alt")).toBe("เครื่องชั่ง PR224 – รูปที่ 1");
  });

  it("then mounts the others hidden, and a thumbnail click only changes which one shows", async () => {
    renderGallery();
    // next/image reports the load after the picture has decoded (a promise).
    fireEvent.load(largeImages()[0]);
    await waitFor(() => expect(largeImages()).toHaveLength(3));

    const all = largeImages();
    expect(visibleLarge()).toHaveLength(1);
    // Hidden ones are not part of the page for a screen reader.
    const hidden = all.filter((img) => img.className.includes("opacity-0"));
    expect(hidden.every((img) => img.getAttribute("alt") === "" && img.getAttribute("aria-hidden") === "true")).toBe(true);
    const srcsBefore = all.map((img) => img.getAttribute("src"));

    fireEvent.click(screen.getByAltText("เครื่องชั่ง PR224 – รูปที่ 2").closest("div")!);

    // The same three elements, the same three URLs — nothing new to fetch.
    expect(largeImages().map((img) => img.getAttribute("src"))).toEqual(srcsBefore);
    expect(visibleLarge()).toHaveLength(1);
    expect(visibleLarge()[0].getAttribute("src")).toBe(srcsBefore[1]);
    expect(visibleLarge()[0].getAttribute("alt")).toBe("เครื่องชั่ง PR224 – รูปที่ 2");
  });

  it("reaching for the gallery warms it up too, before the first picture has loaded", () => {
    renderGallery();
    fireEvent.pointerEnter(screen.getByAltText("เครื่องชั่ง PR224 – รูปที่ 3").closest("div")!);
    expect(largeImages()).toHaveLength(3);
  });
});

describe("showcase gallery — a stored index past the end", () => {
  it("shows the last picture, not an empty box", () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })));
    render(
      <ShowcaseClient
        initialContent={{
          id: "c1",
          title: "เครื่องชั่ง PR224",
          // Saved when the gallery had more pictures than it has now.
          blocks: [{ id: "g1", type: "gallery", imageUrls: URLS, selectedImageIndex: 7 } as ContentBlock],
          createdAt: "2026-09-01",
          productId: null,
        }}
        initialAllContents={[]}
        initialProducts={[]}
        initialCategories={[]}
        companyInfo={{ email: "x@y.z", phone: "0", address: "ที่อยู่" }}
        maintenanceOn={false}
        adminView={false}
      />
    );
    expect(visibleLarge()).toHaveLength(1);
    expect(visibleLarge()[0].getAttribute("alt")).toBe("เครื่องชั่ง PR224 – รูปที่ 3");
  });
});

describe("showcase gallery — a visitor saving data", () => {
  afterEach(() => {
    Object.defineProperty(navigator, "connection", { value: undefined, configurable: true });
  });

  it("loads no picture in the background: each is fetched when picked, as before", async () => {
    Object.defineProperty(navigator, "connection", { value: { saveData: true }, configurable: true });
    renderGallery();
    fireEvent.load(largeImages()[0]);
    fireEvent.pointerEnter(screen.getByAltText("เครื่องชั่ง PR224 – รูปที่ 2").closest("div")!);
    await new Promise((r) => setTimeout(r, 20));
    expect(largeImages()).toHaveLength(1);

    fireEvent.click(screen.getByAltText("เครื่องชั่ง PR224 – รูปที่ 2").closest("div")!);
    expect(largeImages()).toHaveLength(1);
    expect(visibleLarge()[0].getAttribute("alt")).toBe("เครื่องชั่ง PR224 – รูปที่ 2");
  });
});
