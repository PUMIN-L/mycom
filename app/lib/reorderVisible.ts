/**
 * Move one row to a position **in the list the admin is actually looking at**.
 *
 * The product list is rendered from a filtered/searched/re-sorted copy of the
 * raw `products` array, so the two lists do not share an index space: with
 * "ทั้งหมด" selected the visible list is re-sorted by `bestSellerRank`, which
 * hoists ranked products to the top. Splicing inside the raw list using a
 * position read off the visible list therefore lands the row somewhere else.
 *
 * The fix: reorder the VISIBLE ids, then write them back into the slots the
 * visible rows occupy in the full list. Hidden rows keep their exact index, and
 * nothing ever assumes the two lists are ordered the same way.
 */

export interface ReorderVisibleResult {
  /** The full list in its new order — same members as `fullIds`, always. */
  ids: string[];
  /** The visible rows in the order the admin asked for. */
  visibleIds: string[];
  /** False when the request was a no-op (or was not applicable). */
  changed: boolean;
}

/**
 * @param fullIds        every row, in the order that gets saved to the server.
 * @param visibleIds     the rows on screen, in the order they are rendered.
 * @param movedId        the row being moved.
 * @param targetPosition the 1-based position **in the visible list** the admin
 *                       typed (or dropped on). Non-integers are truncated and
 *                       out-of-range values are clamped into
 *                       `1..visibleIds.length`, matching the number box's own
 *                       `min`/`max`. A non-number (NaN/Infinity) is a no-op.
 */
export function reorderVisible(
  fullIds: readonly string[],
  visibleIds: readonly string[],
  movedId: string,
  targetPosition: number,
): ReorderVisibleResult {
  const inFull = new Set(fullIds);

  // Only rows that actually exist in the full list can occupy a slot in it.
  // De-duplicate defensively so `visible.length` always equals `slots.length`.
  const seen = new Set<string>();
  const visible: string[] = [];
  for (const id of visibleIds) {
    if (inFull.has(id) && !seen.has(id)) {
      seen.add(id);
      visible.push(id);
    }
  }

  const unchanged: ReorderVisibleResult = {
    ids: [...fullIds],
    visibleIds: visible,
    changed: false,
  };

  const from = visible.indexOf(movedId);
  if (from === -1) return unchanged; // not a row the admin can see
  if (!Number.isFinite(targetPosition)) return unchanged; // NaN, ±Infinity

  const to = Math.max(0, Math.min(Math.trunc(targetPosition) - 1, visible.length - 1));
  if (to === from) return unchanged; // moved onto itself

  // 1+2. The new order of the rows on screen.
  const newVisible = [...visible];
  newVisible.splice(from, 1);
  newVisible.splice(to, 0, movedId);

  // 3. The indices in the full list that visible rows occupy — the SLOTS.
  //    Everything else in the full list is left exactly where it is.
  //
  //    `pending` is consumed as we go, so a *repeated* id in `fullIds` claims
  //    exactly one slot rather than two. Without that, a full list holding the
  //    same id twice would ask for more slots than `newVisible` has entries and
  //    write `undefined` into the tail — the caller filters those out, so a
  //    product would silently drop out of the order posted to the server.
  const pending = new Set(visible);
  const ids = [...fullIds];
  let slot = 0;
  for (let i = 0; i < ids.length; i++) {
    if (pending.has(ids[i])) {
      pending.delete(ids[i]);
      // 4. Write the new visible order into those slots, in order.
      ids[i] = newVisible[slot++];
    }
  }

  return { ids, visibleIds: newVisible, changed: true };
}
