/**
 * A table header that sorts its column when clicked
 * (app/components/SortableTh.tsx).
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import SortableTh from "@/app/components/SortableTh";
import type { SortDir } from "@/app/customers/listHelpers";

function renderTh(dir: SortDir | null, onSort = vi.fn()) {
  render(
    <table>
      <thead>
        <tr>
          <SortableTh dir={dir} onSort={onSort} className="th-class">
            ชื่อ
          </SortableTh>
        </tr>
      </thead>
    </table>
  );
  return { th: screen.getByRole("columnheader"), button: screen.getByRole("button", { name: /ชื่อ/ }), onSort };
}

describe("SortableTh", () => {
  it("says it is not sorted, with a neutral arrow", () => {
    const { th, button } = renderTh(null);
    expect(th).toHaveAttribute("aria-sort", "none");
    expect(th.className).toBe("th-class");
    expect(button.textContent).toBe("ชื่อ↕");
  });

  it("says which way it is sorted", () => {
    const asc = renderTh("asc");
    expect(asc.th).toHaveAttribute("aria-sort", "ascending");
    expect(asc.button.textContent).toBe("ชื่อ↑");
  });

  it("descending", () => {
    const desc = renderTh("desc");
    expect(desc.th).toHaveAttribute("aria-sort", "descending");
    expect(desc.button.textContent).toBe("ชื่อ↓");
  });

  it("sorts when clicked", () => {
    const { button, onSort } = renderTh(null);
    fireEvent.click(button);
    expect(onSort).toHaveBeenCalledTimes(1);
  });
});
