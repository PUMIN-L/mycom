/**
 * The window around /dashboard's sale form: it asks before typing is thrown
 * away, cannot be closed while saving, closes one thing per Esc, and takes the
 * focus in and back out.
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import SaleFormShell from "@/app/dashboard/SaleFormShell";

const esc = () => fireEvent.keyDown(document, { key: "Escape" });

function renderShell(props: Partial<React.ComponentProps<typeof SaleFormShell>> = {}) {
  const onClose = vi.fn();
  const utils = render(
    <SaleFormShell title="บันทึกยอดขาย" dirty={false} busy={false} onClose={onClose} actions={<button type="button">บันทึก</button>} {...props}>
      <input placeholder="ช่อง" />
    </SaleFormShell>
  );
  return { ...utils, onClose };
}

describe("SaleFormShell", () => {
  it("is a dialog named by its title", () => {
    renderShell();
    expect(screen.getByRole("dialog", { name: "บันทึกยอดขาย" })).toBeTruthy();
  });

  it("closes at once when nothing was typed — by ✕, ยกเลิก, the backdrop or Esc", () => {
    const { onClose } = renderShell();
    fireEvent.click(screen.getByRole("button", { name: "ปิด" }));
    fireEvent.click(screen.getByRole("button", { name: "ยกเลิก" }));
    fireEvent.click(screen.getByTestId("sale-form-backdrop"));
    esc();
    expect(onClose).toHaveBeenCalledTimes(4);
    expect(screen.queryByText("ยังไม่ได้บันทึก")).toBeNull();
  });

  it("asks first when something was typed; Esc goes back to the form, ปิดโดยไม่บันทึก closes", () => {
    const { onClose } = renderShell({ dirty: true });
    fireEvent.click(screen.getByTestId("sale-form-backdrop"));
    expect(screen.getByText("ยังไม่ได้บันทึก")).toBeTruthy();
    esc();
    expect(screen.queryByText("ยังไม่ได้บันทึก")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();

    esc();
    fireEvent.click(screen.getByRole("button", { name: "ปิดโดยไม่บันทึก" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("cannot be closed while busy", () => {
    const { onClose } = renderShell({ dirty: true, busy: true });
    expect(screen.getByRole("button", { name: "ปิด" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "ยกเลิก" })).toBeDisabled();
    fireEvent.click(screen.getByTestId("sale-form-backdrop"));
    esc();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByText("ยังไม่ได้บันทึก")).toBeNull();
  });

  it("leaves an Esc the page claims (its own question over the form) to the page", () => {
    const interceptEscape = vi.fn(() => true);
    const { onClose } = renderShell({ interceptEscape });
    esc();
    expect(interceptEscape).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on Esc when the page has nothing open over it", () => {
    const { onClose } = renderShell({ interceptEscape: () => false });
    esc();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("takes the focus in, and gives it back to what opened it", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const { unmount } = renderShell();
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("guards a refresh only while something was typed", () => {
    const { rerender } = renderShell();
    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);

    rerender(
      <SaleFormShell title="บันทึกยอดขาย" dirty busy={false} onClose={vi.fn()} actions={null}>
        <input />
      </SaleFormShell>
    );
    const dirty = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
  });
});
