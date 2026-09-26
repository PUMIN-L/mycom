import { describe, it, expect } from "vitest";
import { normalizeNbsp, htmlToText, clipText, displayText, stripHtml } from "../../app/lib/stripHtml";

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

describe("displayText", () => {
  it("reads a rich catalog title as text, entities decoded", () => {
    expect(displayText("<p>A &amp; B</p>")).toBe("A & B");
    expect(displayText("<p>Line 1</p><p>Line 2</p>")).toBe("Line 1 Line 2");
  });

  it("shows a plain name as typed — a lone < is not the start of a tag", () => {
    expect(displayText("5 < 10 > 3")).toBe("5 < 10 > 3");
    expect(displayText("A&B Co., Ltd.")).toBe("A&B Co., Ltd.");
    expect(displayText("  Scale X  ")).toBe("Scale X");
  });

  it("is empty for nothing", () => {
    expect(displayText(null)).toBe("");
    expect(displayText(undefined)).toBe("");
    expect(displayText("")).toBe("");
  });

  // The save keeps "<" + a letter that is not a real tag (lib/htmlTags.ts);
  // the screen must not then hide it by reading it as HTML.
  it("shows a model or size with < + a letter exactly as saved", () => {
    expect(displayText("PS<B-200")).toBe("PS<B-200");
    expect(displayText("รุ่น PS<B-200>")).toBe("รุ่น PS<B-200>");
    expect(displayText("Size <M>")).toBe("Size <M>");
    expect(displayText("เกรด <A> หรือ <B>")).toBe("เกรด <A> หรือ <B>");
  });

  it("still reads a catalog title with a single tag as HTML", () => {
    expect(displayText("Scale<br>X-200")).toBe("Scale X-200");
    expect(displayText('<span style="color:red">A &amp; B</span>')).toBe("A & B");
  });
});

describe("stripHtml", () => {
  // It used to remove the tags only, so a catalog title with "&" showed
  // "&amp;" in the pickers, the cards' English line and on quotations.
  it("removes the tags and decodes the entities, once", () => {
    expect(stripHtml("<p>Hardness &amp; Durometer</p>")).toBe("Hardness & Durometer");
    expect(stripHtml("<p>&amp;lt;b&amp;gt;</p>")).toBe("&lt;b&gt;");
    expect(stripHtml("<p>5 &lt; 10</p><p>x</p>")).toBe("5 < 10x");
  });

  it("is empty for nothing", () => {
    expect(stripHtml("")).toBe("");
  });
});
