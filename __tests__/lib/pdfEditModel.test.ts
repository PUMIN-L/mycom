// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import {
  HISTORY_LIMIT,
  nextId,
  resetIdCounter,
  emptyModel,
  createModel,
  canDeletePage,
  deletePage,
  movePage,
  movePageById,
  rotatePage,
  normalizeRotation,
  effectiveRotation,
  effectivePageSize,
  mergeSource,
  splitSelection,
  canSplit,
  addAnnotation,
  updateAnnotation,
  moveAnnotation,
  deleteAnnotation,
  annotationsForPage,
  usedAssetIds,
  setFormValue,
  setFlattenForm,
  createHistory,
  pushHistory,
  canUndo,
  canRedo,
  undo,
  redo,
  type IdFactory,
  type SourcePageSpec,
} from '@/app/lib/pdfEditModel';
import type {
  Annotation,
  EditModel,
  Rect,
  TextAnnotation,
  WhiteoutAnnotation,
} from '@/app/lib/pdfTypes';

/** Deterministic ids: pg_1, pg_2, … regardless of what other tests did. */
function counter(): IdFactory {
  let n = 0;
  return (prefix) => `${prefix}_${++n}`;
}

const A4: SourcePageSpec = { widthPt: 595, heightPt: 842, baseRotation: 0 };

function pages(n: number, spec: Partial<SourcePageSpec> = {}): SourcePageSpec[] {
  return Array.from({ length: n }, () => ({ ...A4, ...spec }));
}

function model(n = 3, src = 'src1'): EditModel {
  return createModel(src, pages(n), counter());
}

const RECT: Rect = { x: 10, y: 20, width: 30, height: 40 };

function whiteout(id: string, pageId: string): WhiteoutAnnotation {
  return { kind: 'whiteout', id, pageId, rect: { ...RECT } };
}

function text(id: string, pageId: string, value = 'สวัสดี'): TextAnnotation {
  return {
    kind: 'text',
    id,
    pageId,
    rect: { ...RECT },
    text: value,
    sizePt: 14,
    color: { r: 0, g: 0, b: 0 },
    bold: false,
    angleDeg: 0,
    align: 'left',
  };
}

describe('ids', () => {
  beforeEach(() => resetIdCounter());

  it('mints unique ids with the given prefix', () => {
    expect(nextId('pg')).toBe('pg_1');
    expect(nextId('pg')).toBe('pg_2');
    expect(nextId('an')).toBe('an_3');
  });

  it('resetIdCounter makes a run deterministic', () => {
    nextId('pg');
    resetIdCounter();
    expect(nextId('pg')).toBe('pg_1');
  });
});

describe('createModel / emptyModel', () => {
  it('starts empty with no annotations, no form values and no flattening', () => {
    expect(emptyModel()).toEqual({
      pages: [],
      annotations: [],
      formValues: {},
      flattenForm: false,
    });
  });

  it('numbers srcIndex from 0 in upload order and keeps the source id', () => {
    const m = createModel('src1', pages(3), counter());
    expect(m.pages.map((p) => p.srcIndex)).toEqual([0, 1, 2]);
    expect(m.pages.map((p) => p.id)).toEqual(['pg_1', 'pg_2', 'pg_3']);
    expect(m.pages.every((p) => p.src === 'src1')).toBe(true);
  });

  it('records the file’s own rotation as baseRotation and starts addedRotation at 0', () => {
    const m = createModel('s', [{ widthPt: 595, heightPt: 842, baseRotation: 90 }], counter());
    expect(m.pages[0].baseRotation).toBe(90);
    expect(m.pages[0].addedRotation).toBe(0);
  });

  it('normalises a bad baseRotation rather than storing it', () => {
    const m = createModel(
      's',
      [{ widthPt: 1, heightPt: 1, baseRotation: 450 as 90 }],
      counter(),
    );
    expect(m.pages[0].baseRotation).toBe(90);
  });

  it('uses the module id factory when none is supplied', () => {
    resetIdCounter();
    expect(createModel('s', pages(1)).pages[0].id).toBe('pg_1');
  });
});

