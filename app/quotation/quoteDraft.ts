// Unsaved quotation drafts, kept in the browser so a crash, a dead battery or
// a closed tab does not take an hour's typing with it. The page used to say it
// did this ("A draft autosaves to localStorage") long after the code was gone.
//
// One draft per DOCUMENT, not one for the whole page: a new quotation, an edit
// of saved quotation X and a new version of X are three different documents,
// and restoring one into another would put the wrong items under the wrong
// number. Pure apart from the storage it is handed, so it can be tested.

export type DraftContext =
  | { kind: "new" }
  | { kind: "edit"; id: string }
  | { kind: "clone"; sourceId: string };

/**
 * The storage key for a document: "new", "edit:<id>", "clone:<id>" — and, for
 * a signed-in user, prefixed with who: drafts carry customers' names and
 * phones, and on a shared computer one admin's draft must never be offered to
 * (or overwritten by) the next one.
 */
export function draftKey(ctx: DraftContext, owner = ""): string {
  const doc = ctx.kind === "edit" ? `edit:${ctx.id}` : ctx.kind === "clone" ? `clone:${ctx.sourceId}` : "new";
  return owner ? `${owner}/${doc}` : doc;
}

export interface QuoteDraft<S> {
  /** ISO time of the last autosave. */
  savedAt: string;
  state: S;
  /** The number on it was the one the page issued, not one typed by hand —
   *  a restored new quotation keeps getting the next free number. */
  autoDocNo?: boolean;
  /** For a new version: the quotation it is a version of. */
  cloneSource?: { id: string; docNo: string };
  /** For an edit: the saved quotation it started from (its content
   *  fingerprint) — if the saved one has changed since, restoring and
   *  saving would overwrite someone else's newer work, and the offer says so. */
  base?: string;
}

export type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const DRAFTS_STORAGE_KEY = "quotation-drafts-v2";
/** The old single-draft key, written by a version long gone. */
export const LEGACY_DRAFT_KEY = "quotation-draft-v1";
/** A draft older than this is dropped rather than offered. */
export const DRAFT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
/** At most this many drafts are kept — the newest. */
export const MAX_DRAFTS = 10;

type DraftMap<S> = Record<string, QuoteDraft<S>>;

function isDraft(v: unknown): v is QuoteDraft<unknown> {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as QuoteDraft<unknown>).savedAt === "string" &&
    typeof (v as QuoteDraft<unknown>).state === "object" &&
    (v as QuoteDraft<unknown>).state !== null
  );
}

/** Every stored draft that is well-formed. Anything unreadable — no storage
 *  (private mode, blocked), bad JSON, a hand-edited entry — reads as none. */
export function readDrafts<S>(storage: DraftStorage | null): DraftMap<S> {
  if (!storage) return {};
  try {
    const parsed = JSON.parse(storage.getItem(DRAFTS_STORAGE_KEY) || "{}");
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const out: DraftMap<S> = {};
    for (const [k, v] of Object.entries(parsed)) if (isDraft(v)) out[k] = v as QuoteDraft<S>;
    return out;
  } catch {
    return {};
  }
}

function age(d: QuoteDraft<unknown>, now: number): number {
  const t = Date.parse(d.savedAt);
  return Number.isNaN(t) ? Infinity : now - t;
}

/** The draft for `key`, unless it is missing or too old to offer. */
export function loadDraft<S>(storage: DraftStorage | null, key: string, now: number): QuoteDraft<S> | null {
  const d = readDrafts<S>(storage)[key];
  if (!d || age(d, now) > DRAFT_MAX_AGE_MS) return null;
  return d;
}

function write(storage: DraftStorage, drafts: DraftMap<unknown>, now: number) {
  // Fresh ones only, newest first, at most MAX_DRAFTS.
  const kept = Object.entries(drafts)
    .filter(([, d]) => age(d, now) <= DRAFT_MAX_AGE_MS)
    .sort(([, a], [, b]) => Date.parse(b.savedAt) - Date.parse(a.savedAt))
    .slice(0, MAX_DRAFTS);
  if (kept.length === 0) storage.removeItem(DRAFTS_STORAGE_KEY);
  else storage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify(Object.fromEntries(kept)));
}

/** Store `draft` as the one for `key`. Returns false when the browser would
 *  not take it (full, blocked) — the page then simply has no draft. */
export function saveDraft<S>(storage: DraftStorage | null, key: string, draft: QuoteDraft<S>, now: number): boolean {
  if (!storage) return false;
  try {
    write(storage, { ...readDrafts(storage), [key]: draft }, now);
    return true;
  } catch {
    return false;
  }
}

/** Forget the draft for `key` (it was saved, or thrown away). */
export function removeDraft(storage: DraftStorage | null, key: string, now: number): void {
  if (!storage) return;
  try {
    const drafts = readDrafts(storage);
    if (!(key in drafts)) return;
    delete drafts[key];
    write(storage, drafts, now);
  } catch {
    // Nothing to do: a draft that cannot be removed is offered again, and can
    // be thrown away from the offer.
  }
}

/** Every draft, every user's — on logout: what was typed for customers
 *  should not outlive the session on a computer others use. */
export function clearAllDrafts(storage: DraftStorage | null): void {
  if (!storage) return;
  try {
    storage.removeItem(DRAFTS_STORAGE_KEY);
    storage.removeItem(LEGACY_DRAFT_KEY);
  } catch {
    // Storage unavailable: nothing was kept there either.
  }
}

/** The browser's localStorage, or null where touching it throws. */
export function browserStorage(): DraftStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
