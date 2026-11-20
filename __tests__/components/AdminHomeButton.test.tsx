/**
 * The admin pages' way around (app/components/AdminHomeButton.tsx) — one
 * clear pair of buttons on every admin page, instead of each page's own
 * (several were a faint grey "← กลับไป Admin Panel"): Dashboard, and back to
 * the admin hub. The owner asked for the Dashboard one on every back-office
 * page (2026-11-20).
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import AdminHomeButton, {
  ADMIN_HOME_LABEL,
  ADMIN_DASHBOARD_LABEL,
} from "@/app/components/AdminHomeButton";
import { config } from "@/proxy";

let pathname = "/x";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(),
}));

beforeEach(() => {
  pathname = "/x";
});

const BUTTON_CLASSES = ["border", "bg-white", "text-gray-800", "font-semibold", "min-h-10", "rounded-xl", "focus-visible:ring-2"];

describe("AdminHomeButton", () => {
  it("is a link to /adminpanel that reads as a button: bordered, dark text, 40px tall, an icon", () => {
    render(<AdminHomeButton />);
    const link = screen.getByRole("link", { name: ADMIN_HOME_LABEL });
    expect(ADMIN_HOME_LABEL).toBe("กลับหน้าระบบจัดการ");
    expect(link).toHaveAttribute("href", "/adminpanel");
    for (const c of BUTTON_CLASSES) expect(link.className).toContain(c);
    expect(link.className).not.toMatch(/text-gray-(400|500)\b/);
    expect(link.querySelector("svg")).not.toBeNull();
  });

  it("has the Dashboard beside it, the same kind of button, first", () => {
    render(<AdminHomeButton />);
    const dashboard = screen.getByRole("link", { name: ADMIN_DASHBOARD_LABEL });
    expect(ADMIN_DASHBOARD_LABEL).toBe("Dashboard");
    expect(dashboard).toHaveAttribute("href", "/dashboard");
    for (const c of BUTTON_CLASSES) expect(dashboard.className).toContain(c);
    expect(dashboard.querySelector("svg")).not.toBeNull();
    expect(screen.getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["/dashboard", "/adminpanel"]);
  });

  it("never offers the page it is on — no Dashboard on /dashboard, no way back to the hub on the hub", () => {
    pathname = "/dashboard";
    const { unmount } = render(<AdminHomeButton />);
    expect(screen.getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["/adminpanel"]);
    unmount();
    pathname = "/adminpanel";
    render(<AdminHomeButton />);
    expect(screen.getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["/dashboard"]);
  });

  it("…but a page that merely starts with the same letters still gets both", () => {
    pathname = "/dashboards-elsewhere";
    render(<AdminHomeButton />);
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });

  it("takes extra classes for its place on the page", () => {
    render(<AdminHomeButton className="mb-3" />);
    expect(screen.getByRole("link", { name: ADMIN_HOME_LABEL }).parentElement!.className).toContain("mb-3");
  });

  it("with unsaved work, a plain click on either goes through the page's guard, with where it leads", () => {
    const guard = vi.fn();
    render(<AdminHomeButton guard={guard} />);
    for (const [name, href] of [
      [ADMIN_DASHBOARD_LABEL, "/dashboard"],
      [ADMIN_HOME_LABEL, "/adminpanel"],
    ]) {
      const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
      screen.getByRole("link", { name }).dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(guard).toHaveBeenLastCalledWith(href);
    }
    expect(guard).toHaveBeenCalledTimes(2);
  });

  it("a ctrl / ⌘ / shift / middle click opens a new tab and leaves the page alone", () => {
    const guard = vi.fn();
    render(<AdminHomeButton guard={guard} />);
    for (const link of screen.getAllByRole("link")) {
      fireEvent.click(link, { ctrlKey: true });
      fireEvent.click(link, { metaKey: true });
      fireEvent.click(link, { shiftKey: true });
      fireEvent.click(link, { button: 1 });
    }
    expect(guard).not.toHaveBeenCalled();
  });
});

describe("every admin page uses it", () => {
  const root = process.cwd();
  function tsxFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
      const p = path.join(dir, d.name);
      return d.isDirectory() ? tsxFiles(p) : p.endsWith(".tsx") ? [p] : [];
    });
  }
  const files = tsxFiles(path.join(root, "app"));
  const rel = (f: string) => path.relative(root, f).replace(/\\/g, "/");

  it("no page links to /adminpanel by hand", () => {
    const offenders = files.filter((f) => /href=["{]\s*["']?\/adminpanel/.test(fs.readFileSync(f, "utf8")));
    expect(offenders.map(rel)).toEqual([]);
  });

  it("no page has a Dashboard button of its own — the shared one is beside every way back", () => {
    // A link INTO the dashboard (e.g. ?edit=<sale>) is content, not a way around.
    const offenders = files.filter((f) => /href=["{]\s*["'`]?\/dashboard["'`]/.test(fs.readFileSync(f, "utf8")));
    expect(offenders.map(rel)).toEqual([]);
  });

  it("a page with a leave guard passes it to the buttons, and has no way back of its own", () => {
    const offenders = files.filter((f) =>
      /guardedNavigate\("\/(adminpanel|dashboard)"\)/.test(fs.readFileSync(f, "utf8"))
    );
    expect(offenders.map(rel)).toEqual([]);
  });

  it("is on every page that had a way back (17 of them), and more", () => {
    const users = files.filter((f) => fs.readFileSync(f, "utf8").includes("<AdminHomeButton"));
    expect(users.length).toBeGreaterThanOrEqual(17);
  });

  /** The page's own source, and the sources it imports from this app (one level). */
  function pageAndImports(page: string): string[] {
    const src = fs.readFileSync(page, "utf8");
    const out = [src];
    for (const m of src.matchAll(/from\s+["'](\.{1,2}\/[^"']+)["']/g)) {
      const base = path.resolve(path.dirname(page), m[1]);
      for (const candidate of [`${base}.tsx`, `${base}.ts`, path.join(base, "index.tsx")]) {
        if (fs.existsSync(candidate)) {
          out.push(fs.readFileSync(candidate, "utf8"));
          break;
        }
      }
    }
    return out;
  }

  it("every back-office page shows it — on the page itself or in the frame it is drawn in", () => {
    // The admin areas are exactly the ones the login gate covers.
    const areas = (config.matcher as string[])
      .filter((m) => m.endsWith("/:path*"))
      .map((m) => m.slice(1, -"/:path*".length));
    expect(areas).toContain("accounting");
    const pages = files.filter((f) => {
      const r = rel(f);
      return r.endsWith("/page.tsx") && areas.some((a) => r.startsWith(`app/${a}/`));
    });
    const missing = pages.filter((p) => {
      // The hub is where the buttons lead back to: it leads to the dashboard
      // with a card of its own, first among its cards.
      if (rel(p) === "app/adminpanel/page.tsx") return false;
      return !pageAndImports(p).some((src) => src.includes("<AdminHomeButton"));
    });
    expect(missing.map(rel)).toEqual([]);
  });
});