describe('deletePage', () => {
  it('removes the page and leaves the others in order', () => {
    const m = model(3);
    const next = deletePage(m, 'pg_2');
    expect(next.pages.map((p) => p.id)).toEqual(['pg_1', 'pg_3']);
  });

  it('takes that page’s annotations with it and leaves the rest alone', () => {
    let m = model(3);
    m = addAnnotation(m, whiteout('a1', 'pg_1'));
    m = addAnnotation(m, text('a2', 'pg_2'));
    m = addAnnotation(m, whiteout('a3', 'pg_3'));
    const next = deletePage(m, 'pg_2');
    expect(next.annotations.map((a) => a.id)).toEqual(['a1', 'a3']);
  });

  it('REFUSES to delete the last page — a zero-page document is not a document', () => {
    const m = model(1);
    expect(canDeletePage(m)).toBe(false);
    const next = deletePage(m, 'pg_1');
    expect(next).toBe(m); // same reference: nothing happened
    expect(next.pages).toHaveLength(1);
  });

  it('allows deleting down to exactly one page', () => {
    let m = model(2);
    m = deletePage(m, 'pg_1');
    expect(m.pages.map((p) => p.id)).toEqual(['pg_2']);
    expect(canDeletePage(m)).toBe(false);
  });

  it('is a no-op for an unknown id', () => {
    const m = model(3);
    expect(deletePage(m, 'nope')).toBe(m);
  });

  it('does not mutate the input model', () => {
    const m = model(3);
    const before = m.pages.map((p) => p.id);
    deletePage(m, 'pg_1');
    expect(m.pages.map((p) => p.id)).toEqual(before);
  });
});

describe('movePage', () => {
  const order = (m: EditModel) => m.pages.map((p) => p.id);

  it('moves the first page to the end (remove-then-insert semantics)', () => {
    expect(order(movePage(model(3), 0, 2))).toEqual(['pg_2', 'pg_3', 'pg_1']);
  });

  it('moves the last page to the front', () => {
    expect(order(movePage(model(3), 2, 0))).toEqual(['pg_3', 'pg_1', 'pg_2']);
  });

  it('moves one step forward without skipping a slot', () => {
    expect(order(movePage(model(4), 1, 2))).toEqual(['pg_1', 'pg_3', 'pg_2', 'pg_4']);
  });

  it('moves one step backward', () => {
    expect(order(movePage(model(4), 2, 1))).toEqual(['pg_1', 'pg_3', 'pg_2', 'pg_4']);
  });

  it('is a no-op when from === to', () => {
    const m = model(3);
    expect(movePage(m, 1, 1)).toBe(m);
  });

  it('clamps a target index past the end instead of dropping the page', () => {
    expect(order(movePage(model(3), 0, 99))).toEqual(['pg_2', 'pg_3', 'pg_1']);
  });

  it('clamps a negative target index', () => {
    expect(order(movePage(model(3), 2, -5))).toEqual(['pg_3', 'pg_1', 'pg_2']);
  });

  it('refuses an out-of-range source index', () => {
    const m = model(3);
    expect(movePage(m, 3, 0)).toBe(m);
    expect(movePage(m, -1, 0)).toBe(m);
  });

  it('refuses a fractional index rather than splicing at NaN', () => {
    const m = model(3);
    expect(movePage(m, 1.5, 0)).toBe(m);
    expect(movePage(m, 0, 1.5)).toBe(m);
  });

  it('never loses or duplicates a page across many moves', () => {
    let m = model(5);
    for (const [from, to] of [[0, 4], [3, 1], [2, 2], [4, 0], [1, 3]]) {
      m = movePage(m, from, to);
    }
    expect(new Set(order(m)).size).toBe(5);
    expect(m.pages).toHaveLength(5);
  });

  it('movePageById finds the index for a drag handler', () => {
    expect(order(movePageById(model(3), 'pg_3', 0))).toEqual(['pg_3', 'pg_1', 'pg_2']);
  });

  it('movePageById is a no-op for an unknown id', () => {
    const m = model(3);
    expect(movePageById(m, 'nope', 0)).toBe(m);
  });
});

