/**
 * Which public paths the maintenance-mode full-screen overlay blocks.
 * `MaintenanceOverlay` shows the "กำลังปรับปรุง" page only on these — every
 * other public page (/catalog, /about, /showcase/[id], ...) stays fully
 * browsable while maintenance mode is on.
 *
 * NOT used by `Footer`: hiding the phone/LINE/email block is deliberately
 * SITE-WIDE (every page Footer is mounted on), not limited to this list —
 * the owner confirmed that directly after an earlier fix scoped it to match
 * this constant. Do not import this into `Footer` again without asking.
 */
export const MAINTENANCE_BLOCKED_PATHS = ["/", "/contact"] as const;
