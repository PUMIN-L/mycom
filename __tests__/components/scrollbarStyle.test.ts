// @vitest-environment node
/**
 * Site-wide scrollbars (globals.css) must be visible. The thumb used to be
 * white on a white track, so anything that scrolled sideways — a table, the
 * PDF page view — looked as if it could not.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const css = fs.readFileSync(path.resolve(__dirname, "../../app/globals.css"), "utf8");
const rule = (selector: RegExp) => {
  const m = new RegExp(`${selector.source}\\s*\\{([^}]*)\\}`).exec(css);
  if (!m) throw new Error(`no rule for ${selector}`);
  return m[1];
};

describe("site-wide scrollbars", () => {
  it("give the horizontal bar a thickness, not only the vertical one", () => {
    const bar = rule(/(?:^|\n)::-webkit-scrollbar/);
    expect(bar).toMatch(/width:\s*8px/);
    expect(bar).toMatch(/height:\s*8px/);
  });

  it("paint the thumb darker than its track — never white on white", () => {
    const thumb = rule(/::-webkit-scrollbar-thumb/);
    const track = rule(/::-webkit-scrollbar-track,\s*::-webkit-scrollbar-corner/);
    const colour = (block: string) => /background:\s*(#[0-9a-f]{6})/i.exec(block)?.[1]?.toLowerCase();
    expect(colour(thumb)).toBe("#d1d5db");
    expect(colour(track)).toBe("#f3f4f6");
    expect(css).not.toMatch(/::-webkit-scrollbar-thumb\s*\{[^}]*var\(--bg-card\)/);
  });

  it("give Firefox the same colours, without overriding the thin bar elsewhere", () => {
    expect(css).toMatch(/@supports not selector\(::-webkit-scrollbar\)\s*\{\s*html\s*\{\s*scrollbar-color:\s*#d1d5db #f3f4f6;/);
  });
});
