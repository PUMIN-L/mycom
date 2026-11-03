/**
 * "Go back to …" links that read as buttons (app/components/NavButton.tsx),
 * where pages had a faint grey "← กลับไป …" text link.
 */
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import NavButton from "@/app/components/NavButton";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/x",
  useSearchParams: () => new URLSearchParams(),
}));

describe("NavButton", () => {
  it("is a link that reads as a button, with the label and an orange icon", () => {
    render(<NavButton href="/dashboard" label="กลับไป Dashboard" icon="dashboard" />);
    const link = screen.getByRole("link", { name: "กลับไป Dashboard" });
    expect(link).toHaveAttribute("href", "/dashboard");
    for (const c of ["border", "bg-white", "text-gray-800", "min-h-10", "rounded-xl"]) expect(link.className).toContain(c);
    expect(link.querySelector("svg")?.getAttribute("class")).toContain("text-orange-500");
  });

  it("draws a different icon for home, dashboard and a plain way back", () => {
    const paths = (["home", "dashboard", "back"] as const).map((icon) => {
      const { container, unmount } = render(<NavButton href="/" label={icon} icon={icon} />);
      const d = container.querySelector("path")!.getAttribute("d");
      unmount();
      return d;
    });
    expect(new Set(paths).size).toBe(3);
  });

  it("a plain way back by default", () => {
    const { container } = render(<NavButton href="/crm/alerts" label="กลับไปหน้าแจ้งเตือน" />);
    expect(container.querySelector("path")!.getAttribute("d")).toBe("M10 19l-7-7m0 0l7-7m-7 7h18");
  });
});

describe("no faint grey way back is left", () => {
  function tsxFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
      const p = path.join(dir, d.name);
      return d.isDirectory() ? tsxFiles(p) : p.endsWith(".tsx") ? [p] : [];
    });
  }

  it("no page styles a back link as grey text", () => {
    const faint = "inline-flex items-center gap-1.5 text-sm font-semibold text-gray-500 hover:text-gray-800";
    const offenders = tsxFiles(path.join(process.cwd(), "app"))
      .filter((f) => fs.readFileSync(f, "utf8").includes(faint))
      .map((f) => path.relative(process.cwd(), f));
    expect(offenders).toEqual([]);
  });

  it("the pages that lead back to the dashboard or the alerts use it", () => {
    for (const [file, label] of [
      ["app/crm/alerts/page.tsx", "กลับไป Dashboard"],
      ["app/expenses/page.tsx", "กลับไป Dashboard"],
      ["app/crm/tasks/page.tsx", "กลับไปหน้าแจ้งเตือน"],
    ]) {
      expect(fs.readFileSync(path.join(process.cwd(), file), "utf8")).toContain(`<NavButton`);
      expect(fs.readFileSync(path.join(process.cwd(), file), "utf8")).toContain(`label="${label}"`);
    }
  });
});
