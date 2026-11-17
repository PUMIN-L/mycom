/**
 * useModalEscape: one Esc closes ONE window — the one on top — and an open
 * dropdown list takes its Esc first.
 */
import { render, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useRef } from "react";
import { useModalEscape } from "@/app/components/useModalEscape";
import { DROPDOWN_PANEL_ATTR } from "@/app/lib/dialogLayer";

function Window({ onEscape, enabled = true, children }: { onEscape: () => void; enabled?: boolean; children?: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useModalEscape(ref, onEscape, enabled);
  return (
    <div ref={ref} aria-modal="true">
      {children}
    </div>
  );
}

describe("useModalEscape", () => {
  it("Esc reaches the window on top only", () => {
    const below = vi.fn();
    const above = vi.fn();
    render(
      <>
        <Window onEscape={below} />
        <Window onEscape={above} />
      </>
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(above).toHaveBeenCalledTimes(1);
    expect(below).not.toHaveBeenCalled();
  });

  it("a window opened inside another is the one on top", () => {
    const outer = vi.fn();
    const inner = vi.fn();
    render(
      <Window onEscape={outer}>
        <Window onEscape={inner} />
      </Window>
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });

  it("other keys, a dropdown list open over it, an Esc already handled, or switched off: nothing", () => {
    const onEscape = vi.fn();
    const { rerender } = render(<Window onEscape={onEscape} />);
    fireEvent.keyDown(document, { key: "Enter" });

    const panel = document.createElement("div");
    panel.setAttribute(DROPDOWN_PANEL_ATTR, "");
    document.body.appendChild(panel);
    fireEvent.keyDown(document, { key: "Escape" });
    panel.remove();

    const handled = new KeyboardEvent("keydown", { key: "Escape", cancelable: true, bubbles: true });
    handled.preventDefault();
    document.dispatchEvent(handled);

    rerender(<Window onEscape={onEscape} enabled={false} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onEscape).not.toHaveBeenCalled();

    rerender(<Window onEscape={onEscape} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it("runs the latest handler, and marks the Esc as handled", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Window onEscape={first} />);
    rerender(<Window onEscape={second} />);
    const event = new KeyboardEvent("keydown", { key: "Escape", cancelable: true, bubbles: true });
    document.dispatchEvent(event);
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });
});
