// @vitest-environment node
/**
 * The PDF editor shows typed text in the same Sarabun files the download
 * embeds. Without @font-face rules "Sarabun" named no font in the browser: the
 * preview fell back to a narrower system face, so a "11" that fit its box on
 * screen wrapped into a "1" over a "1" in the PDF. These pin the two to the
 * same files, weight for weight, and the editor page to loading them.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { THAI_FONT_URLS } from "@/app/lib/pdfFonts";

const root = path.resolve(__dirname, "../..");
const css = fs.readFileSync(path.join(root, "app/tools/pdf-editor/sarabun-font.css"), "utf8");

/** Each @font-face as { family, weight, url }. */
function faces() {
  return Array.from(css.matchAll(/@font-face\s*\{([^}]*)\}/g)).map(([, body]) => ({
    family: /font-family:\s*"([^"]+)"/.exec(body)?.[1],
    weight: /font-weight:\s*(\d+)/.exec(body)?.[1],
    url: /url\("([^"]+)"\)/.exec(body)?.[1],
  }));
}

describe("PDF editor — on-screen Sarabun is the embedded Sarabun", () => {
  it("serves regular (400) and bold (700) from the files the export embeds", () => {
    expect(faces()).toEqual([
      { family: "Sarabun", weight: "400", url: THAI_FONT_URLS.regular },
      { family: "Sarabun", weight: "700", url: THAI_FONT_URLS.bold },
    ]);
  });

  it("points at files that exist in public/", () => {
    for (const { url } of faces()) {
      expect(fs.existsSync(path.join(root, "public", url!))).toBe(true);
    }
  });

  it("is loaded by the editor page", () => {
    const page = fs.readFileSync(path.join(root, "app/tools/pdf-editor/page.tsx"), "utf8");
    expect(page).toContain('import "./sarabun-font.css";');
  });
});
