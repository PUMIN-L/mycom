"use client";
import { useCallback, useState } from "react";
import { LINE_APP_URL } from "../lib/contact";

/**
 * The one decision behind every "contact us on LINE" button: a phone can open
 * the LINE app directly, a desktop cannot, so a desktop gets the QR modal
 * instead.
 *
 * This lives in one place because it was copied into Hero and Contact already,
 * and the Footer button made three. The copies were identical, which is exactly
 * the state in which they silently stop being identical — the day someone widens
 * the device test for a new tablet, two of the three buttons keep the old
 * behaviour and nobody notices, because each one looks right on its own.
 *
 * Each caller still owns its own modal state; only the decision is shared.
 */
export function useLineContact() {
  const [isLineModalOpen, setIsLineModalOpen] = useState(false);

  const closeLineModal = useCallback(() => setIsLineModalOpen(false), []);

  const handleLineClick = useCallback((e?: { preventDefault: () => void }) => {
    // Callers pass their click event so an <a> does not also follow its href.
    // Optional so a <button> can just call this.
    e?.preventDefault();
    const isMobile =
      typeof navigator !== "undefined" &&
      /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (isMobile) {
      window.location.href = LINE_APP_URL;
    } else {
      setIsLineModalOpen(true);
    }
  }, []);

  return { isLineModalOpen, closeLineModal, handleLineClick };
}
