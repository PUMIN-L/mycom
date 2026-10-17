/**
 * The PDF editor's text dialog: size, bold, italic, colour, alignment and
 * angle are chosen IN the dialog, for this text. A new text starts from the
 * toolbar's style; an edit starts from the text's OWN style — saving an edit
 * used to take colour, bold and alignment from the toolbar, restyling text the
 * admin only meant to retype.
 */
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import TextDraftDialog from "@/app/tools/pdf-editor/TextDraftDialog";
import {
  styleForNewText,
  styleOfText,
  textFieldsOf,
  toolbarAfterPlacing,
  widenToFit,
} from "@/app/tools/pdf-editor/textDraft";
import type { TextStyle } from "@/app/tools/pdf-editor/TextStyleControls";
import type { TextAnnotation } from "@/app/lib/pdfTypes";

const TOOLBAR: TextStyle = {
  sizePt: 16,
  bold: false,
  italic: false,
  color: { r: 0, g: 0, b: 0 },
  angleDeg: 0,
  align: "left",
};

const RED_BOLD: TextAnnotation = {
  kind: "text",
  id: "t1",
  pageId: "p1",
  rect: { x: 0, y: 0, width: 100, height: 20 },
  text: "ราคา 1,000 บาท",
  sizePt: 20,
  color: { r: 1, g: 0, b: 0 },
  bold: true,
  angleDeg: 0,
  align: "center",
};

afterEach(cleanup);

describe("textDraft — where a draft's style comes from", () => {
  it("a new text starts from the toolbar", () => {
    expect(styleForNewText(TOOLBAR)).toEqual(TOOLBAR);
  });

  it("a snapped line keeps its own size and angle, and the toolbar's look", () => {
    const style = styleForNewText({ ...TOOLBAR, bold: true }, { sizePt: 13.47, angleDeg: 19.6 });
    expect(style).toEqual({ ...TOOLBAR, bold: true, sizePt: 13.5, angleDeg: 20 });
    // A snap that measured no size keeps the toolbar's.
    expect(styleForNewText(TOOLBAR, { sizePt: 0, angleDeg: 0 }).sizePt).toBe(16);
  });

  it("an edit starts from the text's OWN style — never the toolbar's", () => {
    expect(styleOfText(RED_BOLD)).toEqual({
      sizePt: 20,
      bold: true,
      italic: false, // placed before italic existed: no key, upright
      color: { r: 1, g: 0, b: 0 },
      angleDeg: 0,
      align: "center",
    });
    expect(styleOfText({ ...RED_BOLD, italic: true }).italic).toBe(true);
  });

  it("saving writes exactly the dialog's style", () => {
    expect(textFieldsOf({ ...styleOfText(RED_BOLD), italic: true, angleDeg: 15 })).toEqual({
      sizePt: 20,
      bold: true,
      italic: true,
      color: { r: 1, g: 0, b: 0 },
      angleDeg: 15,
      align: "center",
    });
  });

  it("the toolbar remembers the look just placed — not a snapped size or angle", () => {
    const placed: TextStyle = { sizePt: 13.5, bold: true, italic: true, color: { r: 0, g: 0, b: 1 }, angleDeg: 20, align: "right" };
    expect(toolbarAfterPlacing(TOOLBAR, placed)).toEqual({
      ...TOOLBAR,
      bold: true,
      italic: true,
      color: { r: 0, g: 0, b: 1 },
      align: "right",
    });
  });
});

describe("TextDraftDialog", () => {
  function setup(style: TextStyle = TOOLBAR, editing = false, value = "สวัสดี") {
    const props = {
      editing,
      value,
      style,
      onValueChange: vi.fn(),
      onStyleChange: vi.fn(),
      onCancel: vi.fn(),
      onCommit: vi.fn(),
    };
    render(<TextDraftDialog {...props} />);
    return props;
  }

  it("has every style control in the dialog itself", () => {
    setup();
    for (const label of ["ขนาดตัวอักษร", "รูปแบบ", "สีตัวอักษร", "จัดวาง", "มุม (องศา)"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "B" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "I" })).toBeInTheDocument();
  });

  it("changes the style of THIS text", () => {
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: "I" }));
    expect(props.onStyleChange).toHaveBeenCalledWith({ ...TOOLBAR, italic: true });

    fireEvent.click(screen.getByRole("button", { name: "ชิดซ้าย" }));
    fireEvent.click(screen.getByRole("button", { name: "กึ่งกลาง" }));
    expect(props.onStyleChange).toHaveBeenCalledWith({ ...TOOLBAR, align: "center" });
  });

  it("previews the look in the text box", () => {
    setup({ ...TOOLBAR, bold: true, italic: true, align: "center", color: { r: 1, g: 0, b: 0 } });
    const box = screen.getByLabelText("ข้อความ (ฟอนต์ Sarabun)") as HTMLTextAreaElement;
    expect(box.style.fontWeight).toBe("700");
    expect(box.style.fontStyle).toBe("italic");
    expect(box.style.textAlign).toBe("center");
    expect(box.style.color).toBe("rgb(255, 0, 0)");
  });

  it("keeps a huge size readable in the box, and says the real size", () => {
    setup({ ...TOOLBAR, sizePt: 72 });
    const box = screen.getByLabelText("ข้อความ (ฟอนต์ Sarabun)") as HTMLTextAreaElement;
    expect(box.style.fontSize).toBe("28px");
    expect(screen.getByText(/ขนาดจริง 72 pt/)).toBeInTheDocument();
  });

  it("shows a size read off existing text instead of a blank", () => {
    setup({ ...TOOLBAR, sizePt: 13.5 });
    expect(screen.getByRole("button", { name: /13\.5 pt/ })).toBeInTheDocument();
  });

  it("places a new text / saves an edit, and refuses an empty one", () => {
    const placing = setup();
    fireEvent.click(screen.getByRole("button", { name: "วางข้อความ" }));
    expect(placing.onCommit).toHaveBeenCalledTimes(1);
    cleanup();

    setup(TOOLBAR, true);
    expect(screen.getByText("แก้ไขข้อความ")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "บันทึกข้อความ" })).toBeInTheDocument();
    cleanup();

    setup(TOOLBAR, false, "   ");
    expect(screen.getByRole("button", { name: "วางข้อความ" })).toBeDisabled();
  });
});

describe("widenToFit — a snapped box grows to the text typed into it", () => {
  const BOX = { x: 300, y: 100, width: 12, height: 14 };

  it("grows to the right for left-aligned text, keeping its left edge", () => {
    expect(widenToFit(BOX, 30, "left")).toEqual({ x: 300, y: 100, width: 30, height: 14 });
  });

  it("grows to the left for right-aligned text, keeping its right edge", () => {
    const r = widenToFit(BOX, 30, "right");
    expect(r).toEqual({ x: 282, y: 100, width: 30, height: 14 });
    expect(r.x + r.width).toBe(BOX.x + BOX.width);
  });

  it("grows both ways for centred text, keeping its middle", () => {
    const r = widenToFit(BOX, 30, "center");
    expect(r.width).toBe(30);
    expect(r.x + r.width / 2).toBe(BOX.x + BOX.width / 2);
  });

  it("never shrinks a box the text already fits in", () => {
    expect(widenToFit(BOX, 12, "left")).toBe(BOX);
    expect(widenToFit(BOX, 5, "right")).toBe(BOX);
    expect(widenToFit(BOX, Number.NaN, "center")).toBe(BOX);
  });
});
