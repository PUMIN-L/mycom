// @vitest-environment node
/**
 * Which "<" in plain text starts a real HTML tag — the one rule the save
 * (sanitizePlainText) and the screen (displayText, the note-replace warning)
 * both follow. Anything else is a character the admin typed and must survive.
 */
import { describe, it, expect } from "vitest";
import { containsHtmlTag, escapeNonTagAngleBrackets, isHtmlTagAt } from "@/app/lib/htmlTags";

describe("containsHtmlTag", () => {
  it("is false for text whose < is a character: a model, a size, a comparison", () => {
    for (const s of [
      "PS<B-200", "PS<B-200>", "Size <M>", "<S>", "เกรด <A> หรือ <B>", "a<b c", "5<a", "5 < 10 > 3",
      "<b>ไม่มีแท็กปิด", "<p>", "a</b", "<!-- x -->", "<?xml?>", "<H2O>", "<custom-el>", "", null, undefined,
    ]) {
      expect(containsHtmlTag(s), String(s)).toBe(false);
    }
  });

  it("is true for markup: a closed element, a closing tag, attributes, void or embedding elements", () => {
    for (const s of [
      "<b>x</b>", "<B>X</B>", "<p>A &amp; B</p>", "x</b>", '<a href="x">y</a>', "<span style='c'>y",
      "a<br>b", "<br/>", "<hr >", "<img src=x>", "<script>alert(1)</script>", "<iframe src=x></iframe>",
      "<img src=x onerror=alert(1)", "<svg/onload=alert(1)", "<b onmouseover=x",
    ]) {
      expect(containsHtmlTag(s), s).toBe(true);
    }
  });

  it("finds the closing tag case-insensitively and across lines", () => {
    expect(containsHtmlTag("<P>line\nnext</p>")).toBe(true);
  });
});

describe("isHtmlTagAt", () => {
  it("judges each < on its own", () => {
    const s = "PS<B-200 and <b>x</b>";
    expect(isHtmlTagAt(s, s.indexOf("<"))).toBe(false);
    expect(isHtmlTagAt(s, s.indexOf("<b>"))).toBe(true);
    expect(isHtmlTagAt(s, s.indexOf("</b>"))).toBe(true);
  });
});

describe("escapeNonTagAngleBrackets", () => {
  it("writes every non-tag < as &lt; and leaves real tags alone", () => {
    expect(escapeNonTagAngleBrackets("PS<B-200 <b>x</b> 5<a")).toBe("PS&lt;B-200 <b>x</b> 5&lt;a");
  });

  it("changes nothing without a <", () => {
    expect(escapeNonTagAngleBrackets("A & B > C")).toBe("A & B > C");
  });

  // Linear time: deciding each "<" by scanning forward was quadratic — 240 KB
  // of "<b x" took 7.6 s, and a 4 MB request body would have held the
  // function until it timed out. 1 MB of the worst shapes must stay quick.
  it.each([
    ["no > anywhere", "<b x".repeat(250_000)],
    ["opening tags never closed", "<b>".repeat(330_000)],
    ["many < sharing one late >", "<b <i <u ".repeat(110_000) + ">"],
  ])("stays linear on 1 MB of %s", (_label, s) => {
    const t0 = Date.now();
    escapeNonTagAngleBrackets(s);
    containsHtmlTag(s);
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});
