"use client";

/**
 * TaskBoardJumpButton — a floating "jump to the board" button for /crm/alerts.
 *
 * WHY IT EXISTS: the manual board ("สิ่งที่ต้องทำ") sits BELOW the automatic
 * alert feed, and the feed grows. On a busy week the board is several screens
 * down, so the one block the admin writes himself is the hardest one to reach.
 * Of the three options (a sticky column, moving the board to the top, a
 * floating button) the owner chose the floating button: the reading order of
 * the page stays exactly as it is, and only a shortcut is added.
 *
 * WHERE IT SITS — BOTTOM-LEFT, on purpose:
 *   - `GlobalAdminBell` owns bottom-left everywhere else, but it renders
 *     `null` while `pathname.startsWith("/crm/alerts")` (a bell that links to
 *     the page you are already on is noise). So on THIS page the corner is
 *     empty and the two can never be on screen together, at any width.
 *   - bottom-RIGHT is taken: the shared `Toast` component is `fixed bottom-6
 *     right-6`, and the board raises one after every save / complete / delete.
 *     A shortcut parked on top of the confirmation of the action you just took
 *     is the one collision that would happen constantly. (The alerts page's
 *     OWN toast is top-right, so that corner is spoken for too.) Bottom-left
 *     is the only free corner on this page.
 *
 * WHAT KEEPS IT FROM COVERING A CARD ON A NARROW SCREEN:
 *   - it is a 48px circle on mobile (the label only unfolds from `sm` up),
 *   - the fixed wrapper is `pointer-events-none` — only the circle itself
 *     takes clicks, so nothing else on the page becomes unreachable,
 *   - it honours the iOS safe area, and
 *   - most of all: it DISAPPEARS as soon as the board is on screen, and the
 *     board is the last block on the page — so at the bottom of the document,
 *     where the last card's buttons are, this button is already gone.
 *
 * IT IS A REAL <button>: keyboard focus, a visible focus ring, and Enter /
 * Space activation come from the element itself — there is deliberately no
 * hand-rolled onKeyDown, which would fire twice on Enter. It is removed from
 * the DOM (not just faded) when hidden, so it can never be a focus trap for a
 * keyboard user or a stray stop for a screen reader.
 *
 * COUNT: passed IN. The board fetches `/api/admin/tasks` itself and the page
 * already holds a task count from `/api/admin/alerts` — this component must
 * never open a third request just to draw a badge.
 */

import { useCallback, useEffect, useState } from "react";

export interface TaskBoardJumpButtonProps {
  /** The board's wrapper element. Give it `tabIndex={-1}` and a `scroll-mt-*`
   * that clears the sticky header — this focuses it and scrolls to it. */
  targetRef: React.RefObject<HTMLElement | null>;
  /**
   * How many tasks are still waiting. `null` means "not known yet" (still
   * loading, or the load failed) and draws NO badge: on this page a 0 means
   * "there is nothing", so it must never stand in for "we could not tell".
   */
  count: number | null;
  /** Thai noun for what `count` counts, used in the accessible label. */
  countNoun?: string;
}

/** How far into the viewport the board must come before the button gives up
 * its spot. A sliver of the top border peeking in is not "you are there yet". */
const ON_SCREEN_MARGIN_PX = 96;

