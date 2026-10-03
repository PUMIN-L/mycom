/**
 * Site navigation changes page without reloading it. The menu, the hero's
 * contact button and the footer's quick links were plain <a>s: every click
 * reloaded the whole page — all the JavaScript, the fonts, the login check.
 * next/link swaps the page in place and fetches the next one ahead of time.
 *
 * next/link is replaced by a marker here, so "went through Link" is what is
 * asserted; how Link navigates is Next's business.
 */
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, onClick, ...rest }: { href: string; children: React.ReactNode; onClick?: () => void } & Record<string, unknown>) => (
    <a href={href} data-next-link="" onClick={onClick} {...rest}>
      {children}
    </a>
  ),
}));
let pathname = "/";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/app/i18n/LanguageContext", () => ({
  useT: () => (o: { th: string } | undefined) => o?.th ?? "",
  useLanguage: () => ({ lang: "th", setLang: vi.fn() }),
}));
vi.mock("@/app/context/AuthContext", () => ({
  useAuth: () => ({ isLoggedIn: false, user: null, logout: vi.fn() }),
}));

import Navbar from "@/app/components/Navbar";
import Hero from "@/app/components/Hero";
import Footer from "@/app/components/Footer";
import { NavProvider } from "@/app/context/NavContext";

afterEach(() => {
  cleanup();
  pathname = "/";
  document.body.style.overflow = "";
});

/** Every same-site page link inside `root` (not tel:, mailto:, or another site). */
const internalLinks = (root: HTMLElement) =>
  Array.from(root.querySelectorAll("a[href]")).filter((a) => (a.getAttribute("href") ?? "").startsWith("/"));

describe("site navigation goes through next/link", () => {
  it("the menu: logo, every desktop link, and every phone-menu link", () => {
    const { container } = render(
      <NavProvider>
        <Navbar />
      </NavProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "Toggle menu" })); // the phone menu too
    const links = internalLinks(container);
    expect(links.length).toBeGreaterThanOrEqual(13); // logo + 6 desktop + 6 phone
    for (const a of links) expect(a).toHaveAttribute("data-next-link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual(expect.arrayContaining(["/", "/#services", "/#products", "/catalog", "/about", "/contact"]));
  });

  it("the hero's contact button", () => {
    const { container } = render(<Hero />);
    const links = internalLinks(container);
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/contact"]);
    expect(links[0]).toHaveAttribute("data-next-link");
  });

  it("the footer's quick links", () => {
    const { container } = render(<Footer email="a@b.co" phone="02-123-4567" address="x" maintenanceOn={false} />);
    const links = internalLinks(container);
    expect(links.length).toBeGreaterThan(0);
    for (const a of links) expect(a).toHaveAttribute("data-next-link");
  });
});

// The menu's open state lives in the root layout and now outlives a page
// change; a change made any other way than by tapping a menu link (the back
// button) must not bring the open menu, and its page-scroll lock, along.
describe("changing page closes the phone menu", () => {
  it("closes it, and unlocks the page, when the page changes without a tap in the menu", () => {
    const tree = () => (
      <NavProvider>
        <Navbar />
      </NavProvider>
    );
    const { rerender } = render(tree());
    fireEvent.click(screen.getByRole("button", { name: "Toggle menu" }));
    expect(screen.getByRole("button", { name: "Toggle menu" })).toHaveAttribute("aria-expanded", "true");
    expect(document.body.style.overflow).toBe("hidden");

    pathname = "/about"; // e.g. the browser's back button
    rerender(tree());
    expect(screen.getByRole("button", { name: "Toggle menu" })).toHaveAttribute("aria-expanded", "false");
    expect(document.body.style.overflow).toBe("");
  });

  it("a tap on a phone-menu link closes it straight away", () => {
    render(
      <NavProvider>
        <Navbar />
      </NavProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "Toggle menu" }));
    const phoneLinks = screen.getAllByRole("link", { name: /./ }).filter((a) => a.className.includes("text-2xl"));
    fireEvent.click(phoneLinks[0]);
    expect(screen.getByRole("button", { name: "Toggle menu" })).toHaveAttribute("aria-expanded", "false");
  });
});

// With pages changing in place, Next scrolls by itself — to the top for a new
// page, back to the reader's place for the back button. The Navbar forced the
// top on EVERY mount, which undid the back button's restore.
describe("scroll on page change", () => {
  it("the first Navbar of a page load scrolls to the top; one mounted by a later page change does not", async () => {
    vi.resetModules();
    const { default: FreshNavbar } = await import("@/app/components/Navbar");
    const { NavProvider: FreshProvider } = await import("@/app/context/NavContext");
    const scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);

    const first = render(<FreshProvider><FreshNavbar /></FreshProvider>);
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    first.unmount();

    scrollTo.mockClear();
    pathname = "/catalog"; // the next page, reached through a link or the back button
    render(<FreshProvider><FreshNavbar /></FreshProvider>);
    expect(scrollTo).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
