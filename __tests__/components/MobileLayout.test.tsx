/**
 * The public pages on a phone. jsdom does no layout, so these pin the class
 * choices the fixes rest on — each test names the phone problem it guards.
 */
import { render, cleanup, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "fs";
import path from "path";

vi.mock("@/app/i18n/LanguageContext", () => ({
  useT: () => (o: { th: string } | undefined) => o?.th ?? "",
  useLanguage: () => ({ lang: "th", setLang: vi.fn() }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/app/context/AuthContext", () => ({
  useAuth: () => ({ isLoggedIn: false, user: null, logout: vi.fn() }),
}));

import Hero from "@/app/components/Hero";
import Contact from "@/app/components/Contact";
import Footer from "@/app/components/Footer";
import Navbar from "@/app/components/Navbar";
import { NavProvider } from "@/app/context/NavContext";
import Services from "@/app/components/Services";
import Clients from "@/app/components/Clients";
import AboutSection from "@/app/components/AboutSection";
import ProductCatalogView from "@/app/components/ProductCatalogView";
import ProductsSkeleton from "@/app/components/ProductsSkeleton";

afterEach(cleanup);

const classesOf = (el: Element | null) => (el?.getAttribute("class") ?? "").split(/\s+/);

describe("Hero (home page)", () => {
  // 100vh on a phone is the height WITHOUT the browser's bars: a hero that
  // tall, laid out from the bottom, put its buttons under the toolbar.
  it("is the height of the screen WITH the browser's bars (svh), and never cut off at the top", () => {
    const { container } = render(<Hero />);
    const section = container.querySelector("section#hero");
    expect(classesOf(section)).toContain("supports-[min-height:100svh]:min-h-svh");
    expect(classesOf(section)).not.toContain("max-h-screen");
  });

  // A browser without svh (Chrome < 108, Safari < 15.4, older in-app
  // browsers) drops min-h-svh entirely; the hero must still fill the screen.
  it("keeps min-h-screen as the fallback, svh applied only where supported", () => {
    const { container } = render(<Hero />);
    const classes = classesOf(container.querySelector("section#hero"));
    expect(classes).toContain("min-h-screen");
    expect(classes).not.toContain("min-h-svh"); // bare, it would also apply where unsupported — and be dropped
  });

  it("stacks its buttons at one full width on a phone, side by side from sm", () => {
    render(<Hero />);
    const row = screen.getByRole("link", { name: /./ }).parentElement!;
    expect(classesOf(row)).toEqual(expect.arrayContaining(["flex-col", "items-stretch", "sm:flex-row", "sm:items-center"]));
    expect(classesOf(screen.getByRole("link", { name: /./ }))).toContain("text-center");
  });
});

// Contact page and footer: on a phone, tapping the number should call.
describe("Contact page and footer — the phone number calls when tapped", () => {
  const props = { email: "sales@profinlab.co.th", phone: "02-123-4567, 081-234-5678", address: "บางกอก" };

  it("the contact page links each number with tel:", () => {
    render(<Contact {...props} />);
    expect(screen.getByRole("link", { name: "02-123-4567" })).toHaveAttribute("href", "tel:+6621234567");
    expect(screen.getByRole("link", { name: "081-234-5678" })).toHaveAttribute("href", "tel:+66812345678");
  });

  it("the contact page gives the address as text, with no map to come to", () => {
    // Customers never come to the premises: the equipment is delivered and
    // serviced at theirs. A map and "Open in Google Maps" said otherwise.
    const { container } = render(<Contact {...props} />);
    expect(screen.getByText(props.address)).toBeInTheDocument();
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector('a[href*="google.com/maps"]')).toBeNull();
  });

  it("the footer does too", () => {
    render(<Footer email={props.email} phone={props.phone} address={props.address} maintenanceOn={false} />);
    expect(screen.getByRole("link", { name: "02-123-4567" })).toHaveAttribute("href", "tel:+6621234567");
  });

  // p-12 (48px a side) left ~216px of input on a 360px phone.
  it("the contact form box keeps its padding small on a phone", () => {
    const { container } = render(<Contact {...props} />);
    const box = container.querySelector("form")!.parentElement!;
    expect(classesOf(box)).toEqual(expect.arrayContaining(["p-6", "sm:p-10", "md:p-16"]));
    expect(classesOf(box)).not.toContain("p-12");
  });
});

// The full menu needs ~1,000px: from md (768px) it crowded an iPad held
// upright. Phones and tablets get the menu button; desktop (lg) the links.
describe("Navbar — phone and tablet menu", () => {
  const renderNav = () =>
    render(
      <NavProvider>
        <Navbar />
        <main>page</main>
      </NavProvider>
    );
  const toggle = () => screen.getByRole("button", { name: "Toggle menu" });

  afterEach(() => {
    document.body.style.overflow = "";
    vi.unstubAllGlobals();
  });

  it("shows the menu button below lg and the full links from lg — not from md", () => {
    const { container } = renderNav();
    expect(classesOf(toggle())).toContain("lg:hidden");
    expect(classesOf(toggle())).not.toContain("md:hidden");
    const desktopLinks = Array.from(container.querySelectorAll("div")).find((d) => classesOf(d).includes("lg:flex"))!;
    expect(classesOf(desktopLinks)).toContain("hidden");
    expect(Array.from(container.querySelectorAll("div")).some((d) => classesOf(d).includes("md:flex"))).toBe(false);
  });

  it("stops the page behind the open menu from scrolling, and gives it back on close", () => {
    renderNav();
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.click(toggle());
    expect(document.body.style.overflow).toBe("");
  });

  it("closes the menu (and unlocks the page) when the screen widens to desktop", () => {
    let listener: (() => void) | null = null;
    const media = { matches: false, addEventListener: (_: string, cb: () => void) => (listener = cb), removeEventListener: vi.fn() };
    vi.stubGlobal("matchMedia", vi.fn(() => media));
    renderNav();
    fireEvent.click(toggle());
    expect(document.body.style.overflow).toBe("hidden");
    media.matches = true;
    act(() => listener!());
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(document.body.style.overflow).toBe("");
  });

  it("the open menu is as tall as the screen below the bar, and scrolls inside itself", () => {
    const { container } = renderNav();
    fireEvent.click(toggle());
    const panel = Array.from(container.querySelectorAll("div")).find((d) => classesOf(d).includes("overflow-y-auto"))!;
    expect(classesOf(panel)).toEqual(
      expect.arrayContaining([
        "lg:hidden",
        "h-[calc(100vh-5rem)]", // the fallback where dvh is not supported
        "supports-[height:100dvh]:h-[calc(100dvh-5rem)]",
      ])
    );
    expect(classesOf(panel)).not.toContain("h-screen");
  });
});

// Desktop gaps (112–128px between sections, ~100px under each heading) made
// the home and contact pages long and empty on a phone. Desktop keeps them.
describe("section spacing on a phone", () => {
  it.each([
    ["Services", () => render(<Services />), "section#services", "py-16", "md:py-30"],
    ["Clients", () => render(<Clients />), "section#clients", "py-16", "md:py-48"],
  ])("%s: smaller on a phone, the desktop value from md", (_name, renderIt, selector, phone, desktop) => {
    const { container } = renderIt();
    const classes = classesOf(container.querySelector(selector));
    expect(classes).toEqual(expect.arrayContaining([phone, desktop]));
    expect(classes.filter((c) => /^py-(2[0-9]|3[0-9])$/.test(c))).toEqual([]);
  });

  // The header's -100px pull-up only from md: on a phone the heading sits
  // under the menu bar by its own padding, not by a negative margin.
  it("Contact: no negative margin on a phone, the same desktop layout from md", () => {
    const { container } = render(<Contact email="a@b.co" phone="02-123-4567" address="x" />);
    const section = container.querySelector("section#contact")!;
    expect(classesOf(section)).toEqual(expect.arrayContaining(["pt-10", "pb-20", "md:py-48"]));
    const header = section.querySelector("div > div")!;
    expect(classesOf(header)).toEqual(expect.arrayContaining(["mb-12", "md:mb-24", "md:mt-[-100px]"]));
    expect(classesOf(header)).not.toContain("mt-[-100px]");
  });
});

describe("small things on a phone", () => {
  // 21:9 across a 360px phone is a strip ~150px tall.
  it("About: the header image is 4:3 on a phone, 21:9 only on a wide screen", () => {
    const { container } = render(<AboutSection />);
    const box = container.querySelector('img[alt="Modern Laboratory"]')!.parentElement!;
    expect(classesOf(box)).toEqual(expect.arrayContaining(["aspect-[4/3]", "sm:aspect-[16/9]", "lg:aspect-[21/9]"]));
  });

  // A long category name wraps on a phone; a full pill bent it into a blob.
  it("Products: the other-category links are rounded boxes, not pills", () => {
    render(
      <ProductCatalogView
        mode="category"
        sections={[]}
        contentIdByProduct={{}}
        otherCategories={[{ id: 2, path: "/products/2-x", name_th: "เครื่องทดสอบความแข็งแรงของวัสดุและบรรจุภัณฑ์", name_en: "", name_zh: "" }]}
      />
    );
    const link = screen.getByRole("link", { name: /เครื่องทดสอบความแข็งแรง/ });
    expect(classesOf(link)).toContain("rounded-2xl");
    expect(classesOf(link)).not.toContain("rounded-full");
  });
});

// The menu links to /#services and /#products under a fixed 80px (md: 96px)
// bar. With the phone padding now smaller than the bar, the jump landed with
// the section's heading underneath it — unless the section says to stop short.
describe("anchor jumps stop below the fixed menu bar", () => {
  it("Services carries the bar's height as its scroll margin, and no stray comment text", () => {
    const { container } = render(<Services />);
    const section = container.querySelector("section#services")!;
    expect(classesOf(section)).toEqual(expect.arrayContaining(["scroll-mt-20", "md:scroll-mt-24"]));
    expect(section.textContent).not.toContain("scroll-mt");
  });

  // Products is too heavy to mount here (catalog, drag and drop, admin
  // controls); its section's class list is read from the source instead.
  it("Products does too", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../../app/components/Products.tsx"), "utf8");
    const tag = src.match(/<section id="products" className="([^"]*)"/)!;
    expect(tag[1].split(/\s+/)).toEqual(expect.arrayContaining(["scroll-mt-20", "md:scroll-mt-24"]));
    // a JS comment written inside JSX renders as text — none next to it
    const after = src.slice(src.indexOf('<section id="products"'), src.indexOf('<section id="products"') + 400);
    expect(after).not.toMatch(/^\s*\/\/ /m);
  });
});

// The skeleton stands in for the products section while it loads; its box
// must match the real one, or the page jumps when the products arrive — and
// an anchor jump to /#products made during loading lands under the menu bar.
describe("the products skeleton matches the real section", () => {
  it("same padding at every width, and the same scroll margin", () => {
    const src = (file: string) => fs.readFileSync(path.resolve(__dirname, "../..", file), "utf8");
    const real = src("app/components/Products.tsx").match(/<section id="products" className="([^"]*)"/)![1].split(/\s+/);
    const { container } = render(<ProductsSkeleton />);
    const skeleton = classesOf(container.querySelector("section#products"));
    const layout = (classes: string[]) => classes.filter((c) => /^((sm|md|lg|xl):)?(py|pt|pb|scroll-mt)-/.test(c)).sort();
    expect(layout(skeleton)).toEqual(layout(real));
  });
});