describe('rotatePage', () => {
  it('adds a quarter turn', () => {
    expect(rotatePage(model(2), 'pg_1', 90).pages[0].addedRotation).toBe(90);
  });

  it('wraps past 360 back to 0', () => {
    let m = model(1);
    for (let i = 0; i < 4; i++) m = rotatePage(m, 'pg_1', 90);
    expect(m.pages[0].addedRotation).toBe(0);
  });

  it('accepts a negative delta', () => {
    expect(rotatePage(model(1), 'pg_1', -90).pages[0].addedRotation).toBe(270);
  });

  it('leaves the other pages untouched', () => {
    const next = rotatePage(model(3), 'pg_2', 180);
    expect(next.pages.map((p) => p.addedRotation)).toEqual([0, 180, 0]);
  });

  it('is a no-op for an unknown page and for a full turn', () => {
    const m = model(2);
    expect(rotatePage(m, 'nope', 90)).toBe(m);
    expect(rotatePage(m, 'pg_1', 360)).toBe(m);
  });

  it('does not touch baseRotation — the file’s own /Rotate is preserved', () => {
    const m = createModel('s', [{ ...A4, baseRotation: 90 }], counter());
    const next = rotatePage(m, 'pg_1', 90);
    expect(next.pages[0].baseRotation).toBe(90);
    expect(next.pages[0].addedRotation).toBe(90);
  });
});

describe('rotation maths', () => {
  it('normalizeRotation handles negatives, wraps and odd angles', () => {
    expect(normalizeRotation(0)).toBe(0);
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(-450)).toBe(270);
    expect(normalizeRotation(720)).toBe(0);
    expect(normalizeRotation(89)).toBe(90);
  });

  it('effectiveRotation adds the file’s rotation to the admin’s', () => {
    const m = rotatePage(createModel('s', [{ ...A4, baseRotation: 270 }], counter()), 'pg_1', 180);
    expect(effectiveRotation(m.pages[0])).toBe(90);
  });

  it('effectivePageSize swaps width and height at 90 and 270 only', () => {
    const upright = createModel('s', [A4], counter()).pages[0];
    expect(effectivePageSize(upright)).toEqual({ widthPt: 595, heightPt: 842 });

    const turned = createModel('s', [{ ...A4, baseRotation: 90 }], counter()).pages[0];
    expect(effectivePageSize(turned)).toEqual({ widthPt: 842, heightPt: 595 });

    const flipped = createModel('s', [{ ...A4, baseRotation: 180 }], counter()).pages[0];
    expect(effectivePageSize(flipped)).toEqual({ widthPt: 595, heightPt: 842 });
  });
});

describe('mergeSource', () => {
  it('appends the second file’s pages after the first file’s', () => {
    const m = mergeSource(model(2), 'src2', pages(2), counter());
    expect(m.pages.map((p) => p.src)).toEqual(['src1', 'src1', 'src2', 'src2']);
    expect(m.pages.map((p) => p.srcIndex)).toEqual([0, 1, 0, 1]);
  });

  it('mints fresh page ids so merged pages cannot collide with existing ones', () => {
    const shared = counter();
    const m = mergeSource(createModel('src1', pages(2), shared), 'src2', pages(2), shared);
    expect(new Set(m.pages.map((p) => p.id)).size).toBe(4);
  });

  it('re-mints rather than duplicating when the id factory repeats itself', () => {
    // A caller that hands in a fresh counter would otherwise mint pg_1 twice —
    // two pages sharing an id means annotations land on both and deleting one
    // deletes both.
    const m = mergeSource(model(2), 'src2', pages(2), counter());
    const ids = m.pages.map((p) => p.id);
    expect(new Set(ids).size).toBe(4);
    expect(ids.slice(0, 2)).toEqual(['pg_1', 'pg_2']);
  });

  it('inserts at an index when asked', () => {
    const m = mergeSource(model(2), 'src2', pages(1), counter(), 1);
    expect(m.pages.map((p) => p.src)).toEqual(['src1', 'src2', 'src1']);
  });

  it('clamps an out-of-range insert index', () => {
    expect(mergeSource(model(2), 'src2', pages(1), counter(), 99).pages[2].src).toBe('src2');
    expect(mergeSource(model(2), 'src2', pages(1), counter(), -3).pages[0].src).toBe('src2');
  });

  it('TERMINATES even if the id factory always returns the same string', () => {
    // The escape hatch matters more than the ids it produces: a factory that
    // never varies must not spin the browser in an infinite loop.
    const stuck: IdFactory = () => 'pg_1';
    const m = mergeSource(model(2), 'src2', pages(2), stuck);
    expect(m.pages).toHaveLength(4);
    expect(new Set(m.pages.map((p) => p.id)).size).toBe(4);
  });

  it('is a no-op when the merged file has no pages', () => {
    const m = model(2);
    expect(mergeSource(m, 'src2', [], counter())).toBe(m);
  });

  it('keeps existing annotations', () => {
    const m = addAnnotation(model(2), whiteout('a1', 'pg_1'));
    expect(mergeSource(m, 'src2', pages(1), counter()).annotations).toHaveLength(1);
  });
});

