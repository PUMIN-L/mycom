"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AssetId, EditModel, SourceId } from "../../lib/pdfTypes";
import {
  HISTORY_LIMIT,
  canRedo as historyCanRedo,
  canUndo as historyCanUndo,
  createHistory,
  emptyModel,
  nextId,
  pushHistory,
  redo as redoHistory,
  undo as undoHistory,
  type History,
} from "../../lib/pdfEditModel";
import { disposableCopy, type ImageKind } from "../../lib/pdfBytes";

/**
 * The React binding over the pure edit model in `app/lib/pdfEditModel`.
 *
 * IT IS A SHELL, DELIBERATELY. Every reducer, and the whole `{ past, present,
 * future }` history algebra, lives in `pdfEditModel` where it is pure and unit
 * tested. This file adds exactly the three things a pure module cannot own:
 *
 *   1. The React state wiring around that history, plus gesture COALESCING —
 *      dragging a whiteout box fires an update per mouse-move, and without
 *      collapsing them one drag would cost the admin forty presses of undo.
 *   2. The two OUT-OF-MODEL maps. Bytes cannot live in the history: fifty undo
 *      entries each holding a 40MB PDF is not an undo stack, it is a memory
 *      leak with a keyboard shortcut. So `Map<SourceId, Uint8Array>` (uploaded
 *      PDFs) and `Map<AssetId, Asset>` (images and signature bitmaps) sit
 *      beside the history, keyed by id, and the model stores only those ids.
 *   3. `previewEpoch` and the object-URL revocation registry.
 *
 * WHY previewEpoch EXISTS — THE DETACHMENT HAZARD
 * -----------------------------------------------
 * pdf.js TRANSFERS the ArrayBuffer it is handed to its worker, DETACHING it in
 * the main thread (`byteLength` becomes 0). If pdf-lib later reads the same
 * buffer at download time it throws "Cannot perform Construct on a detached
 * ArrayBuffer" — after an hour of work. The rule that makes that structural
 * rather than accidental: the canonical bytes in `sourcesRef` are NEVER handed
 * to the preview. It only ever receives `getSourceCopy()`, a fresh
 * `disposableCopy` made on every mount, and `previewEpoch` is the remount
 * signal, bumped whenever the set of source bytes changes.
 *
 * WHY THE OBJECT-URL REGISTRY EXISTS
 * ----------------------------------
 * The tool this replaced revoked its object URLs on every path it had, because
 * it only ever held three. An editor holds one per placed image, one per
 * signature and one per generated download, and mints them continuously.
 * Scattering `URL.revokeObjectURL` across a dozen handlers is how that
 * discipline quietly dies, so every URL is minted through `createTrackedUrl()`,
 * remembered in a Set, and released on reset and on unmount. Nothing else in
 * this feature may call `URL.createObjectURL`.
 *
 * WHY A NEW UPLOAD RESETS EVERYTHING
 * ----------------------------------
 * `loadDocument()` throws away the history, both maps and every object URL
 * before seeding the new file. The bug it prevents is concrete: the old tool
 * carried the previous file's per-page selections across when a different PDF
 * was uploaded without a full reset. In an editor the same slip leaves
 * annotations stranded on page 7 of a 3-page document.
 */

/** Two edits sharing a coalesce key within this window collapse into one undo
 *  step. Long enough to cover a drag, short enough that two deliberate edits
 *  never merge. */
const COALESCE_WINDOW_MS = 600;

/**
 * One uploaded picture or drawn signature, held outside the model.
 *
 * Defined here rather than in `pdfTypes.ts` because it is not part of the edit
 * model: the model references an asset only by `AssetId`, precisely so the
 * bytes stay out of the undo history. The write layer receives this map
 * alongside the model at download time.
 */
export interface Asset {
  id: AssetId;
  /** PNG or JPG, decided by magic bytes (`sniffImageKind`), never `file.type`. */
  kind: ImageKind;
  bytes: Uint8Array;
  /** Natural pixel size, used to keep the placed rectangle's aspect ratio. */
  widthPx: number;
  heightPx: number;
}

export interface ApplyOptions {
  /**
   * Collapse consecutive edits sharing this key into one undo step. Use it for
   * continuous gestures — a drag, a resize, typing into one field — never for
   * discrete actions.
   */
  coalesceKey?: string;
}

