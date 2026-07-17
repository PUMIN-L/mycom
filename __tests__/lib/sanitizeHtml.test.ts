import { describe, it, expect } from "vitest";
import { sanitizeRichText } from "../../app/lib/sanitizeHtml";

// sanitizeRichText guards every rich-text field rendered later with
// dangerouslySetInnerHTML, so these assertions are the XSS safety net for the
// linkedom-backed DOMPurify setup (previously jsdom via isomorphic-dompurify).
describe("sanitizeRichText", () => {
  it("returns empty string for null/undefined/empty", () => {
    expect(sanitizeRichText(null)).toBe("");
    expect(sanitizeRichText(undefined)).toBe("");
    expect(sanitizeRichText("")).toBe("");
  });

  it("keeps the formatting the editor produces", () => {
    const html =
      '<h1>Title</h1><p><strong>bold</strong> <em>italic</em> <u>under</u></p>' +
      '<ul><li>a</li><li>b</li></ul>' +
      '<p><span style="color: red;">red</span></p>' +
      '<a href="https://example.com" target="_blank" rel="noopener">link</a>';
    const out = sanitizeRichText(html);
    expect(out).toContain("<h1>Title</h1>");
    expect(out).toContain("<strong>bold</strong>");
    expect(out).toContain("<em>italic</em>");
    expect(out).toContain("<li>a</li>");
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain("style=");
  });

  it("strips script tags and their content", () => {
    const out = sanitizeRichText('<p>hi</p><script>alert(1)</script>');
    expect(out).toContain("<p>hi</p>");
    expect(out).not.toContain("script");
    expect(out).not.toContain("alert");
  });

  it("strips event handlers", () => {
    const out = sanitizeRichText('<p onclick="alert(1)" onmouseover="x()">hi</p>');
    expect(out).toContain("hi");
    expect(out).not.toContain("onclick");
    expect(out).not.toContain("onmouseover");
  });

  it("strips javascript: URLs", () => {
    const out = sanitizeRichText('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toContain("javascript:");
  });

  it("strips iframes/objects/img (not in the allowlist)", () => {
    const out = sanitizeRichText(
      '<iframe src="https://evil.example"></iframe><object data="x"></object><img src=x onerror=alert(1)>'
    );
    expect(out).not.toContain("iframe");
    expect(out).not.toContain("object");
    expect(out).not.toContain("img");
    expect(out).not.toContain("onerror");
  });

  it("strips data attributes", () => {
    const out = sanitizeRichText('<p data-evil="1">hi</p>');
    expect(out).toContain("hi");
    expect(out).not.toContain("data-evil");
  });

  it("survives malformed / nested-mXSS-style input", () => {
    const out = sanitizeRichText('<svg><p><style><!--</style><script>alert(1)</script>-->');
    expect(out).not.toContain("script");
    expect(out).not.toContain("alert(1)");
  });
});
