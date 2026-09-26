/**
 * Every rich-text field (product titles and descriptions, category names,
 * content titles and blocks) is edited with RichTextEditor, so its toolbar is
 * what the admin can do to text everywhere: size, bold / italic / underline /
 * strike, text and background colour, alignment, lists, clear.
 */
import { render, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";

let quillProps: Record<string, unknown> | null = null;
vi.mock("next/dynamic", () => ({
  default: () => (props: Record<string, unknown>) => {
    quillProps = props;
    return null;
  },
}));

import RichTextEditor from "@/app/components/RichTextEditor";

afterEach(() => {
  cleanup();
  quillProps = null;
});

describe("RichTextEditor toolbar", () => {
  it("offers size, bold, italic, underline, strike, colours, alignment, lists and clear", () => {
    const { container } = render(<RichTextEditor value="" onChange={() => {}} />);
    const toolbar = (quillProps!.modules as { toolbar: unknown[] }).toolbar.flat();
    const has = (item: unknown) => toolbar.some((t) => JSON.stringify(t) === JSON.stringify(item));

    for (const item of [
      { size: [] }, "bold", "italic", "underline", "strike",
      { color: [] }, { background: [] }, { align: [] },
      { list: "ordered" }, { list: "bullet" }, "clean",
    ]) {
      expect(has(item), JSON.stringify(item)).toBe(true);
    }
    // The wrapper that globals.css uses to give the editor the pages' font and
    // line height, so what is typed looks like what is shown.
    expect(container.querySelector(".rich-text-editor")).not.toBeNull();
  });
});
