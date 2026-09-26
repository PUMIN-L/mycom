// @vitest-environment node
/**
 * Showing the RichTextEditor's HTML the way the editor showed it. The editor
 * (Quill 2) keeps every space (getSemanticHTML even writes each one as
 * &nbsp;), makes each Enter a new paragraph with no gap, an empty line an
 * empty paragraph, and writes sizes and alignment as ql-* classes.
 */
import { describe, it, expect } from "vitest";
import { escapeHtmlText, htmlToTextLines, richTextAlign, richTextHtml, richTextInline } from "@/app/lib/richTextDisplay";

const NBSP = String.fromCharCode(0xa0);

describe("richTextHtml", () => {
  it("turns non-breaking spaces into ordinary ones and keeps every one of them", () => {
    expect(richTextHtml(`<p>A${NBSP}${NBSP}${NBSP}B</p>`)).toBe("<p>A   B</p>");
    expect(richTextHtml("<p>A&nbsp;&nbsp;B</p>")).toBe("<p>A  B</p>");
  });

  it("keeps the markup: paragraphs, empty lines, sizes, colours, alignment", () => {
    const html =
      '<p class="ql-align-center"><strong>หัวข้อ</strong></p><p><br></p>' +
      '<p><span class="ql-size-large" style="color: rgb(230, 0, 0);">ใหญ่ แดง</span></p>';
    expect(richTextHtml(html)).toBe(html);
  });

  it("drops whitespace between block tags, which pre-wrap would show as extra lines", () => {
    expect(richTextHtml("<p>a</p>\n  <p>b</p>\n<ul>\n<li>c</li>\n</ul>")).toBe("<p>a</p><p>b</p><ul><li>c</li></ul>");
  });

  it("reads a raw line break inside text as one space, as HTML and the editor do", () => {
    expect(richTextHtml("<p>line\n  one</p>")).toBe("<p>line one</p>");
  });

  it("is empty for nothing", () => {
    expect(richTextHtml(null)).toBe("");
    expect(richTextHtml("")).toBe("");
  });
});

describe("richTextInline", () => {
  it("makes every paragraph a line, and an empty paragraph one empty line", () => {
    expect(richTextInline("<p>A</p><p>B</p>")).toBe("A<br>B");
    expect(richTextInline("<p>A</p><p><br></p><p>B</p>")).toBe("A<br><br>B");
  });

  it("drops blank lines at the very start and end", () => {
    expect(richTextInline("<p><br></p><p>A</p><p><br></p><p><br></p>")).toBe("A");
  });

  it("keeps inline formatting and spaces", () => {
    expect(richTextInline(`<p><strong>ตัว${NBSP}${NBSP}หนา</strong> <span class="ql-size-huge">ใหญ่</span></p>`)).toBe(
      '<strong>ตัว  หนา</strong> <span class="ql-size-huge">ใหญ่</span>'
    );
  });

  it("writes list items as marked lines — bullets, numbers, nested indent", () => {
    expect(richTextInline("<ul><li>a</li><li>b</li></ul>")).toBe("• a<br>• b");
    expect(richTextInline("<p>ขั้นตอน</p><ol><li>หนึ่ง</li><li>สอง<ol><li>ย่อย</li></ol></li></ol>")).toBe(
      "ขั้นตอน<br>1. หนึ่ง<br>2. สอง<br>  1. ย่อย"
    );
  });

  it("keeps text that is already inline as it is", () => {
    expect(richTextInline("ชื่อรุ่น X-200")).toBe("ชื่อรุ่น X-200");
  });
});

describe("richTextAlign", () => {
  it("is the alignment every line shares, empty lines aside", () => {
    expect(richTextAlign('<p class="ql-align-center">a</p><p><br></p><p class="ql-align-center">b</p>')).toBe("center");
    expect(richTextAlign('<p class="ql-align-right">a</p>')).toBe("right");
  });

  it("is undefined for left-aligned or mixed lines", () => {
    expect(richTextAlign("<p>a</p>")).toBeUndefined();
    expect(richTextAlign('<p class="ql-align-center">a</p><p>b</p>')).toBeUndefined();
    expect(richTextAlign("plain")).toBeUndefined();
  });
});

describe("htmlToTextLines", () => {
  it("keeps the lines and the spaces as text, entities decoded", () => {
    expect(htmlToTextLines(`<p>ตู้อบ &amp; เตา</p><p><br></p><p>A${NBSP}${NBSP}B</p>`)).toBe("ตู้อบ & เตา\n\nA  B");
  });

  it("writes lists as marked lines", () => {
    expect(htmlToTextLines("<ul><li>a</li><li>b &lt; c</li></ul>")).toBe("• a\n• b < c");
  });

  it("is empty for nothing", () => {
    expect(htmlToTextLines(undefined)).toBe("");
    expect(htmlToTextLines("<p><br></p>")).toBe("");
  });
});

describe("richTextDisplay — edges", () => {
  it("keeps a <pre>'s line breaks, and drops whitespace between it and other blocks", () => {
    expect(richTextHtml("<p>a</p>\n<pre>line 1\n  line 2</pre>\n<p>b</p>")).toBe(
      "<p>a</p><pre>line 1\n  line 2</pre><p>b</p>"
    );
  });

  it("drops blank lines of spaces at the start and end of a compact display", () => {
    expect(richTextInline("<p>   </p><p>A</p><p>  </p><p>B</p><p>   </p>")).toBe("A<br>  <br>B");
  });

  it("keeps spaces that start the first real line", () => {
    expect(richTextInline("<p>   ย่อหน้า</p>")).toBe("   ย่อหน้า");
  });
});

describe("escapeHtmlText", () => {
  it("makes text safe to place in an HTML slot", () => {
    expect(escapeHtmlText('<img src=x onerror="alert(1)"> & more')).toBe(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; more"
    );
    expect(escapeHtmlText(null)).toBe("");
  });
});

describe("richTextHtml — lines that look empty", () => {
  it("keeps a line of spaces, which the editor shows as a line", () => {
    expect(richTextHtml("<p>A</p><p>&nbsp;&nbsp;</p><p>B</p>")).toBe("<p>A</p><p>  </p><p>B</p>");
  });

  it("gives a paragraph with nothing in it the empty line the editor shows", () => {
    expect(richTextHtml('<p>A</p><p></p><p class="ql-align-center"></p>')).toBe(
      '<p>A</p><p><br></p><p class="ql-align-center"><br></p>'
    );
  });
});
