// Which open window is on top — for windows that close themselves on Esc.
//
// Windows stack: a confirmation over a form, a task form over a customer's
// details, a call-schedule form inside them. One Esc must close ONE window,
// the top one, and an open dropdown list takes its Esc before any window
// does. Every window marks itself `aria-modal="true"` (as a modal dialog
// should anyway), so "the top one" is the last of those in the document: a
// window opened over another is rendered after it, or inside it.

/** Set on SearchableDropdown's open panel. */
export const DROPDOWN_PANEL_ATTR = "data-dropdown-panel";

/** Whether `el` is the window on top, with no dropdown list open over it. */
export function isTopmostModal(el: Element | null): boolean {
  if (!el || typeof document === "undefined" || !el.isConnected) return false;
  if (document.querySelector(`[${DROPDOWN_PANEL_ATTR}]`)) return false;
  const modals = document.querySelectorAll('[aria-modal="true"]');
  return modals.length > 0 && modals[modals.length - 1] === el;
}
