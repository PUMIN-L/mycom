/**
 * The way back to the admin hub (app/components/AdminHomeButton.tsx) — one
 * clear button on every admin page, instead of each page's own (several were
 * a faint grey "← กลับไป Admin Panel").
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import AdminHomeButton, { ADMIN_HOME_LABEL } from "@/app/components/AdminHomeButton";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/x",
  useSearchParams: () => new URLSearchParams(),
}));

describe("AdminHomeButton", () => {
  it("is a link to /adminpanel that reads as a button: bordered, dark text, 40px tall, an icon", () => {
    render(<AdminHomeButton />);
    const link = screen.getByRole("link", { name: ADMIN_HOME_LABEL });
    expect(ADMIN_HOME_LABEL).toBe("กลับหน้าระบบจัดการ");
    expect(link).toHaveAttribute("href", "/adminpanel");
    for (const c of ["border", "bg-white", "text-gray-800", "font-semibold", "min-h-10", "rounded-xl", "focus-visible:ring-2"]) {
      expect(link.className).toContain(c);
    }
    expect(link.className).not.toMatch(/text-gray-(400|500)\b/);
    expect(link.querySelector("svg")).not.toBeNull();
  });

  it("takes extra classes for its place on the page", () => {
    render(<AdminHomeButton className="mb-3" />);
    expect(screen.getByRole("link").className).toContain("mb-3");
  });

  it("with unsaved work, a plain click goes through the page's guard instead", () => {
    const onNavigate = vi.fn();
    render(<AdminHomeButton onNavigate={onNavigate} />);
    const link = screen.getByRole("link", { name: ADMIN_HOME_LABEL });
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    link.dispatchEvent(event);
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("a ctrl / ⌘ / shift / middle click opens a new tab and leaves the page alone", () => {
    const onNavigate = vi.fn();
    render(<AdminHomeButton onNavigate={onNavigate} />);
    const link = screen.getByRole("link", { name: ADMIN_HOME_LABEL });
    fireEvent.click(link, { ctrlKey: true });
    fireEvent.click(link, { metaKey: true });
    fireEvent.click(link, { shiftKey: true });
    fireEvent.click(link, { button: 1 });
    expect(onNavigate).not.toHaveBeenCalled();
  });
});

describe("every admin page uses it", () => {
  function tsxFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
      const p = path.join(dir, d.name);
      return d.isDirectory() ? tsxFiles(p) : p.endsWith(".tsx") ? [p] : [];
    });
  }
  const files = tsxFiles(path.join(process.cwd(), "app"));

  it("no page links to /adminpanel by hand", () => {
    const offenders = files.filter((f) => /href=["{]\s*["']?\/adminpanel/.test(fs.readFileSync(f, "utf8")));
    expect(offenders.map((f) => path.relative(process.cwd(), f))).toEqual([]);
  });

  it("a page with a leave guard goes back through the button, not a button of its own", () => {
    const offenders = files.filter((f) =>
      fs
        .readFileSync(f, "utf8")
        .split("\n")
        .some((line) => line.includes('guardedNavigate("/adminpanel")') && !line.includes("<AdminHomeButton onNavigate="))
    );
    expect(offenders.map((f) => path.relative(process.cwd(), f))).toEqual([]);
  });

  it("is on every page that had a way back (18 of them)", () => {
    const users = files.filter((f) => fs.readFileSync(f, "utf8").includes("<AdminHomeButton"));
    expect(users.length).toBeGreaterThanOrEqual(18);
  });
});
