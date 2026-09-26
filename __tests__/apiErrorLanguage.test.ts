// @vitest-environment node
/**
 * Error messages the API sends are read by Thai admins — "Cannot delete
 * customer with linked equipment" reached the screen as it was. Every error
 * literal in app/api and app/lib must therefore contain Thai, except the few
 * below that no admin reads as a sentence:
 *
 *   - codes a client matches on ("Unauthorized" → the 401 handling,
 *     "invalid_phone" → Contact.tsx's localized message);
 *   - refusals of requests no page of ours makes (the CSRF guard);
 *   - internal failures that reach a client only as the route's (Thai)
 *     fallback message, never as their own text.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "..");

const ALLOWED_ENGLISH = new Set([
  "Unauthorized",
  "invalid_phone",
  "Cross-origin request refused",
  "Invalid Origin header",
  "SESSION_SECRET is not set",
  "Cloudinary upload returned no result",
  "Failed to allocate a category id after multiple attempts",
  "Failed to allocate a task topic id after multiple attempts",
  "pdfCoords: canvas bounding box has zero size",
  "pdfCoords: viewport has zero size",
  "pdfCoords: viewport transform is not invertible",
  "toBytes: buffer is empty or detached. pdf.js transfers any ArrayBuffer ",
  "toBytes: malformed data: URI (no comma)",
  "toBytes: string is not valid base64 or a data: URI",
]);

// The places a message is handed to a caller: `error: "…"`, jsonError("…"),
// new ApiError(4xx, "…"), badRequest("…"), new Error("…") and withRoute's
// fallback (what a 500 says in production).
const MESSAGE = /(?:error:\s*|jsonError\(\s*|ApiError\(\s*\d+\s*,\s*|badRequest\(\s*|new Error\(\s*|withRoute\(\s*)(["'`])((?:(?!\1).)*)\1/g;

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? sourceFiles(p) : /\.tsx?$/.test(e.name) ? [p] : [];
  });
}

describe("API error messages are in Thai", () => {
  it("has no English-only error message outside the allowed codes", () => {
    const english: string[] = [];
    for (const file of [...sourceFiles(path.join(ROOT, "app/api")), ...sourceFiles(path.join(ROOT, "app/lib"))]) {
      const src = fs.readFileSync(file, "utf8");
      for (const m of src.matchAll(MESSAGE)) {
        const text = m[2];
        if (/[฀-๿]/.test(text)) continue; // has Thai
        if (!/[A-Za-z]{3}/.test(text)) continue; // not a sentence (e.g. a template of values)
        if (ALLOWED_ENGLISH.has(text)) continue;
        english.push(`${path.relative(ROOT, file)}: ${text}`);
      }
    }
    expect(english).toEqual([]);
  });

  it("still finds messages at all — the scan is not silently matching nothing", () => {
    const src = fs.readFileSync(path.join(ROOT, "app/api/customers/[id]/route.ts"), "utf8");
    const found = [...src.matchAll(MESSAGE)].map((m) => m[2]);
    expect(found).toContain("ลบลูกค้ารายนี้ไม่ได้ เพราะยังมีเครื่องมือที่ผูกกับลูกค้ารายนี้อยู่");
  });
});
