import { describe, it, expect, afterEach } from "vitest";
import { isTopmostModal, DROPDOWN_PANEL_ATTR } from "@/app/lib/dialogLayer";

function modal(parent: HTMLElement = document.body) {
  const el = document.createElement("div");
  el.setAttribute("aria-modal", "true");
  parent.appendChild(el);
  return el;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("isTopmostModal", () => {
  it("the only window is on top", () => {
    expect(isTopmostModal(modal())).toBe(true);
  });

  it("a window opened after another is on top of it", () => {
    const first = modal();
    const second = modal();
    expect(isTopmostModal(first)).toBe(false);
    expect(isTopmostModal(second)).toBe(true);
  });

  it("a window opened INSIDE another is on top of it", () => {
    const outer = modal();
    const inner = modal(outer);
    expect(isTopmostModal(outer)).toBe(false);
    expect(isTopmostModal(inner)).toBe(true);
  });

  it("an open dropdown list is over every window", () => {
    const only = modal();
    const panel = document.createElement("div");
    panel.setAttribute(DROPDOWN_PANEL_ATTR, "");
    document.body.appendChild(panel);
    expect(isTopmostModal(only)).toBe(false);
    panel.remove();
    expect(isTopmostModal(only)).toBe(true);
  });

  it("nothing, or a window no longer on the page, is not on top", () => {
    expect(isTopmostModal(null)).toBe(false);
    const gone = modal();
    gone.remove();
    expect(isTopmostModal(gone)).toBe(false);
  });

  it("a plain element (not a window) is never on top", () => {
    modal();
    const plain = document.createElement("div");
    document.body.appendChild(plain);
    expect(isTopmostModal(plain)).toBe(false);
  });
});