export interface EditorStore {
  /** The current edit model. Change it only through `apply`. */
  model: EditModel;
  canUndo: boolean;
  canRedo: boolean;
  /** True once a PDF is open and it still has at least one page. */
  hasDocument: boolean;

  /** The ONLY way to change the model. `updater` must be pure. */
  apply: (updater: (model: EditModel) => EditModel, options?: ApplyOptions) => void;
  undo: () => void;
  redo: () => void;

  /** Remount signal for the preview. See "the detachment hazard" above. */
  previewEpoch: number;

  /**
   * Replace the whole editing session with a freshly uploaded PDF.
   * RESETS EVERYTHING — history, sources, assets, object URLs.
   */
  loadDocument: (sourceId: SourceId, bytes: Uint8Array, model: EditModel) => void;
  /** Register additional source bytes (merging a second PDF in). Keeps state. */
  addSource: (sourceId: SourceId, bytes: Uint8Array) => void;
  /**
   * A DISPOSABLE copy of one source's bytes — this, never the canonical
   * buffer, is what may be handed to pdf.js.
   */
  getSourceCopy: (sourceId: SourceId) => Uint8Array | null;
  /**
   * The canonical byte map, for the pdf-lib write pass on download.
   * MUST NOT reach pdf.js: it would detach these buffers for good.
   */
  sources: Map<SourceId, Uint8Array>;

  assets: Map<AssetId, Asset>;
  addAsset: (asset: Asset) => void;
  /** `assetId` -> tracked blob URL, in the shape the preview asks for. */
  assetUrls: Readonly<Record<AssetId, string>>;

  /** Mint an object URL the store will revoke for you. */
  createTrackedUrl: (blob: Blob) => string;
  /** Revoke one tracked URL early (e.g. replacing a generated download). */
  releaseTrackedUrl: (url: string) => void;

  /** Back to a blank editor. Revokes every object URL, empties both maps. */
  reset: () => void;
}

/** Ids come from the model module so pages, annotations and assets are all
 *  minted by one counter — `pdfEditModel` relies on that when it de-duplicates
 *  ids across a merge. */
export { nextId };

