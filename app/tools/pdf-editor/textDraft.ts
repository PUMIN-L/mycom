// What the text dialog starts from, and what it writes back. Pure — the page
// wires it up, the tests pin it.

import type { PageId, Rect, TextAnnotation } from "../../lib/pdfTypes";
import type { TextStyle } from "./TextStyleControls";

/** The text dialog's state: where the text goes, what it says, how it looks. */
export interface TextDraft {
  pageId: PageId;
  rect: Rect;
  value: string;
  style: TextStyle;
  /** The text being edited; null for a new one. */
  editingId: string | null;
}

/** What a snap read off a line of existing text (PageOverlay). */
export interface SnapStyle {
  sizePt: number;
  angleDeg: number;
}

/**
 * The style a NEW text starts with: the toolbar's, except the size and angle
 * a snapped line was measured at, so the new text matches the text it
 * replaces.
 */
export function styleForNewText(toolbar: TextStyle, snap?: SnapStyle | null): TextStyle {
  if (!snap) return { ...toolbar };
  return {
    ...toolbar,
    sizePt: snap.sizePt > 0 ? Math.round(snap.sizePt * 10) / 10 : toolbar.sizePt,
    angleDeg: Math.round(snap.angleDeg),
  };
}

/**
 * The style an EDIT starts with: the text's OWN, never the toolbar's. Saving
 * an edit used to take colour, bold and alignment from the toolbar — so
 * correcting a typo in a red bold line turned it black and regular whenever
 * the toolbar was set that way.
 */
export function styleOfText(ann: TextAnnotation): TextStyle {
  return {
    sizePt: ann.sizePt,
    bold: ann.bold,
    italic: ann.italic === true,
    color: { ...ann.color },
    angleDeg: ann.angleDeg,
    align: ann.align,
  };
}

/** The annotation fields a draft's style writes. */
export function textFieldsOf(
  style: TextStyle
): Pick<TextAnnotation, "sizePt" | "bold" | "italic" | "color" | "angleDeg" | "align"> {
  return {
    sizePt: style.sizePt,
    bold: style.bold,
    italic: style.italic,
    color: { ...style.color },
    angleDeg: style.angleDeg,
    align: style.align,
  };
}

/**
 * The toolbar after a NEW text is placed: it remembers the look just chosen in
 * the dialog — colour, bold, italic, alignment — so the next text starts the
 * same way. Not the size or angle: those may have come from a snapped line.
 */
export function toolbarAfterPlacing(toolbar: TextStyle, placed: TextStyle): TextStyle {
  return {
    ...toolbar,
    bold: placed.bold,
    italic: placed.italic,
    color: { ...placed.color },
    align: placed.align,
  };
}
