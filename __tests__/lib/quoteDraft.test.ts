/**
 * Unsaved quotation drafts in the browser (app/quotation/quoteDraft.ts).
 */
import { describe, it, expect } from "vitest";
import {
  DRAFTS_STORAGE_KEY,
  DRAFT_MAX_AGE_MS,
  MAX_DRAFTS,
  browserStorage,
  clearAllDrafts,
  LEGACY_DRAFT_KEY,
  draftKey,
  loadDraft,
  readDrafts,
  removeDraft,
  saveDraft,
  type DraftStorage,
} from "@/app/quotation/quoteDraft";

function memory(initial: Record<string, string> = {}): DraftStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = v; },
    removeItem: (k) => { delete data[k]; },
  };
}

const NOW = Date.parse("2026-11-03T10:00:00Z");
const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const draft = (docNo: string, msAgo = 0) => ({ savedAt: at(msAgo), state: { docNo } });

describe("draftKey", () => {
  it("names each document apart", () => {
    expect(draftKey({ kind: "new" })).toBe("new");
    expect(draftKey({ kind: "edit", id: "q1" })).toBe("edit:q1");
    expect(draftKey({ kind: "clone", sourceId: "q1" })).toBe("clone:q1");
  });

  it("puts the signed-in user in front, so two admins never share a draft", () => {
    expect(draftKey({ kind: "new" }, "u1")).toBe("u1/new");
    expect(draftKey({ kind: "edit", id: "q1" }, "u2")).toBe("u2/edit:q1");
    expect(draftKey({ kind: "new" }, "u1")).not.toBe(draftKey({ kind: "new" }, "u2"));
  });
});

describe("saveDraft / loadDraft", () => {
  it("keeps one draft per document", () => {
    const s = memory();
    saveDraft(s, "new", draft("QT-1"), NOW);
    saveDraft(s, "edit:q1", draft("QT-2"), NOW);
    saveDraft(s, "new", draft("QT-3"), NOW);
    expect(loadDraft<{ docNo: string }>(s, "new", NOW)?.state.docNo).toBe("QT-3");
    expect(loadDraft<{ docNo: string }>(s, "edit:q1", NOW)?.state.docNo).toBe("QT-2");
    expect(loadDraft(s, "clone:q1", NOW)).toBeNull();
  });

  it("carries the auto-number flag and the version source", () => {
    const s = memory();
    saveDraft(s, "clone:q1", { ...draft("QT-1v1"), autoDocNo: false, cloneSource: { id: "q1", docNo: "QT-1" } }, NOW);
    const d = loadDraft(s, "clone:q1", NOW)!;
    expect(d.autoDocNo).toBe(false);
    expect(d.cloneSource).toEqual({ id: "q1", docNo: "QT-1" });
  });

  it("does not offer a draft older than two weeks, and drops it on the next write", () => {
    const s = memory();
    saveDraft(s, "edit:old", draft("OLD", DRAFT_MAX_AGE_MS + 1000), NOW);
    expect(loadDraft(s, "edit:old", NOW)).toBeNull();
    saveDraft(s, "new", draft("NEW"), NOW);
    expect(Object.keys(readDrafts(s))).toEqual(["new"]);
  });

  it("keeps only the newest drafts", () => {
    const s = memory();
    for (let i = 0; i < MAX_DRAFTS + 3; i++) saveDraft(s, `edit:q${i}`, draft(`D${i}`, (MAX_DRAFTS + 3 - i) * 1000), NOW);
    const keys = Object.keys(readDrafts(s));
    expect(keys).toHaveLength(MAX_DRAFTS);
    expect(keys).not.toContain("edit:q0");
    expect(keys).toContain(`edit:q${MAX_DRAFTS + 2}`);
  });

  it("reads unreadable storage as no drafts, and drops malformed entries", () => {
    expect(readDrafts(memory({ [DRAFTS_STORAGE_KEY]: "{not json" }))).toEqual({});
    expect(readDrafts(memory({ [DRAFTS_STORAGE_KEY]: "[1,2]" }))).toEqual({});
    const s = memory({ [DRAFTS_STORAGE_KEY]: JSON.stringify({ a: { savedAt: at(0), state: {} }, b: { state: {} }, c: 5, d: { savedAt: at(0), state: null } }) });
    expect(Object.keys(readDrafts(s))).toEqual(["a"]);
    expect(loadDraft(s, "x", NOW)).toBeNull();
  });

  it("an unparseable save time counts as too old", () => {
    const s = memory({ [DRAFTS_STORAGE_KEY]: JSON.stringify({ new: { savedAt: "when?", state: {} } }) });
    expect(loadDraft(s, "new", NOW)).toBeNull();
  });

  it("reports a browser that will not take the draft, instead of throwing", () => {
    const full: DraftStorage = {
      getItem: () => null,
      setItem: () => { throw new Error("QuotaExceededError"); },
      removeItem: () => {},
    };
    expect(saveDraft(full, "new", draft("X"), NOW)).toBe(false);
    expect(saveDraft(null, "new", draft("X"), NOW)).toBe(false);
    expect(saveDraft(memory(), "new", draft("X"), NOW)).toBe(true);
  });
});

describe("removeDraft", () => {
  it("forgets one document's draft and leaves the others", () => {
    const s = memory();
    saveDraft(s, "new", draft("A"), NOW);
    saveDraft(s, "edit:q1", draft("B"), NOW);
    removeDraft(s, "new", NOW);
    expect(Object.keys(readDrafts(s))).toEqual(["edit:q1"]);
    removeDraft(s, "edit:q1", NOW);
    expect(s.data[DRAFTS_STORAGE_KEY]).toBeUndefined();
  });

  it("is harmless with nothing to remove, no storage, or storage that throws", () => {
    const s = memory();
    removeDraft(s, "new", NOW);
    removeDraft(null, "new", NOW);
    const broken: DraftStorage = { getItem: () => { throw new Error("blocked"); }, setItem: () => {}, removeItem: () => {} };
    expect(() => removeDraft(broken, "new", NOW)).not.toThrow();
  });
});

describe("clearAllDrafts", () => {
  it("removes every draft (and the old single one), nothing else", () => {
    const s = memory({ [DRAFTS_STORAGE_KEY]: "{}", [LEGACY_DRAFT_KEY]: "{}", other: "x" });
    clearAllDrafts(s);
    expect(s.data).toEqual({ other: "x" });
    clearAllDrafts(null);
    const broken: DraftStorage = { getItem: () => null, setItem: () => {}, removeItem: () => { throw new Error("blocked"); } };
    expect(() => clearAllDrafts(broken)).not.toThrow();
  });
});

describe("browserStorage", () => {
  it("is the page's localStorage", () => {
    expect(browserStorage()).toBe(window.localStorage);
  });
});
