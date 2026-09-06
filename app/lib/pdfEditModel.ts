/**
 * pdfEditModel.ts — the edit model and its PURE reducers.
 *
 * Every function here takes a model and returns a NEW model; nothing is ever
 * mutated in place, so undo/redo is just keeping the old object around. No
 * pdf-lib, no pdfjs, no React, no DOM — plain data in, plain data out.
 *
 * A reducer that is asked to do something impossible (delete the only page,
 * touch an id that does not exist) returns THE SAME OBJECT REFERENCE, never a
 * throw and never a broken model. Callers can therefore test `next === prev`
 * to know nothing happened — and `pushHistory` uses exactly that to avoid
 * recording an undo step for a refused edit.
 */

import type {
  Annotation,
  AssetId,
  DocPage,
  EditModel,
  FormValue,
  PageId,
  Rect,
  Rotation,
  SourceId,
} from "./pdfTypes";

/** How many undo steps are kept. Older ones fall off the back. */
export const HISTORY_LIMIT = 50;

/* ------------------------------------------------------------------ *
 * Ids
 * ------------------------------------------------------------------ */

export type IdFactory = (prefix: string) => string;

let idCounter = 0;

/** Session-unique id. Ids only have to be unique within one editing session. */
export function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${idCounter}`;
}

/** Tests call this so ids are deterministic. */
export function resetIdCounter(): void {
  idCounter = 0;
}

/* ------------------------------------------------------------------ *
 * Creation
 * ------------------------------------------------------------------ */

/** One page as read out of an uploaded file by the pdfjs read layer. */
export type SourcePageSpec = {
  widthPt: number;
  heightPt: number;
  baseRotation: Rotation;
};

export function emptyModel(): EditModel {
  return { pages: [], annotations: [], formValues: {}, flattenForm: false };
}

/** Build the initial model from the first uploaded PDF. */
export function createModel(
  src: SourceId,
  pages: SourcePageSpec[],
  makeId: IdFactory = nextId,
): EditModel {
  const taken = new Set<string>();
  return {
    pages: pages.map((p, i) => toDocPage(src, i, p, makeId, taken)),
    annotations: [],
    formValues: {},
    flattenForm: false,
  };
}

/**
 * Mint an id that is definitely not already in use. Two pages sharing an id is
 * a silent catastrophe — annotations land on both, deleting one deletes both —
 * and merging a second file is exactly where a caller can hand in an id
 * factory that has already been used.
 */
function mintUnique(makeId: IdFactory, prefix: string, taken: Set<string>): string {
  let id = makeId(prefix);
  let tries = 0;
  while (taken.has(id)) {
    tries += 1;
    id = tries <= 8 ? makeId(prefix) : `${id}~${tries}`;
  }
  taken.add(id);
  return id;
}

function toDocPage(
  src: SourceId,
  srcIndex: number,
  spec: SourcePageSpec,
  makeId: IdFactory,
  taken: Set<string>,
): DocPage {
  return {
    id: mintUnique(makeId, "pg", taken),
    src,
    srcIndex,
    addedRotation: 0,
    baseRotation: normalizeRotation(spec.baseRotation),
    widthPt: spec.widthPt,
    heightPt: spec.heightPt,
  };
}

/* ------------------------------------------------------------------ *
 * Page operations
 * ------------------------------------------------------------------ */

/** False when the document is down to its last page. */
export function canDeletePage(model: EditModel): boolean {
  return model.pages.length > 1;
}

/**
 * Delete a page and every annotation on it.
 * REFUSED for the last remaining page — a zero-page PDF cannot be saved, and
 * an editor that empties itself is worse than one that says no.
 */
export function deletePage(model: EditModel, pageId: PageId): EditModel {
  if (!canDeletePage(model)) return model;
  const pages = model.pages.filter((p) => p.id !== pageId);
  if (pages.length === model.pages.length) return model;
  return {
    ...model,
    pages,
    annotations: model.annotations.filter((a) => a.pageId !== pageId),
  };
}

/**
 * Move the page at index `from` so that it ends up at index `to` in the
 * RESULTING array (remove-then-insert semantics, so `movePage(m, 0, 2)` on
 * [A,B,C] gives [B,C,A]). Out-of-range indexes and a no-op move return the
 * model unchanged.
 */
export function movePage(model: EditModel, from: number, to: number): EditModel {
  const n = model.pages.length;
  if (!Number.isInteger(from) || !Number.isInteger(to)) return model;
  if (from < 0 || from >= n) return model;
  const target = Math.max(0, Math.min(n - 1, to));
  if (target === from) return model;
  const pages = model.pages.slice();
  const [moved] = pages.splice(from, 1);
  pages.splice(target, 0, moved);
  return { ...model, pages };
}

/** Move a page by id, for drag-and-drop that knows ids rather than indexes. */
export function movePageById(model: EditModel, pageId: PageId, to: number): EditModel {
  const from = model.pages.findIndex((p) => p.id === pageId);
  if (from < 0) return model;
  return movePage(model, from, to);
}

/**
 * Turn a page by `delta` degrees. Any multiple of 90 works, positive or
 * negative; the result is always normalised into 0/90/180/270.
 */
export function rotatePage(model: EditModel, pageId: PageId, delta: number): EditModel {
  const idx = model.pages.findIndex((p) => p.id === pageId);
  if (idx < 0) return model;
  const page = model.pages[idx];
  const added = normalizeRotation(page.addedRotation + delta);
  if (added === page.addedRotation) return model;
  const pages = model.pages.slice();
  pages[idx] = { ...page, addedRotation: added };
  return { ...model, pages };
}

/** Snap any angle into 0/90/180/270. Handles negatives and >360. */
export function normalizeRotation(deg: number): Rotation {
  const n = ((Math.round(deg / 90) * 90) % 360 + 360) % 360;
  return n as Rotation;
}

/** The rotation the page is actually displayed and saved at. */
export function effectiveRotation(page: DocPage): Rotation {
  return normalizeRotation(page.baseRotation + page.addedRotation);
}

/** Displayed page size, with width/height swapped at 90 and 270. */
export function effectivePageSize(page: DocPage): { widthPt: number; heightPt: number } {
  const rot = effectiveRotation(page);
  return rot === 90 || rot === 270
    ? { widthPt: page.heightPt, heightPt: page.widthPt }
    : { widthPt: page.widthPt, heightPt: page.heightPt };
}

/**
 * Append the pages of another uploaded PDF. Fresh `PageId`s are minted, so the
 * merged pages can never collide with — or be confused for — the existing ones.
 * Pass `atIndex` to insert rather than append.
 */
export function mergeSource(
  model: EditModel,
  src: SourceId,
  pages: SourcePageSpec[],
  makeId: IdFactory = nextId,
  atIndex?: number,
): EditModel {
  if (pages.length === 0) return model;
  const taken = new Set(model.pages.map((p) => p.id));
  const added = pages.map((p, i) => toDocPage(src, i, p, makeId, taken));
  const next = model.pages.slice();
  const at =
    atIndex === undefined
      ? next.length
      : Math.max(0, Math.min(next.length, atIndex));
  next.splice(at, 0, ...added);
  return { ...model, pages: next };
}

/**
 * EXTRACT the selected pages into a NEW model (the original is not modified —
 * "split out" means save a subset as its own file). The extracted pages keep
 * DOCUMENT order, not selection order, and carry their annotations with them.
 *
 * Returns `null` when the selection resolves to no pages at all, because a
 * zero-page PDF cannot be saved. The caller shows the Thai message.
 */
export function splitSelection(model: EditModel, pageIds: PageId[]): EditModel | null {
  const wanted = new Set(pageIds);
  const pages = model.pages.filter((p) => wanted.has(p.id));
  if (pages.length === 0) return null;
  const kept = new Set(pages.map((p) => p.id));
  return {
    pages,
    annotations: model.annotations.filter((a) => kept.has(a.pageId)),
    formValues: { ...model.formValues },
    flattenForm: model.flattenForm,
  };
}

export function canSplit(model: EditModel, pageIds: PageId[]): boolean {
  const wanted = new Set(pageIds);
  return model.pages.some((p) => wanted.has(p.id));
}

/* ------------------------------------------------------------------ *
 * Annotations — array order IS the z-order
 * ------------------------------------------------------------------ */

/**
 * Add an annotation on top of the stack.
 * REFUSED when its `pageId` is not in the document: that is how annotations
 * end up stranded on "page 7" of a three-page file after a new upload.
 */
export function addAnnotation(model: EditModel, ann: Annotation): EditModel {
  if (!model.pages.some((p) => p.id === ann.pageId)) return model;
  if (model.annotations.some((a) => a.id === ann.id)) return model;
  return { ...model, annotations: [...model.annotations, ann] };
}

/**
 * Patch one annotation. `kind` and `id` are stripped from the patch — changing
 * either would turn a valid union member into something no writer can draw.
 */
export function updateAnnotation<A extends Annotation>(
  model: EditModel,
  id: string,
  patch: Partial<Omit<A, "kind" | "id">>,
): EditModel {
  const idx = model.annotations.findIndex((a) => a.id === id);
  if (idx < 0) return model;
  const { kind: _kind, id: _id, ...safe } = patch as Record<string, unknown>;
  void _kind;
  void _id;
  if (Object.keys(safe).length === 0) return model;
  const annotations = model.annotations.slice();
  annotations[idx] = { ...model.annotations[idx], ...safe } as Annotation;
  return { ...model, annotations };
}

/** Convenience for the drag/resize handles: replace just the rect. */
export function moveAnnotation(model: EditModel, id: string, rect: Rect): EditModel {
  return updateAnnotation(model, id, { rect });
}

export function deleteAnnotation(model: EditModel, id: string): EditModel {
  const annotations = model.annotations.filter((a) => a.id !== id);
  if (annotations.length === model.annotations.length) return model;
  return { ...model, annotations };
}

/** Annotations for one page, in z-order (bottom first). */
export function annotationsForPage(model: EditModel, pageId: PageId): Annotation[] {
  return model.annotations.filter((a) => a.pageId === pageId);
}

/** Every asset still referenced — anything else can be dropped from memory. */
export function usedAssetIds(model: EditModel): AssetId[] {
  const ids: AssetId[] = [];
  for (const a of model.annotations) {
    if ((a.kind === "image" || a.kind === "signature") && !ids.includes(a.assetId)) {
      ids.push(a.assetId);
    }
  }
  return ids;
}

/* ------------------------------------------------------------------ *
 * AcroForm values
 * ------------------------------------------------------------------ */

export function setFormValue(
  model: EditModel,
  field: string,
  value: FormValue,
): EditModel {
  const current = model.formValues[field];
  if (current === value) return model;
  return { ...model, formValues: { ...model.formValues, [field]: value } };
}

export function setFlattenForm(model: EditModel, flatten: boolean): EditModel {
  if (model.flattenForm === flatten) return model;
  return { ...model, flattenForm: flatten };
}

/* ------------------------------------------------------------------ *
 * History
 * ------------------------------------------------------------------ */

export type History<T> = { past: T[]; present: T; future: T[] };

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

/**
 * Record a new state. A push whose value is identical to the present (which is
 * what a REFUSED reducer returns) is ignored, so "delete the last page" cannot
 * fill the undo stack with steps that do nothing. Any push clears the redo
 * future, and the past is capped at `HISTORY_LIMIT` by dropping the OLDEST.
 */
export function pushHistory<T>(
  history: History<T>,
  next: T,
  limit: number = HISTORY_LIMIT,
): History<T> {
  if (Object.is(next, history.present)) return history;
  const past = [...history.past, history.present];
  return {
    past: past.length > limit ? past.slice(past.length - limit) : past,
    present: next,
    future: [],
  };
}

export function canUndo<T>(history: History<T>): boolean {
  return history.past.length > 0;
}

export function canRedo<T>(history: History<T>): boolean {
  return history.future.length > 0;
}

export function undo<T>(history: History<T>): History<T> {
  if (history.past.length === 0) return history;
  const past = history.past.slice();
  const present = past.pop() as T;
  return { past, present, future: [history.present, ...history.future] };
}

export function redo<T>(history: History<T>): History<T> {
  if (history.future.length === 0) return history;
  const [present, ...future] = history.future;
  return { past: [...history.past, history.present], present, future };
}
