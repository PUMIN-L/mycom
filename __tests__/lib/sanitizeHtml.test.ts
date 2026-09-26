import { describe, it, expect } from "vitest";
import { sanitizeRichText, sanitizePlainText } from "../../app/lib/sanitizeHtml";

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

  it("forces rel=noopener noreferrer onto a target=_blank link (reverse-tabnabbing hardening)", () => {
    const out = sanitizeRichText('<a href="https://example.com" target="_blank">link</a>');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it("adds noopener/noreferrer alongside an existing rel value instead of replacing it", () => {
    const out = sanitizeRichText('<a href="https://example.com" target="_blank" rel="nofollow">link</a>');
    expect(out).toContain("nofollow");
    expect(out).toContain("noopener");
    expect(out).toContain("noreferrer");
  });

  it("does not add rel to a link with no target", () => {
    const out = sanitizeRichText('<a href="https://example.com">link</a>');
    expect(out).not.toContain("rel=");
  });

  it("keeps color/background-color/font-size — the only styles the editor's toolbar emits", () => {
    const out = sanitizeRichText(
      '<span style="color: rgb(230, 0, 0); background-color: #ffff00; font-size: 18px;">styled</span>'
    );
    expect(out).toContain("color:rgb(230, 0, 0)");
    expect(out).toContain("background-color:#ffff00");
    expect(out).toContain("font-size:18px");
  });

  it("strips CSS properties outside the editor's toolbar (no legitimate source, so not trusted)", () => {
    const out = sanitizeRichText(
      '<span style="position: fixed; top: 0; left: 0; z-index: 9999; background-image: url(https://evil.example/track.gif);">x</span>'
    );
    expect(out).not.toContain("position");
    expect(out).not.toContain("z-index");
    expect(out).not.toContain("background-image");
    expect(out).not.toContain("evil.example");
  });

  it("survives malformed / nested-mXSS-style input", () => {
    const out = sanitizeRichText('<svg><p><style><!--</style><script>alert(1)</script>-->');
    expect(out).not.toContain("script");
    expect(out).not.toContain("alert(1)");
  });

  it("replaces non-breaking spaces (U+00A0) with regular ones", () => {
    // Content pasted from Word or a spec-sheet page routinely carries &nbsp;
    // in place of normal spaces. A browser never treats U+00A0 as a line-break
    // opportunity — that is what the character is FOR — so a run of words
    // joined only by nbsp reads to the layout engine as one unbreakable token,
    // and overflow-wrap:break-word (used everywhere this content is shown)
    // then chops every word mid-letter to avoid overflowing its column. No
    // amount of CSS fixes that; the character has to go before it's stored.
    const out = sanitizeRichText("<p>Your Workplace uses RS232</p>");
    expect(out).not.toMatch(/ /);
    expect(out).toContain("Your Workplace uses RS232");
  });
});

// Plain-text fields are SHOWN AS TEXT everywhere (React text nodes, PDFs,
// Excel, text emails). sanitize-html's own output escapes & < >, which used to
// be stored and then shown literally: "A&B Co., Ltd." read "A&amp;B Co., Ltd."
describe("sanitizePlainText", () => {
  it("is empty for null/undefined/empty", () => {
    expect(sanitizePlainText(null)).toBe("");
    expect(sanitizePlainText(undefined)).toBe("");
    expect(sanitizePlainText("")).toBe("");
  });

  it("keeps &, < and > as the characters that were typed — not as entities", () => {
    expect(sanitizePlainText("A&B Co., Ltd.")).toBe("A&B Co., Ltd.");
    expect(sanitizePlainText("5 < 10 > 3")).toBe("5 < 10 > 3");
    expect(sanitizePlainText("x<3")).toBe("x<3");
    expect(sanitizePlainText('บริษัท "ไทย" จำกัด O\'Brien')).toBe('บริษัท "ไทย" จำกัด O\'Brien');
  });

  it("still removes tags — the text inside them stays", () => {
    expect(sanitizePlainText("<b>bold</b> text")).toBe("bold text");
    expect(sanitizePlainText("<script>alert(1)</script>ok")).toBe("ok");
    expect(sanitizePlainText('<img src=x onerror="alert(1)">x')).toBe("x");
    expect(sanitizePlainText("<br>line")).toBe("line");
  });

  it("decodes once: a typed entity comes back as that entity's text, not as markup", () => {
    // What the user typed is parsed as HTML text first: "&amp;lt;" is the text
    // "&lt;" — it must not become "<".
    expect(sanitizePlainText("&amp;lt;")).toBe("&lt;");
    expect(sanitizePlainText("&lt;script&gt;")).toBe("<script>");
    expect(sanitizePlainText("&copy; &nbsp;x")).toBe("© " + String.fromCharCode(0xa0) + "x");
  });

  it("is stable: sanitising its own output changes nothing", () => {
    for (const s of ["A&B", "5 < 10", "a & b < c > d", "ไทย & English"]) {
      const once = sanitizePlainText(s);
      expect(sanitizePlainText(once)).toBe(once);
    }
  });

  it("keeps line breaks and tabs", () => {
    expect(sanitizePlainText("a\nb\tc")).toBe("a\nb\tc");
  });

  // An HTML parser takes every "<" + letter for a tag and drops it with the
  // text after it: "PS<B-200" used to be saved as "PS". Only a REAL tag is
  // removed now (lib/htmlTags.ts).
  it("keeps < + a letter that is not a real tag — a model, a size, a grade", () => {
    for (const s of [
      "PS<B-200", "รุ่น PS<B-200> สีดำ", "Size <M>", "Size <S> or <L>", "เกรด <A> หรือ <B>",
      "a<b c", "5<a", "x<y", "<b>ไม่มีแท็กปิด", "a</b", "<!-- x -->", "<?x", "<H2O>",
    ]) {
      expect(sanitizePlainText(s), s).toBe(s);
    }
  });

  it("still removes a real tag: closed, with attributes, or one that embeds or runs something", () => {
    expect(sanitizePlainText("PS<B-200> <b>ใหม่</b>")).toBe("PS<B-200> ใหม่");
    expect(sanitizePlainText('<a href="x">ลิงก์</a>')).toBe("ลิงก์");
    expect(sanitizePlainText("บรรทัด<br>ใหม่")).toBe("บรรทัดใหม่");
    expect(sanitizePlainText("</b>")).toBe("");
    expect(sanitizePlainText("<p>A &amp; B</p>")).toBe("A & B"); // a catalog title copied in
  });

  it("removes an unclosed tag that would run something, or carries an attribute", () => {
    expect(sanitizePlainText("<img src=x onerror=alert(1)")).toBe("");
    expect(sanitizePlainText("<svg/onload=alert(1)")).toBe("");
    expect(sanitizePlainText("<b onmouseover=alert(1)")).toBe("");
  });

  it("is stable for the text it keeps", () => {
    for (const s of ["PS<B-200", "Size <M>", "a<b c", "<b>ไม่มีแท็กปิด"]) {
      const once = sanitizePlainText(s);
      expect(sanitizePlainText(once)).toBe(once);
    }
  });
});
