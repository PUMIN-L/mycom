/**
 * The shared table pager (app/components/Pagination.tsx): which rows of how
 * many, first / previous / next / last, and a box to type a page into.
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import Pagination from "@/app/components/Pagination";

function Harness({ start = 1, totalPages = 120, onChange }: { start?: number; totalPages?: number; onChange?: (p: number) => void }) {
  const [page, setPage] = useState(start);
  return (
    <Pagination
      page={page}
      totalPages={totalPages}
      totalItems={totalPages * 50 - 7}
      perPage={50}
      onPageChange={(p) => {
        onChange?.(p);
        setPage(p);
      }}
      testId="pager"
    />
  );
}

const box = () => screen.getByRole("textbox", { name: "ไปที่หน้า" }) as HTMLInputElement;
const button = (name: string) => screen.getByRole("button", { name });

describe("Pagination", () => {
  it("renders nothing when everything fits on one page", () => {
    const { container } = render(
      <Pagination page={1} totalPages={1} totalItems={3} perPage={50} onPageChange={() => {}} testId="pager" />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("says which rows of how many, with thousands separated", () => {
    render(<Harness totalPages={120} />);
    expect(screen.getByTestId("pager").textContent).toContain("แสดง 1 ถึง 50 จาก 5,993 รายการ");
    expect(box().value).toBe("1");
    expect(screen.getByText("/ 120")).toBeInTheDocument();
  });

  it("caps the last row at the total on the last page", () => {
    render(<Harness start={120} totalPages={120} />);
    expect(screen.getByTestId("pager").textContent).toContain("แสดง 5,951 ถึง 5,993 จาก 5,993 รายการ");
  });

  it("steps and jumps to either end, disabling what leads nowhere", () => {
    render(<Harness totalPages={5} />);
    expect(button("หน้าแรก")).toBeDisabled();
    expect(button("ก่อนหน้า")).toBeDisabled();

    fireEvent.click(button("ถัดไป"));
    expect(box().value).toBe("2");
    fireEvent.click(button("หน้าสุดท้าย"));
    expect(box().value).toBe("5");
    expect(button("ถัดไป")).toBeDisabled();
    expect(button("หน้าสุดท้าย")).toBeDisabled();

    fireEvent.click(button("ก่อนหน้า"));
    expect(box().value).toBe("4");
    fireEvent.click(button("หน้าแรก"));
    expect(box().value).toBe("1");
  });

  it("goes to a typed page on Enter, and not before", () => {
    const onChange = vi.fn();
    render(<Harness totalPages={120} onChange={onChange} />);
    fireEvent.change(box(), { target: { value: "37" } });
    expect(onChange).not.toHaveBeenCalled();
    expect(box().value).toBe("37");

    fireEvent.keyDown(box(), { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(37);
    expect(box().value).toBe("37");
  });

  it("goes to a typed page when the box is left", () => {
    const onChange = vi.fn();
    render(<Harness totalPages={120} onChange={onChange} />);
    fireEvent.change(box(), { target: { value: "9" } });
    fireEvent.blur(box());
    expect(onChange).toHaveBeenCalledWith(9);
  });

  it("clamps a page out of range to the nearest real one", () => {
    const onChange = vi.fn();
    render(<Harness totalPages={12} onChange={onChange} />);
    fireEvent.change(box(), { target: { value: "999" } });
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith(12);

    fireEvent.change(box(), { target: { value: "0" } });
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith(1);
  });

  it("keeps only digits, and an emptied box goes back to the current page", () => {
    const onChange = vi.fn();
    render(<Harness start={3} totalPages={12} onChange={onChange} />);
    fireEvent.change(box(), { target: { value: "-4x" } });
    expect(box().value).toBe("4");

    fireEvent.change(box(), { target: { value: "" } });
    fireEvent.blur(box());
    expect(onChange).not.toHaveBeenCalled();
    expect(box().value).toBe("3");
  });

  it("other keys type, they do not jump", () => {
    const onChange = vi.fn();
    render(<Harness totalPages={12} onChange={onChange} />);
    fireEvent.change(box(), { target: { value: "5" } });
    fireEvent.keyDown(box(), { key: "Tab" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows a page changed from outside (a new search)", () => {
    const { rerender } = render(
      <Pagination page={4} totalPages={9} totalItems={430} perPage={50} onPageChange={() => {}} />
    );
    expect(box().value).toBe("4");
    rerender(<Pagination page={1} totalPages={2} totalItems={60} perPage={50} onPageChange={() => {}} />);
    expect(box().value).toBe("1");
    expect(screen.getByText("/ 2")).toBeInTheDocument();
  });
});