describe('splitSelection — extract, non-destructive', () => {
  it('returns a new model with only the selected pages', () => {
    const m = model(4);
    const out = splitSelection(m, ['pg_2', 'pg_4']);
    expect(out?.pages.map((p) => p.id)).toEqual(['pg_2', 'pg_4']);
  });

  it('keeps DOCUMENT order, not the order the admin ticked the boxes', () => {
    const out = splitSelection(model(4), ['pg_4', 'pg_1', 'pg_3']);
    expect(out?.pages.map((p) => p.id)).toEqual(['pg_1', 'pg_3', 'pg_4']);
  });

  it('carries only the selected pages’ annotations', () => {
    let m = model(3);
    m = addAnnotation(m, whiteout('a1', 'pg_1'));
    m = addAnnotation(m, text('a2', 'pg_2'));
    const out = splitSelection(m, ['pg_2']);
    expect(out?.annotations.map((a) => a.id)).toEqual(['a2']);
  });

  it('does NOT modify the original model', () => {
    const m = model(3);
    splitSelection(m, ['pg_1']);
    expect(m.pages).toHaveLength(3);
  });

  it('returns null rather than an unsaveable zero-page document', () => {
    expect(splitSelection(model(3), [])).toBeNull();
    expect(splitSelection(model(3), ['nope'])).toBeNull();
  });

  it('ignores ids that are not in the document', () => {
    const out = splitSelection(model(3), ['pg_1', 'ghost']);
    expect(out?.pages.map((p) => p.id)).toEqual(['pg_1']);
  });

  it('canSplit answers before the button is pressed', () => {
    const m = model(3);
    expect(canSplit(m, [])).toBe(false);
    expect(canSplit(m, ['ghost'])).toBe(false);
    expect(canSplit(m, ['pg_2'])).toBe(true);
  });

  it('copies the form values instead of sharing the object', () => {
    const m = setFormValue(model(2), 'name', 'ก');
    const out = splitSelection(m, ['pg_1']);
    expect(out?.formValues).toEqual({ name: 'ก' });
    expect(out?.formValues).not.toBe(m.formValues);
  });
});

