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
