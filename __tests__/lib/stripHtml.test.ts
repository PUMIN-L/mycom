import { describe, it, expect } from "vitest";
import { normalizeNbsp } from "../../app/lib/stripHtml";

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