describe('annotations — array order is the z-order', () => {
  it('appends on top of the stack', () => {
    let m = model(2);
    m = addAnnotation(m, whiteout('a1', 'pg_1'));
    m = addAnnotation(m, text('a2', 'pg_1'));
    expect(m.annotations.map((a) => a.id)).toEqual(['a1', 'a2']);
  });

  it('REFUSES an annotation whose page is not in the document', () => {
    const m = model(2);
    // Exactly the "stranded on page 7 of a 3-page file" bug after a new upload.
    expect(addAnnotation(m, whiteout('a1', 'pg_9'))).toBe(m);
  });

  it('refuses a duplicate annotation id', () => {
    const m = addAnnotation(model(2), whiteout('a1', 'pg_1'));
    expect(addAnnotation(m, text('a1', 'pg_2'))).toBe(m);
  });

  it('updateAnnotation patches only the named annotation', () => {
    let m = model(2);
    m = addAnnotation(m, text('a1', 'pg_1', 'เดิม'));
    m = addAnnotation(m, text('a2', 'pg_1', 'อื่น'));
    m = updateAnnotation<TextAnnotation>(m, 'a1', { text: 'ใหม่', sizePt: 22 });
    const [first, second] = m.annotations as TextAnnotation[];
    expect(first.text).toBe('ใหม่');
    expect(first.sizePt).toBe(22);
    expect(second.text).toBe('อื่น');
  });

  it('keeps the z-order position when an annotation is edited', () => {
    let m = model(1);
    m = addAnnotation(m, whiteout('a1', 'pg_1'));
    m = addAnnotation(m, text('a2', 'pg_1'));
    m = addAnnotation(m, whiteout('a3', 'pg_1'));
    m = moveAnnotation(m, 'a2', { x: 1, y: 2, width: 3, height: 4 });
    expect(m.annotations.map((a) => a.id)).toEqual(['a1', 'a2', 'a3']);
  });

  it('never lets a patch change kind or id', () => {
    let m = addAnnotation(model(1), text('a1', 'pg_1'));
    m = updateAnnotation(m, 'a1', {
      kind: 'whiteout',
      id: 'hacked',
    } as unknown as Partial<Annotation>);
    expect(m.annotations[0].kind).toBe('text');
    expect(m.annotations[0].id).toBe('a1');
  });

  it('is a no-op for an unknown id or an empty patch', () => {
    const m = addAnnotation(model(1), text('a1', 'pg_1'));
    expect(updateAnnotation(m, 'ghost', { rect: RECT })).toBe(m);
    expect(updateAnnotation(m, 'a1', {})).toBe(m);
  });

  it('does not mutate the annotation object it replaces', () => {
    const original = text('a1', 'pg_1', 'เดิม');
    const m = updateAnnotation<TextAnnotation>(
      addAnnotation(model(1), original),
      'a1',
      { text: 'ใหม่' },
    );
    expect(original.text).toBe('เดิม');
    expect(m.annotations[0]).not.toBe(original);
  });

  it('deleteAnnotation removes one and is a no-op for an unknown id', () => {
    let m = model(1);
    m = addAnnotation(m, whiteout('a1', 'pg_1'));
    m = addAnnotation(m, text('a2', 'pg_1'));
    expect(deleteAnnotation(m, 'a1').annotations.map((a) => a.id)).toEqual(['a2']);
    expect(deleteAnnotation(m, 'ghost')).toBe(m);
  });

  it('annotationsForPage filters in z-order', () => {
    let m = model(2);
    m = addAnnotation(m, whiteout('a1', 'pg_1'));
    m = addAnnotation(m, text('a2', 'pg_2'));
    m = addAnnotation(m, whiteout('a3', 'pg_1'));
    expect(annotationsForPage(m, 'pg_1').map((a) => a.id)).toEqual(['a1', 'a3']);
    expect(annotationsForPage(m, 'pg_9')).toEqual([]);
  });

  it('usedAssetIds lists each image/signature asset once', () => {
    let m = model(1);
    m = addAnnotation(m, {
      kind: 'image', id: 'i1', pageId: 'pg_1', rect: RECT, assetId: 'as1', opacity: 1,
    });
    m = addAnnotation(m, {
      kind: 'image', id: 'i2', pageId: 'pg_1', rect: RECT, assetId: 'as1', opacity: 0.5,
    });
    m = addAnnotation(m, {
      kind: 'signature', id: 's1', pageId: 'pg_1', rect: RECT, assetId: 'as2',
    });
    m = addAnnotation(m, whiteout('w1', 'pg_1'));
    expect(usedAssetIds(m)).toEqual(['as1', 'as2']);
  });

  it('usedAssetIds is empty when nothing references an asset', () => {
    expect(usedAssetIds(model(1))).toEqual([]);
  });
});