export default function TaskBoardJumpButton({
  targetRef,
  count,
  countNoun = "งานที่ถึงกำหนด",
}: TaskBoardJumpButtonProps) {
  /** Starts TRUE — assume the board is already visible until the observer says
   * otherwise, so a short page (or a phone in landscape where everything fits)
   * never flashes a button for one frame and then withdraws it. */
  const [isBoardOnScreen, setIsBoardOnScreen] = useState(true);

  useEffect(() => {
    const el = targetRef.current;
    if (!el) return;

    // No IntersectionObserver (an old browser, or jsdom in a unit test): fall
    // back to always showing the shortcut. A button that is there when it is
    // not needed is a much smaller failure than one that never appears. The
    // flip is deferred to the next frame on purpose — setting state straight
    // from an effect body is a cascading render, and this is not urgent.
    if (typeof IntersectionObserver === "undefined") {
      const frame = requestAnimationFrame(() => setIsBoardOnScreen(false));
      return () => cancelAnimationFrame(frame);
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (entry) setIsBoardOnScreen(entry.isIntersecting);
      },
      // Negative bottom margin: the board counts as "on screen" only once it
      // has risen ON_SCREEN_MARGIN_PX above the bottom edge of the viewport.
      { root: null, rootMargin: `0px 0px -${ON_SCREEN_MARGIN_PX}px 0px`, threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [targetRef]);

  const jumpToBoard = useCallback(() => {
    const el = targetRef.current;
    if (!el) return;

    // Reduced motion is a real accessibility setting, not a preference to
    // second-guess: for those users this is an instant jump, not a long glide.
    const prefersReducedMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Focus BEFORE scrolling, and without letting focus do its own jump: a
    // keyboard user must continue tabbing inside the board (its filter chips,
    // its cards), not from the top of the document again.
    try {
      el.focus({ preventScroll: true });
    } catch {
      el.focus();
    }

    if (typeof el.scrollIntoView === "function") {
      el.scrollIntoView({
        behavior: prefersReducedMotion ? "auto" : "smooth",
        block: "start",
      });
    }
  }, [targetRef]);

  // Already looking at the board → the shortcut is noise. Unmounted, not
  // hidden: nothing invisible stays in the tab order.
  if (isBoardOnScreen) return null;

  // Only a real, positive number earns a badge: `null` (unknown) and 0 both
  // draw the plain button — the badge is the "worth jumping?" signal.
  const badgeCount = typeof count === "number" && count > 0 ? count : null;
  const badgeText = badgeCount === null ? null : badgeCount > 99 ? "99+" : String(badgeCount);
  const accessibleLabel =
    badgeCount === null
      ? "ไปที่กระดานสิ่งที่ต้องทำ"
      : `ไปที่กระดานสิ่งที่ต้องทำ (มี${countNoun} ${badgeCount} รายการ)`;

  return (
    <div
      // z-40: above the page and its sticky header (z-30), and below every
      // modal on this page (z-[60]), the page's toast (z-[100]) and the shared
      // `Toast` the board itself raises (z-[110]). A shortcut must never float
      // on top of a dialog the admin is answering, nor over the confirmation
      // of what he just did.
      className="fixed bottom-6 left-4 sm:bottom-10 sm:left-10 z-40 pointer-events-none animate-fade-in motion-reduce:animate-none"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <button
        type="button"
        onClick={jumpToBoard}
        aria-label={accessibleLabel}
        title={accessibleLabel}
        className="pointer-events-auto relative flex items-center justify-center gap-2 h-12 w-12 sm:h-14 sm:w-auto sm:px-5 rounded-full bg-white border-2 border-amber-400 text-amber-900 shadow-[0_8px_30px_rgb(0,0,0,0.12)] hover:bg-amber-50 hover:shadow-[0_8px_30px_rgb(245,158,11,0.28)] focus:outline-none focus-visible:ring-4 focus-visible:ring-amber-300 transition-colors"
      >
        {/* Same 🗒️ as the board's own heading — the button should look like
            where it takes you, and deliberately NOT like an alert card. */}
        <span aria-hidden="true" className="text-lg leading-none">
          🗒️
        </span>
        <span className="hidden sm:inline text-sm font-bold whitespace-nowrap">
          สิ่งที่ต้องทำ
        </span>
        <svg
          aria-hidden="true"
          className="hidden sm:block w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
        </svg>

        {badgeText && (
          <span
            aria-hidden="true"
            className="absolute top-0 right-0 inline-flex items-center justify-center px-2 py-1 text-[11px] font-extrabold leading-none text-white bg-red-600 rounded-full transform translate-x-1/4 -translate-y-1/4 shadow-sm border-2 border-white min-w-6"
          >
            {badgeText}
          </span>
        )}
      </button>
    </div>
  );
}
