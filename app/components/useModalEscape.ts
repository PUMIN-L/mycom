"use client";

import { useEffect, useRef, type RefObject } from "react";
import { isTopmostModal } from "../lib/dialogLayer";

/**
 * Esc runs `onEscape` — only while `ref` (an `aria-modal="true"` element) is
 * the window on top (see lib/dialogLayer.ts), so pressing it in a window
 * opened over this one, or in an open dropdown list, leaves this one alone.
 *
 * The latest `onEscape` is always the one run; it need not be stable.
 */
export function useModalEscape(
  ref: RefObject<HTMLElement | null>,
  onEscape: () => void,
  enabled = true
) {
  const handlerRef = useRef(onEscape);
  useEffect(() => {
    handlerRef.current = onEscape;
  });
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (!isTopmostModal(ref.current)) return;
      event.preventDefault();
      handlerRef.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [ref, enabled]);
}
