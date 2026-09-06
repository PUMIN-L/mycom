// @vitest-environment node
import { describe, it, expect } from "vitest";
import { reorderVisible } from "@/app/lib/reorderVisible";

/**
 * Helper: the rows the admin does NOT see must never move, so assert their
 * index in the result is identical to their index in the input.
 */
const hiddenIndicesUnchanged = (
  before: string[],
  after: string[],
  visible: string[],
) => {
  const visibleSet = new Set(visible);
  for (let i = 0; i < before.length; i++) {
    if (!visibleSet.has(before[i])) {
      expect(after[i]).toBe(before[i]);
    }
  }
};

describe("reorderVisible", () => {
  describe("no filter (visible list === full list)", () => {
    const full = ["a", "b", "c", "d", "e"];

    it("moves a row down to the typed position", () => {
      const r = reorderVisible(full, full, "a", 3);
      expect(r.changed).toBe(true);
      expect(r.ids).toEqual(["b", "c", "a", "d", "e"]);
      // the number the admin typed is the position the row ends up in
      expect(r.visibleIds.indexOf("a") + 1).toBe(3);
    });

    it("moves a row up to the typed position", () => {
      const r = reorderVisible(full, full, "e", 2);
      expect(r.ids).toEqual(["a", "e", "b", "c", "d"]);
      expect(r.visibleIds.indexOf("e") + 1).toBe(2);
    });

    it("moves a row to the first position", () => {
      const r = reorderVisible(full, full, "d", 1);
      expect(r.ids).toEqual(["d", "a", "b", "c", "e"]);
    });

    it("moves a row to the last position", () => {
      const r = reorderVisible(full, full, "b", 5);
      expect(r.ids).toEqual(["a", "c", "d", "e", "b"]);
    });

    it("never adds, drops or duplicates a row", () => {
      const r = reorderVisible(full, full, "c", 1);
      expect([...r.ids].sort()).toEqual([...full].sort());
      expect(r.ids).toHaveLength(full.length);
    });
  });

  describe("a category filter is active", () => {
    // full list interleaves two categories; only category B is on screen
    const full = ["a1", "b1", "a2", "b2", "a3", "b3"];
    const visible = ["b1", "b2", "b3"];

    it("moves the row inside the visible list and leaves hidden rows put", () => {
      const r = reorderVisible(full, visible, "b3", 1);
      expect(r.visibleIds).toEqual(["b3", "b1", "b2"]);
      // slots occupied by visible rows are 1, 3, 5 — rewritten in order
      expect(r.ids).toEqual(["a1", "b3", "a2", "b1", "a3", "b2"]);
      hiddenIndicesUnchanged(full, r.ids, visible);
    });

    it("keeps every hidden row at its exact index for any move", () => {
      for (let pos = 1; pos <= visible.length; pos++) {
        const r = reorderVisible(full, visible, "b1", pos);
        hiddenIndicesUnchanged(full, r.ids, visible);
        expect(r.ids.filter((id) => id.startsWith("a"))).toEqual(["a1", "a2", "a3"]);
      }
    });
  });

  describe("an active search", () => {
    const full = ["p1", "p2", "p3", "p4", "p5"];
    const visible = ["p2", "p5"]; // the two rows matching the search box

    it("swaps only the matched rows, in their own slots", () => {
      const r = reorderVisible(full, visible, "p5", 1);
      expect(r.visibleIds).toEqual(["p5", "p2"]);
      expect(r.ids).toEqual(["p1", "p5", "p3", "p4", "p2"]);
      hiddenIndicesUnchanged(full, r.ids, visible);
    });
  });

  describe("visible list re-sorted so it does NOT match the underlying order", () => {
    // THE BUG: with "ทั้งหมด" selected, best sellers are hoisted to the top, so
    // the visible order is not the raw order. Typing 3 must still land the row
    // third in the list the admin is looking at.
    const full = ["u1", "r2", "u2", "r1", "u3"];
    // rendered: ranked (r1 rank 1, r2 rank 2) first, then the unranked rows
    const visible = ["r1", "r2", "u1", "u2", "u3"];

    it("puts the row at the typed VISIBLE position, not the raw-list position", () => {
      const r = reorderVisible(full, visible, "u3", 3);
      expect(r.visibleIds).toEqual(["r1", "r2", "u3", "u1", "u2"]);
      expect(r.visibleIds.indexOf("u3") + 1).toBe(3);
      // written back into the slots the visible rows occupy (here: all of them)
      expect(r.ids).toEqual(["r1", "r2", "u3", "u1", "u2"]);
    });

    it("differs from the old raw-list splice, which is what the admin saw", () => {
      // old behaviour: find the row currently 3rd on screen (u1), splice to its
      // index inside `full` -> u3 lands 2nd on screen, not 3rd.
      const oldWay = [...full];
      oldWay.splice(oldWay.indexOf("u3"), 1);
      oldWay.splice(full.indexOf("u1"), 0, "u3");
      expect(oldWay).not.toEqual(reorderVisible(full, visible, "u3", 3).ids);
    });

    it("still keeps rows hidden by a filter in place when re-sorted", () => {
      const bigFull = ["h1", "u1", "r2", "h2", "u2", "r1", "h3"];
      const vis = ["r1", "r2", "u1", "u2"];
      const r = reorderVisible(bigFull, vis, "u2", 1);
      expect(r.visibleIds).toEqual(["u2", "r1", "r2", "u1"]);
      expect(r.ids).toEqual(["h1", "u2", "r1", "h2", "r2", "u1", "h3"]);
      hiddenIndicesUnchanged(bigFull, r.ids, vis);
    });
  });

  describe("no-ops and bad input", () => {
    const full = ["a", "b", "c"];

    it("moving a row to its own position changes nothing", () => {
      const r = reorderVisible(full, full, "b", 2);
      expect(r.changed).toBe(false);
      expect(r.ids).toEqual(full);
    });

    it("clamps position 0 to the first slot", () => {
      const r = reorderVisible(full, full, "c", 0);
      expect(r.changed).toBe(true);
      expect(r.ids).toEqual(["c", "a", "b"]);
    });

    it("clamps a negative position to the first slot", () => {
      const r = reorderVisible(full, full, "c", -7);
      expect(r.ids).toEqual(["c", "a", "b"]);
    });

    it("clamps one past the end to the last slot", () => {
      const r = reorderVisible(full, full, "a", 4);
      expect(r.ids).toEqual(["b", "c", "a"]);
    });

    it("clamps far past the end to the last slot", () => {
      const r = reorderVisible(full, full, "a", 9999);
      expect(r.ids).toEqual(["b", "c", "a"]);
    });

    it("treats a non-number (NaN) as a no-op", () => {
      const r = reorderVisible(full, full, "a", Number.NaN);
      expect(r.changed).toBe(false);
      expect(r.ids).toEqual(full);
    });

    it("treats Infinity as a no-op", () => {
      expect(reorderVisible(full, full, "a", Infinity).changed).toBe(false);
      expect(reorderVisible(full, full, "a", -Infinity).changed).toBe(false);
    });

    it("truncates a fractional position", () => {
      const r = reorderVisible(full, full, "a", 2.9);
      expect(r.ids).toEqual(["b", "a", "c"]);
    });

    it("a single-item visible list can only be a no-op", () => {
      const r = reorderVisible(["a", "b"], ["a"], "a", 1);
      expect(r.changed).toBe(false);
      expect(r.ids).toEqual(["a", "b"]);
      expect(reorderVisible(["a", "b"], ["a"], "a", 5).ids).toEqual(["a", "b"]);
    });

    it("an empty visible list is a no-op", () => {
      const r = reorderVisible(full, [], "a", 1);
      expect(r.changed).toBe(false);
      expect(r.ids).toEqual(full);
    });

    it("an id that is not in the list at all is a no-op", () => {
      expect(reorderVisible(full, full, "zz", 1).changed).toBe(false);
      expect(reorderVisible(full, full, "zz", 1).ids).toEqual(full);
    });

    it("an id that is visible but missing from the full list is a no-op", () => {
      const r = reorderVisible(full, ["a", "ghost", "b"], "ghost", 1);
      expect(r.changed).toBe(false);
      expect(r.ids).toEqual(full);
    });

    it("de-duplicates a repeated id in the visible list", () => {
      // the visible list can only ever hold a row once; if it somehow does not,
      // the extra copy must not consume a second slot.
      const r = reorderVisible(full, ["a", "b", "b", "c"], "c", 1);
      expect(r.visibleIds).toEqual(["c", "a", "b"]);
      expect(r.ids).toEqual(["c", "a", "b"]);
    });

    it("never emits an undefined slot when the full list repeats an id", () => {
      // A repeated id would otherwise ask for more slots than there are visible
      // rows, writing `undefined` into the tail — the caller filters those out,
      // so a product would silently vanish from the order posted to the server.
      const r = reorderVisible(["a", "b", "a"], ["a", "b"], "b", 1);
      expect(r.ids).toHaveLength(3);
      expect(r.ids.every((id) => typeof id === "string")).toBe(true);
      // same multiset in, same multiset out — nothing added, nothing lost
      expect([...r.ids].sort()).toEqual(["a", "a", "b"]);
    });

    it("does not mutate its inputs", () => {
      const f = ["a", "b", "c"];
      const v = ["c", "a", "b"];
      reorderVisible(f, v, "b", 1);
      expect(f).toEqual(["a", "b", "c"]);
      expect(v).toEqual(["c", "a", "b"]);
    });
  });

  describe("properties that must hold for EVERY shape of list", () => {
    // A deterministic PRNG — a randomised sweep that can flake is worse than no
    // sweep at all, so the seed is fixed and the failures are reproducible.
    const rng = (seed: number) => () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };

    it("holds over 5000 generated cases, including re-sorted visible lists", () => {
      const rand = rng(20260906);
      const violations: string[] = [];

      for (let n = 0; n < 5000; n++) {
        const size = 1 + Math.floor(rand() * 9);
        const full = Array.from({ length: size }, (_, i) => `p${i}`);
        // an arbitrary (non-contiguous) subset is visible…
        const visible = full.filter(() => rand() < 0.6);
        // …in an arbitrary order, i.e. NOT a sub-order of the full list —
        // this is what the "ทั้งหมด" best-seller re-sort produces.
        for (let i = visible.length - 1; i > 0; i--) {
          const j = Math.floor(rand() * (i + 1));
          [visible[i], visible[j]] = [visible[j], visible[i]];
        }
        if (visible.length === 0) continue;

        const moved = visible[Math.floor(rand() * visible.length)];
        const pos = 1 + Math.floor(rand() * visible.length);
        const r = reorderVisible(full, visible, moved, pos);
        const shape = `full=${full} visible=${visible} moved=${moved} pos=${pos}`;
        const visibleSet = new Set(visible);

        // 1. Nothing is ever added, dropped or duplicated.
        if ([...r.ids].sort().join() !== [...full].sort().join()) {
          violations.push(`not a permutation: ${shape}`);
        }

        // 2. A row the admin cannot see NEVER changes index.
        for (let i = 0; i < full.length; i++) {
          if (!visibleSet.has(full[i]) && r.ids[i] !== full[i]) {
            violations.push(`hidden row moved: ${shape}`);
            break;
          }
        }

        // 3. The row lands at the position the admin typed, IN THE VISIBLE LIST.
        if (r.visibleIds.indexOf(moved) + 1 !== pos) {
          violations.push(`wrong visible position: ${shape}`);
        }

        // 4. Reading the visible rows out of the saved order reproduces exactly
        //    the visible order — the two lists can never drift apart again.
        if (r.changed) {
          const derived = r.ids.filter((id) => visibleSet.has(id));
          if (derived.join() !== r.visibleIds.join()) {
            violations.push(`slot writeback disagrees with visible order: ${shape}`);
          }
        } else if (r.ids.join() !== full.join()) {
          // 5. A no-op must leave the saved order byte-identical.
          violations.push(`no-op mutated the full list: ${shape}`);
        }
      }

      expect(violations).toEqual([]);
    });
  });

  describe("drag and the number box agree", () => {
    // The drag handler converts "dropped on row X" into "the visible position
    // of X", so both entry points go through the same arithmetic.
    const full = ["u1", "r2", "u2", "r1", "u3"];
    const visible = ["r1", "r2", "u1", "u2", "u3"];

    it("dropping onto the row at visible position N === typing N", () => {
      const targetId = "u1"; // 3rd on screen
      const byDrag = reorderVisible(full, visible, "u3", visible.indexOf(targetId) + 1);
      const byTyping = reorderVisible(full, visible, "u3", 3);
      expect(byDrag.ids).toEqual(byTyping.ids);
      expect(byDrag.visibleIds).toEqual(byTyping.visibleIds);
    });
  });
});
