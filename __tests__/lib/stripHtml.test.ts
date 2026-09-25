import { describe, it, expect } from "vitest";
import { normalizeNbsp, htmlToText, clipText } from "../../app/lib/stripHtml";

describe("normalizeNbsp", () => {
  it("replaces every U+00A0 with a regular space", () => {
    expect(normalizeNbsp("Your Workplace")).toBe("Your Workplace");
    expect(normalizeNbsp("a b c d")).toBe("a b c d");
  });

  it("leaves regular spaces and text untouched", () => {
    expect(normalizeNbsp("Hello world")).toBe("Hello world");
  });

  it("returns empty string for null/undefined/empty input", () => {
    expect(normalizeNbsp(null as unknown as string)).toBe("");
    expect(normalizeNbsp(undefined as unknown as string)).toBe("");
    expect(normalizeNbsp("")).toBe("");
  });

  it("does not touch HTML tags, only the text-level character", () => {
    // The literal &nbsp; ENTITY (six ASCII characters) is a markup concern for
    // the HTML parser and is untouched here; this only replaces the single
    // decoded U+00A0 character, which is what ends up in the DOM/string once
    // an editor or the sanitizer's parser has processed the entity.
    const input = "<p>Your Workplace</p>";
    expect(normalizeNbsp(input)).toBe("<p>Your Workplace</p>");
  });
});

describe("htmlToText", () => {
  const NBSP = String.fromCharCode(0xa0);

  it("decodes the entities sanitize-html writes, so titles don't show '&amp;'", () => {
    expect(htmlToText("<p>Hardness &amp; Durometer</p>")).toBe("Hardness & Durometer");
    expect(htmlToText("a &lt;b&gt; &quot;c&quot; &#39;d&#39; &#x27;e&#x27;")).toBe(`a <b> "c" 'd' 'e'`);
  });

  it("decodes only once — an escaped entity stays as the author typed it", () => {
    expect(htmlToText("&amp;lt;")).toBe("&lt;");
  });

  it("leaves unknown or out-of-range entities alone", () => {
    expect(htmlToText("&bogus; &#0; &#x110000;")).toBe("&bogus; &#0; &#x110000;");
  });

  it("puts a space where a paragraph or line ends, then collapses whitespace", () => {
    expect(htmlToText("<p>A</p><p>B</p>")).toBe("A B");
    expect(htmlToText("line<br>next<br/>last")).toBe("line next last");
    expect(htmlToText(`<p>  spaced${NBSP}out&nbsp;text  </p>`)).toBe("spaced out text");
  });

  it("is empty for empty input", () => {
    expect(htmlToText("")).toBe("");
  });
});

describe("clipText", () => {
  it("returns short text untouched", () => {
    expect(clipText("short", 10)).toBe("short");
    expect(clipText("exactly10!", 10)).toBe("exactly10!");
  });

  it("cuts at a word and marks the cut, within the limit", () => {
    const out = clipText("one two three four five six", 16);
    expect(out).toBe("one two three…");
    expect([...out].length).toBeLessThanOrEqual(16);
  });

  it("cuts mid-word when no word ends near the limit (Thai has no spaces)", () => {
    const out = clipText("กขคงจฉชซฌญฎฏฐฑฒณ", 10);
    expect(out).toBe("กขคงจฉชซฌ…");
  });

  it("counts characters, not UTF-16 units", () => {
    const emoji = String.fromCodePoint(0x1f600);
    expect(clipText(emoji.repeat(5), 5)).toBe(emoji.repeat(5));
  });
});