export function useEditorStore(): EditorStore {
  const [history, setHistory] = useState<History<EditModel>>(() =>
    createHistory(emptyModel())
  );
  const [previewEpoch, setPreviewEpoch] = useState(0);

  // Bytes never belong in React state: they are large, never rendered
  // directly, and a re-render must not depend on them. `previewEpoch` is the
  // render signal instead.
  const sourcesRef = useRef<Map<SourceId, Uint8Array>>(new Map());

  // Assets DO drive rendering (the preview needs a URL per asset), so they
  // live in state, replaced immutably on every write.
  const [assets, setAssets] = useState<Map<AssetId, Asset>>(() => new Map());

  const trackedUrlsRef = useRef<Set<string>>(new Set());
  const assetUrlsRef = useRef<Map<AssetId, string>>(new Map());
  const coalesceRef = useRef<{ key: string; at: number } | null>(null);

  // ── the object-URL registry ────────────────────────────────────────────

  const createTrackedUrl = useCallback((blob: Blob) => {
    const url = URL.createObjectURL(blob);
    trackedUrlsRef.current.add(url);
    return url;
  }, []);

  const releaseTrackedUrl = useCallback((url: string) => {
    if (!trackedUrlsRef.current.delete(url)) return;
    URL.revokeObjectURL(url);
  }, []);

  const releaseAllUrls = useCallback(() => {
    for (const url of trackedUrlsRef.current) URL.revokeObjectURL(url);
    trackedUrlsRef.current.clear();
    assetUrlsRef.current.clear();
  }, []);

  // The last line of defence: leaving the page mid-edit must not strand a
  // single blob in memory.
  useEffect(() => releaseAllUrls, [releaseAllUrls]);

  // ── history ────────────────────────────────────────────────────────────

  const apply = useCallback(
    (updater: (model: EditModel) => EditModel, options?: ApplyOptions) => {
      const key = options?.coalesceKey;
      const now = Date.now();
      const coalesce =
        key !== undefined &&
        coalesceRef.current !== null &&
        coalesceRef.current.key === key &&
        now - coalesceRef.current.at < COALESCE_WINDOW_MS;

      coalesceRef.current = key === undefined ? null : { key, at: now };

      setHistory((current) => {
        const next = updater(current.present);
        // A refused reducer returns the model unchanged; pushHistory already
        // ignores that, and the coalescing branch has to as well.
        if (Object.is(next, current.present)) return current;
        if (coalesce) {
          // Replace the present WITHOUT growing the past: the whole gesture
          // stays one undo step. The redo branch is still invalidated, because
          // this is a new edit.
          return { past: current.past, present: next, future: [] };
        }
        return pushHistory(current, next, HISTORY_LIMIT);
      });
    },
    []
  );

  const undo = useCallback(() => {
    coalesceRef.current = null;
    setHistory((current) => undoHistory(current));
  }, []);

  const redo = useCallback(() => {
    coalesceRef.current = null;
    setHistory((current) => redoHistory(current));
  }, []);

  // ── sources & assets ───────────────────────────────────────────────────

  const reset = useCallback(() => {
    releaseAllUrls();
    sourcesRef.current = new Map();
    setAssets(new Map());
    coalesceRef.current = null;
    setHistory(createHistory(emptyModel()));
    setPreviewEpoch((epoch) => epoch + 1);
  }, [releaseAllUrls]);

  const loadDocument = useCallback(
    (sourceId: SourceId, bytes: Uint8Array, model: EditModel) => {
      // Order matters: tear everything down FIRST, then seed. Seeding into a
      // half-cleared store is exactly how an annotation ends up pointing at a
      // page belonging to the previous file.
      releaseAllUrls();
      const nextSources = new Map<SourceId, Uint8Array>();
      nextSources.set(sourceId, bytes);
      sourcesRef.current = nextSources;
      setAssets(new Map());
      coalesceRef.current = null;
      setHistory(createHistory(model));
      setPreviewEpoch((epoch) => epoch + 1);
    },
    [releaseAllUrls]
  );

  const addSource = useCallback((sourceId: SourceId, bytes: Uint8Array) => {
    const next = new Map(sourcesRef.current);
    next.set(sourceId, bytes);
    sourcesRef.current = next;
    // New bytes are in play, so the preview must rebuild from fresh copies
    // rather than the ones it has already transferred away.
    setPreviewEpoch((epoch) => epoch + 1);
  }, []);

  const getSourceCopy = useCallback((sourceId: SourceId) => {
    const bytes = sourcesRef.current.get(sourceId);
    if (!bytes) return null;
    // The canonical buffer stays in the map, intact, for pdf-lib.
    return disposableCopy(bytes);
  }, []);

  const addAsset = useCallback((asset: Asset) => {
    setAssets((current) => {
      const next = new Map(current);
      next.set(asset.id, asset);
      return next;
    });
  }, []);

  /**
   * One tracked blob URL per asset, cached so a re-render does not mint a
   * second URL for the same bytes (the leak this registry exists to prevent).
   */
  const assetUrls = useMemo(() => {
    const urls: Record<AssetId, string> = {};
    for (const [id, asset] of assets) {
      let url = assetUrlsRef.current.get(id);
      if (!url) {
        const mime = asset.kind === "png" ? "image/png" : "image/jpeg";
        // A copy again: a Blob holds on to the buffer it was built from, and
        // the asset bytes still have to survive to download time. The copy's
        // OWN buffer is what goes in — `disposableCopy` allocates it at exactly
        // the right length, so there is no offset to lose, and under this TS
        // config a `Uint8Array<ArrayBufferLike>` is not a `BlobPart` while an
        // `ArrayBuffer` is. (The same incantation the tool this replaced used.)
        url = createTrackedUrl(
          new Blob([disposableCopy(asset.bytes).buffer as ArrayBuffer], { type: mime })
        );
        assetUrlsRef.current.set(id, url);
      }
      urls[id] = url;
    }
    return urls;
  }, [assets, createTrackedUrl]);

  return {
    model: history.present,
    canUndo: historyCanUndo(history),
    canRedo: historyCanRedo(history),
    hasDocument: history.present.pages.length > 0,
    apply,
    undo,
    redo,
    previewEpoch,
    loadDocument,
    addSource,
    getSourceCopy,
    sources: sourcesRef.current,
    assets,
    addAsset,
    assetUrls,
    createTrackedUrl,
    releaseTrackedUrl,
    reset,
  };
}
