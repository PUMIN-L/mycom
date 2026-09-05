/**
 * The floating "ไปที่กระดานสิ่งที่ต้องทำ" shortcut on /crm/alerts.
 *
 * The rules worth a test are the ones that decide whether this is a shortcut or
 * an obstacle: it must DISAPPEAR (unmount, not fade) once the board is on
 * screen, it must be a real <button> a keyboard can reach and press, clicking
 * it must move focus INTO the board without letting focus do its own scroll,
 * and the badge must never invent a number — `null` means "we don't know", and
 * that is not the same fact as 0.
 */

import { render, screen, act, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import TaskBoardJumpButton from "@/app/components/TaskBoardJumpButton";

// ── A controllable IntersectionObserver ─────────────────────────────────────
// jsdom ships none, so the component's own "no IntersectionObserver" fallback
// is what runs unless a test installs this.

type IOCallback = (entries: { isIntersecting: boolean }[], observer: unknown) => void;

class FakeObserver {
  static instances: FakeObserver[] = [];
  observed: Element[] = [];
  disconnected = false;
  constructor(private cb: IOCallback, readonly options?: IntersectionObserverInit) {
    FakeObserver.instances.push(this);
  }
  observe(el: Element) {
    this.observed.push(el);
  }
  unobserve() {}
  disconnect() {
    this.disconnected = true;
  }
  takeRecords() {
    return [];
  }
  /** Report what the page currently looks like to the component. */
  emit(isIntersecting: boolean) {
    act(() => this.cb([{ isIntersecting }], this));
  }
}

function installObserver() {
  FakeObserver.instances = [];
  vi.stubGlobal("IntersectionObserver", FakeObserver as unknown as typeof IntersectionObserver);
  return FakeObserver;
}

/** A stand-in for the board's wrapper `<div ref tabIndex={-1}>` on the page. */
function mountTarget() {
  const el = document.createElement("div");
  el.tabIndex = -1;
  const scrollIntoView = vi.fn();
  el.scrollIntoView = scrollIntoView;
  document.body.appendChild(el);
  return { ref: { current: el as HTMLElement | null }, el, scrollIntoView };
}

const BUTTON = { name: /ไปที่กระดานสิ่งที่ต้องทำ/ };

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("TaskBoardJumpButton", () => {
  it("shows nothing while the board is already on screen", async () => {
    const Observer = installObserver();
    const { ref } = mountTarget();

    render(<TaskBoardJumpButton targetRef={ref} count={3} />);
    Observer.instances[0].emit(true);

    // Unmounted, not merely invisible: an offscreen-but-present button is a
    // stray tab stop and a stray screen-reader announcement.
    expect(screen.queryByRole("button", BUTTON)).not.toBeInTheDocument();
  });

  it("appears once the board scrolls away, and withdraws when it comes back", () => {
    const Observer = installObserver();
    const { ref } = mountTarget();

    render(<TaskBoardJumpButton targetRef={ref} count={3} />);

    Observer.instances[0].emit(false);
    expect(screen.getByRole("button", BUTTON)).toBeInTheDocument();

    Observer.instances[0].emit(true);
    expect(screen.queryByRole("button", BUTTON)).not.toBeInTheDocument();
  });

  it("is a real, focusable <button> — not a div with a click handler", () => {
    const Observer = installObserver();
    const { ref } = mountTarget();

    render(<TaskBoardJumpButton targetRef={ref} count={null} />);
    Observer.instances[0].emit(false);

    const button = screen.getByRole("button", BUTTON);
    expect(button.tagName).toBe("BUTTON");
    // type="button" so it can never submit a form it is nested in.
    expect(button).toHaveAttribute("type", "button");
    button.focus();
    expect(document.activeElement).toBe(button);
  });

  it("moves focus into the board and scrolls to it, without letting focus scroll", () => {
    const Observer = installObserver();
    const { ref, el, scrollIntoView } = mountTarget();
    const focusSpy = vi.spyOn(el, "focus");

    render(<TaskBoardJumpButton targetRef={ref} count={2} />);
    Observer.instances[0].emit(false);

    fireEvent.click(screen.getByRole("button", BUTTON));

    // `preventScroll` matters: without it focus jumps first and the smooth
    // scroll below starts from the wrong place.
    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
    expect(document.activeElement).toBe(el);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.calls[0][0]).toMatchObject({ block: "start" });
  });

  it("stops observing when it unmounts", () => {
    const Observer = installObserver();
    const { ref, el } = mountTarget();

    const { unmount } = render(<TaskBoardJumpButton targetRef={ref} count={1} />);
    expect(Observer.instances[0].observed).toEqual([el]);

    unmount();
    expect(Observer.instances[0].disconnected).toBe(true);
  });

  it("badges a real count, and draws NO badge for 0 or for an unknown count", () => {
    const Observer = installObserver();
    const { ref } = mountTarget();

    const view = render(<TaskBoardJumpButton targetRef={ref} count={7} />);
    Observer.instances[0].emit(false);
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /7 รายการ/ })).toBeInTheDocument();

    // 0 = "there is nothing to jump for" → the plain button, no red dot.
    view.rerender(<TaskBoardJumpButton targetRef={ref} count={0} />);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ไปที่กระดานสิ่งที่ต้องทำ" })).toBeInTheDocument();

    // null = "we could not tell" — a different fact from 0, and it must never
    // be printed as one.
    view.rerender(<TaskBoardJumpButton targetRef={ref} count={null} />);
    expect(screen.getByRole("button", { name: "ไปที่กระดานสิ่งที่ต้องทำ" })).toBeInTheDocument();

    view.rerender(<TaskBoardJumpButton targetRef={ref} count={140} />);
    expect(screen.getByText("99+")).toBeInTheDocument();
  });

  it("falls back to showing the shortcut when the browser has no IntersectionObserver", async () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const { ref } = mountTarget();

    render(<TaskBoardJumpButton targetRef={ref} count={1} />);

    // A shortcut that is there when it is not strictly needed beats one that
    // never appears at all.
    await waitFor(() => expect(screen.getByRole("button", BUTTON)).toBeInTheDocument());
  });
});