describe('form values', () => {
  it('sets a text, a checkbox and a multi-select value', () => {
    let m = model(1);
    m = setFormValue(m, 'ชื่อ', 'สมชาย');
    m = setFormValue(m, 'ยินยอม', true);
    m = setFormValue(m, 'ตัวเลือก', ['ก', 'ข']);
    expect(m.formValues).toEqual({ ชื่อ: 'สมชาย', ยินยอม: true, ตัวเลือก: ['ก', 'ข'] });
  });

  it('overwrites an existing value', () => {
    let m = setFormValue(model(1), 'a', 'one');
    m = setFormValue(m, 'a', 'two');
    expect(m.formValues.a).toBe('two');
  });

  it('is a no-op when the value is unchanged', () => {
    const m = setFormValue(model(1), 'a', 'one');
    expect(setFormValue(m, 'a', 'one')).toBe(m);
  });

  it('does not mutate the previous formValues object', () => {
    const m = setFormValue(model(1), 'a', 'one');
    const next = setFormValue(m, 'b', 'two');
    expect(m.formValues).toEqual({ a: 'one' });
    expect(next.formValues).not.toBe(m.formValues);
  });

  it('setFlattenForm toggles and is a no-op when already set', () => {
    const m = model(1);
    expect(m.flattenForm).toBe(false);
    const on = setFlattenForm(m, true);
    expect(on.flattenForm).toBe(true);
    expect(setFlattenForm(on, true)).toBe(on);
  });
});

describe('history', () => {
  it('starts with nothing to undo or redo', () => {
    const h = createHistory(model(2));
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
    expect(undo(h)).toBe(h);
    expect(redo(h)).toBe(h);
  });

  it('undo restores the previous model, redo puts it back', () => {
    const m0 = model(3);
    const m1 = deletePage(m0, 'pg_1');
    const h1 = pushHistory(createHistory(m0), m1);

    const undone = undo(h1);
    expect(undone.present).toBe(m0);
    expect(canRedo(undone)).toBe(true);

    const redone = redo(undone);
    expect(redone.present).toBe(m1);
    expect(canRedo(redone)).toBe(false);
  });

  it('undoes several steps in reverse order', () => {
    const m0 = model(4);
    const m1 = deletePage(m0, 'pg_1');
    const m2 = deletePage(m1, 'pg_2');
    let h = pushHistory(pushHistory(createHistory(m0), m1), m2);
    h = undo(h);
    expect(h.present).toBe(m1);
    h = undo(h);
    expect(h.present).toBe(m0);
    expect(canUndo(h)).toBe(false);
  });

  it('a new edit after an undo clears the redo future', () => {
    const m0 = model(3);
    const m1 = rotatePage(m0, 'pg_1', 90);
    const m2 = rotatePage(m1, 'pg_2', 90);
    let h = pushHistory(pushHistory(createHistory(m0), m1), m2);
    h = undo(h); // present = m1, future = [m2]
    expect(canRedo(h)).toBe(true);
    h = pushHistory(h, rotatePage(m1, 'pg_3', 180));
    expect(canRedo(h)).toBe(false);
    expect(h.future).toEqual([]);
  });

  it('IGNORES a push of the identical state, so a refused edit records no step', () => {
    const m = model(1);
    const h = createHistory(m);
    // deletePage on the last page returns the same reference — pushing that
    // must not leave the admin with an undo button that does nothing.
    const after = pushHistory(h, deletePage(m, 'pg_1'));
    expect(after).toBe(h);
    expect(canUndo(after)).toBe(false);
  });

  it('caps the past at HISTORY_LIMIT, dropping the OLDEST entry', () => {
    let h = createHistory(0);
    for (let i = 1; i <= HISTORY_LIMIT + 10; i++) h = pushHistory(h, i);
    expect(h.past).toHaveLength(HISTORY_LIMIT);
    expect(h.present).toBe(HISTORY_LIMIT + 10);
    expect(h.past[0]).toBe(10); // 0…9 fell off the back
  });

  it('honours a custom limit', () => {
    let h = createHistory(0);
    for (let i = 1; i <= 5; i++) h = pushHistory(h, i, 2);
    expect(h.past).toEqual([3, 4]);
  });

  it('does not mutate the history it is given', () => {
    const h = createHistory(model(2));
    const next = pushHistory(h, model(2));
    expect(h.past).toEqual([]);
    expect(next.past).toHaveLength(1);
  });
});
