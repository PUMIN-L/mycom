/**
 * Which public paths the maintenance-mode full-screen overlay blocks.
 * `MaintenanceOverlay` shows the "กำลังปรับปรุง" page only on these — every
 * other public page (/about, /showcase/[id], ...) stays fully browsable
 * while maintenance mode is on.
 *
 * /catalog was deliberately left open (with a link to it from the overlay
 * itself) so it stayed crawlable during a long maintenance window — the
 * owner later asked for it to be blocked too, so it moved into this list.
 * The overlay's own "ดูแคตตาล็อกสินค้า" escape link was removed with it,
 * since it would otherwise point back at itself.
 *
 * NOT used by `Footer`: hiding the phone/LINE/email block is deliberately
 * SITE-WIDE (every page Footer is mounted on), not limited to this list —
 * the owner confirmed that directly after an earlier fix scoped it to match
 * this constant. Do not import this into `Footer` again without asking.
 */
export const MAINTENANCE_BLOCKED_PATHS = ["/", "/contact", "/catalog"] as const;

/**
 * Whether the overlay covers `pathname` (usePathname()'s value): the list
 * above, with "/index" read as "/".
 *
 * Vercel's cached copy of the home page (ISR) is rendered with the path
 * "/index" — on the server usePathname() says "/index" while the browser says
 * "/" (the live page's flight data reads `"c":["","index"]`). Matching the list
 * as it stands left the overlay out of the home page's HTML, so a visitor saw
 * the page until the JavaScript ran, and the browser's first render (overlay
 * shown) no longer matched that HTML: React threw away the whole server-rendered
 * page and drew it again on every visit (hydration error #418).
 */
export function isMaintenanceBlockedPath(pathname: string | null | undefined): boolean {
  const path = pathname === "/index" ? "/" : pathname;
  return (MAINTENANCE_BLOCKED_PATHS as readonly (string | null | undefined)[]).includes(path);
}
