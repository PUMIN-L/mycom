/**
 * FormattedNumberInput — the money field used by quotations, sales, payments,
 * expenses and the dashboard. What it SHOWS and the number it REPORTS must
 * always agree: before, "1.2.3" was shown while 1.23 was reported, and leaving
 * the field then read the text as 1.2; a stored 1.23456 was shown as "1.235"
 * and leaving the field saved that.
 */
import { useState } from "react";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import FormattedNumberInput from "@/app/components/FormattedNumberInput";

afterEach(cleanup);

/** The way the forms use it: the parent keeps the number and passes it back. */
function Harness({ initial, onValue }: { initial: number | string; onValue: (n: number) => void }) {
  const [value, setValue] = useState<number | string>(initial);
  return (
    <FormattedNumberInput
      value={value}
      onChange={(n) => {
        setValue(n);
        onValue(n);
      }}
    />
  );
}

function setup(initial: number | string = 0) {
  const onValue = vi.fn();
  const { container } = render(<Harness initial={initial} onValue={onValue} />);
  const input = container.querySelector("input")!;
  return { input, onValue };
}

describe("FormattedNumberInput", () => {
  // A stray point that leaves the number unchanged (1.23 → "1.2.3" is still
  // 1.23) gives the parent nothing new to hand back, so only the field's own
  // handling can keep the text right. It used to show "1.2.3", and leaving
  // the field then read that as 1.2.
  it('shows "1.23", not "1.2.3", when a stray second point is typed — and keeps 1.23 on leaving', () => {
    const { input, onValue } = setup(1.23);
    fireEvent.change(input, { target: { value: "1.2.3" } });
    expect(input.value).toBe("1.23");
    expect(onValue).toHaveBeenLastCalledWith(1.23);

    fireEvent.blur(input);
    expect(input.value).toBe("1.23");
    expect(onValue).toHaveBeenLastCalledWith(1.23);
  });

  it('turns a doubled point ("1..2") into 1.2 on screen, not 1 on leaving', () => {
    const { input, onValue } = setup(1.2);
    fireEvent.change(input, { target: { value: "1..2" } });
    expect(input.value).toBe("1.2");
    fireEvent.blur(input);
    expect(onValue).toHaveBeenLastCalledWith(1.2);
  });

  it("groups thousands while typing and reports the plain number", () => {
    const { input, onValue } = setup();
    fireEvent.change(input, { target: { value: "1234567.5" } });
    expect(input.value).toBe("1,234,567.5");
    expect(onValue).toHaveBeenLastCalledWith(1234567.5);
  });

  it("keeps a trailing point while the decimals are still being typed", () => {
    const { input, onValue } = setup();
    fireEvent.change(input, { target: { value: "2500." } });
    expect(input.value).toBe("2,500.");
    expect(onValue).toHaveBeenLastCalledWith(2500);
  });

  it("drops anything that is not a digit or the point", () => {
    const { input, onValue } = setup();
    fireEvent.change(input, { target: { value: "฿1,2a3-4" } });
    expect(input.value).toBe("1,234");
    expect(onValue).toHaveBeenLastCalledWith(1234);
  });

  it("shows a stored value with every decimal it has, and leaving the field does not round it", () => {
    const { input, onValue } = setup(1.23456);
    expect(input.value).toBe("1.23456");
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(input.value).toBe("1.23456");
    expect(onValue).toHaveBeenLastCalledWith(1.23456);
  });

  it("formats a value that arrives as a string the same way", () => {
    const { input } = setup("1234.5");
    expect(input.value).toBe("1,234.5");
  });

  it("follows a value the parent changes (e.g. a recomputed total)", () => {
    const onChange = vi.fn();
    const { container, rerender } = render(<FormattedNumberInput value={100} onChange={onChange} />);
    rerender(<FormattedNumberInput value={2500.75} onChange={onChange} />);
    expect(container.querySelector("input")!.value).toBe("2,500.75");
    rerender(<FormattedNumberInput value={0} onChange={onChange} />);
    expect(container.querySelector("input")!.value).toBe("");
  });

  it("shows an empty field for zero, and clearing it reports 0", () => {
    const { input, onValue } = setup(0);
    expect(input.value).toBe("");
    fireEvent.change(input, { target: { value: "15" } });
    fireEvent.change(input, { target: { value: "" } });
    expect(onValue).toHaveBeenLastCalledWith(0);
  });
});
