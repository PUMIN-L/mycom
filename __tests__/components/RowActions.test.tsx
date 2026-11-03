/**
 * The icon buttons at the end of a clickable row, and the row's own keyboard
 * opener (app/components/RowActions.tsx).
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import RowActions, { openOnKey } from "@/app/components/RowActions";

function renderRow(withCopy: boolean) {
  const handlers = { onEdit: vi.fn(), onDelete: vi.fn(), onCopy: vi.fn(), onRow: vi.fn(), onRowKey: vi.fn() };
  render(
    <table>
      <tbody>
        <tr tabIndex={0} aria-label="row" onClick={handlers.onRow} onKeyDown={(e) => { handlers.onRowKey(e.key); openOnKey(handlers.onRow)(e); }}>
          <td>
            <RowActions name="สเปค 5kN" onEdit={handlers.onEdit} onDelete={handlers.onDelete} onCopy={withCopy ? handlers.onCopy : undefined} />
          </td>
        </tr>
      </tbody>
    </table>
  );
  return handlers;
}

describe("RowActions", () => {
  it("edits, deletes and copies without opening the row", () => {
    const h = renderRow(true);
    fireEvent.click(screen.getByRole("button", { name: "แก้ไข สเปค 5kN" }));
    fireEvent.click(screen.getByRole("button", { name: "ลบ สเปค 5kN" }));
    fireEvent.click(screen.getByRole("button", { name: "ทำสำเนา สเปค 5kN" }));
    expect(h.onEdit).toHaveBeenCalledTimes(1);
    expect(h.onDelete).toHaveBeenCalledTimes(1);
    expect(h.onCopy).toHaveBeenCalledTimes(1);
    expect(h.onRow).not.toHaveBeenCalled();
  });

  it("has no copy button unless asked", () => {
    renderRow(false);
    expect(screen.queryByRole("button", { name: /ทำสำเนา/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  it("shows delete only on hover or focus", () => {
    renderRow(false);
    const del = screen.getByRole("button", { name: "ลบ สเปค 5kN" });
    for (const c of ["opacity-0", "group-hover:opacity-100", "group-focus-within:opacity-100", "focus-visible:opacity-100"]) {
      expect(del.className).toContain(c);
    }
    expect(screen.getByRole("button", { name: "แก้ไข สเปค 5kN" }).className).not.toContain("opacity-0");
  });

  it("keeps Enter / Space from the row, lets Esc through", () => {
    const h = renderRow(true);
    for (const name of ["แก้ไข สเปค 5kN", "ลบ สเปค 5kN", "ทำสำเนา สเปค 5kN"]) {
      const b = screen.getByRole("button", { name });
      fireEvent.keyDown(b, { key: "Enter" });
      fireEvent.keyDown(b, { key: " " });
      fireEvent.keyDown(b, { key: "Escape" });
    }
    expect(h.onRowKey.mock.calls.map((c) => c[0])).toEqual(["Escape", "Escape", "Escape"]);
    expect(h.onRow).not.toHaveBeenCalled();
  });
});

describe("openOnKey", () => {
  it("opens on Enter or Space on the row itself, and nothing else", () => {
    const h = renderRow(false);
    const row = screen.getByRole("row", { name: "row" });
    fireEvent.keyDown(row, { key: "a" });
    fireEvent.keyDown(row, { key: "Tab" });
    expect(h.onRow).not.toHaveBeenCalled();
    fireEvent.keyDown(row, { key: "Enter" });
    fireEvent.keyDown(row, { key: " " });
    expect(h.onRow).toHaveBeenCalledTimes(2);
  });

  it("ignores a key that started inside the row", () => {
    const h = renderRow(false);
    fireEvent.keyDown(screen.getByRole("cell"), { key: "Enter" });
    expect(h.onRow).not.toHaveBeenCalled();
  });

  it("stops Space from scrolling the page", () => {
    renderRow(false);
    const row = screen.getByRole("row", { name: "row" });
    const event = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
    row.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});
