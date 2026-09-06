// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  applyMatrix,
  applyInverseMatrix,
  makeViewport,
  clientToViewport,
  viewportToClient,
  screenPointToPdf,
  pdfPointToScreen,
  screenRectToPdfRect,
  screenBoxToPdfRect,
  pdfRectToScreenRect,
  toLocalRect,
  rectFromCorners,
  rotatedDrawAnchor,
  normalizeQuarterTurn,
  textMatrixToSizeAndAngle,
  textMatrixOrigin,
  inspectPageGeometry,
  cropRelativeToUserSpace,
  userSpaceToCropRelative,
  type Matrix6,
  type ScreenBox,
  type ViewportLike,
} from '@/app/lib/pdfCoords';

const W = 600;
const H = 800;

/** A canvas laid out at exactly viewport size, at the page origin. */
function boxFor(vp: ViewportLike, left = 0, top = 0): ScreenBox {
  return { left, top, width: vp.width, height: vp.height };
}

function near(a: number, b: number, digits = 9) {
  expect(a).toBeCloseTo(b, digits);
}

function nearPoint(p: { x: number; y: number }, x: number, y: number) {
  near(p.x, x);
  near(p.y, y);
}

describe('makeViewport — mirrors pdfjs PageViewport', () => {
  it('produces the pdfjs transform at /Rotate 0 (y-flip, origin at bottom-left)', () => {
    const vp = makeViewport(W, H, 0);
    expect(vp.transform).toEqual([1, 0, 0, -1, 0, 800]);
    expect(vp.width).toBe(600);
    expect(vp.height).toBe(800);
    // PDF (0,0) is the BOTTOM-left, so it lands at canvas y = height.
    nearPoint(applyMatrix(vp.transform, { x: 0, y: 0 }), 0, 800);
  });

  it('produces the pdfjs transform at /Rotate 90, and swaps the viewport size', () => {
    const vp = makeViewport(W, H, 90);
    expect(vp.transform).toEqual([0, 1, 1, 0, 0, 0]);
    expect(vp.width).toBe(800);
    expect(vp.height).toBe(600);
  });

  it('produces the pdfjs transform at /Rotate 180', () => {
    const vp = makeViewport(W, H, 180);
    expect(vp.transform).toEqual([-1, 0, 0, 1, 600, 0]);
    expect(vp.width).toBe(600);
    expect(vp.height).toBe(800);
  });

  it('produces the pdfjs transform at /Rotate 270', () => {
    const vp = makeViewport(W, H, 270);
    expect(vp.transform).toEqual([0, -1, -1, 0, 800, 600]);
    expect(vp.width).toBe(800);
    expect(vp.height).toBe(600);
  });

  it('normalises a negative rotation the way pdfjs does', () => {
    expect(makeViewport(W, H, -90).transform).toEqual(makeViewport(W, H, 270).transform);
  });

  it('scales the transform and the viewport size together', () => {
    const vp = makeViewport(W, H, 0, 2);
    expect(vp.transform).toEqual([2, 0, 0, -2, 0, 1600]);
    expect(vp.width).toBe(1200);
    expect(vp.height).toBe(1600);
  });

  it('bakes a non-zero CropBox origin into the transform', () => {
    const vp = makeViewport(W, H, 0, 1, [20, 30, 620, 830]);
    expect(vp.transform).toEqual([1, 0, 0, -1, -20, 830]);
    // The CropBox's own bottom-left is the canvas bottom-left.
    nearPoint(applyMatrix(vp.transform, { x: 20, y: 30 }), 0, 800);
    nearPoint(applyMatrix(vp.transform, { x: 20, y: 830 }), 0, 0);
  });
});

describe('matrix primitives', () => {
  it('applyMatrix follows the PDF convention a·x + c·y + e', () => {
    nearPoint(applyMatrix([2, 3, 5, 7, 11, 13], { x: 1, y: 1 }), 2 + 5 + 11, 3 + 7 + 13);
  });

  it('applyInverseMatrix undoes applyMatrix, including for a reflection', () => {
    const m: Matrix6 = [0, 1, 1, 0, 0, 0]; // determinant -1
    const p = { x: 123.5, y: 45.25 };
    nearPoint(applyInverseMatrix(m, applyMatrix(m, p)), p.x, p.y);
  });

  it('throws on a singular transform rather than returning Infinity', () => {
    expect(() => applyInverseMatrix([0, 0, 0, 0, 0, 0], { x: 1, y: 1 })).toThrow(
      /not invertible/,
    );
  });
});

describe('client ⇄ viewport (devicePixelRatio never appears)', () => {
  it('scales through getBoundingClientRect, not canvas.width', () => {
    const vp = makeViewport(W, H, 0); // 600 × 800 viewport units
    // The canvas is CSS-scaled to half size and offset on the page. At dpr 2 the
    // backing store would be 1200 × 1600 — a number this maths never touches.
    const box: ScreenBox = { left: 10, top: 20, width: 300, height: 400 };
    nearPoint(clientToViewport({ x: 160, y: 220 }, box, vp), 300, 400);
    nearPoint(viewportToClient({ x: 300, y: 400 }, box, vp), 160, 220);
  });

  it('refuses a zero-size box instead of dividing by zero', () => {
    const vp = makeViewport(W, H, 0);
    expect(() =>
      clientToViewport({ x: 0, y: 0 }, { left: 0, top: 0, width: 0, height: 400 }, vp),
    ).toThrow(/zero size/);
    expect(() =>
      viewportToClient({ x: 0, y: 0 }, boxFor(vp), { ...vp, width: 0 }),
    ).toThrow(/zero size/);
  });
});

describe('screenPointToPdf', () => {
  it('maps the canvas corners correctly at /Rotate 0', () => {
    const vp = makeViewport(W, H, 0);
    const box = boxFor(vp);
    nearPoint(screenPointToPdf({ x: 0, y: 0 }, box, vp), 0, 800); // top-left → PDF top-left
    nearPoint(screenPointToPdf({ x: 0, y: 800 }, box, vp), 0, 0); // bottom-left → PDF origin
    nearPoint(screenPointToPdf({ x: 600, y: 800 }, box, vp), 600, 0);
  });

  it('THE BUG: at /Rotate 90 canvas X is PDF Y — `height - clickY` is wrong', () => {
    const vp = makeViewport(W, H, 90); // viewport 800 × 600, transform is a reflection
    const box = boxFor(vp);
    const click = { x: 100, y: 50 };

    const pdf = screenPointToPdf(click, box, vp);
    nearPoint(pdf, 50, 100); // canvas x → pdf y, canvas y → pdf x

    // What a naive implementation would have produced, spelled out so the
    // regression is unmistakable if someone "simplifies" this module.
    const naive = { x: click.x, y: vp.height - click.y };
    expect(naive).toEqual({ x: 100, y: 550 });
    expect(pdf).not.toEqual(naive);
  });

  it('maps the canvas top-left to the PDF origin at /Rotate 90', () => {
    const vp = makeViewport(W, H, 90);
    nearPoint(screenPointToPdf({ x: 0, y: 0 }, boxFor(vp), vp), 0, 0);
  });

  it('round-trips through pdfPointToScreen at every rotation', () => {
    for (const rot of [0, 90, 180, 270]) {
      const vp = makeViewport(W, H, rot, 1.5);
      const box = boxFor(vp, 7, 13);
      const client = { x: 7 + 111, y: 13 + 222 };
      const back = pdfPointToScreen(screenPointToPdf(client, box, vp), box, vp);
      nearPoint(back, client.x, client.y);
    }
  });

  it('stays correct when the canvas is CSS-scaled and offset', () => {
    const vp = makeViewport(W, H, 0);
    const box: ScreenBox = { left: 40, top: 80, width: 150, height: 200 }; // quarter size
    // Bottom-left corner of the drawn page.
    nearPoint(screenPointToPdf({ x: 40, y: 280 }, box, vp), 0, 0);
    // Dead centre.
    nearPoint(screenPointToPdf({ x: 115, y: 180 }, box, vp), 300, 400);
  });
});

describe('screenRectToPdfRect — both corners, then min/max', () => {
  it('converts a drag at /Rotate 0', () => {
    const vp = makeViewport(W, H, 0);
    const box = boxFor(vp);
    const rect = screenRectToPdfRect({ x: 100, y: 100 }, { x: 300, y: 200 }, box, vp);
    expect(rect).toEqual({ x: 100, y: 600, width: 200, height: 100 });
  });

  it('SWAPS width and height at /Rotate 90 — the naive version does not', () => {
    const vp = makeViewport(W, H, 90);
    const box = boxFor(vp);
    // A drag 200 wide and 100 tall on screen.
    const rect = screenRectToPdfRect({ x: 100, y: 50 }, { x: 300, y: 150 }, box, vp);
    expect(rect).toEqual({ x: 50, y: 100, width: 100, height: 200 });
  });

  it('gives the same rect whichever pair of opposite corners is dragged', () => {
    const vp = makeViewport(W, H, 270);
    const box = boxFor(vp);
    const a = screenRectToPdfRect({ x: 100, y: 50 }, { x: 300, y: 150 }, box, vp);
    const b = screenRectToPdfRect({ x: 300, y: 150 }, { x: 100, y: 50 }, box, vp);
    const c = screenRectToPdfRect({ x: 300, y: 50 }, { x: 100, y: 150 }, box, vp);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it('never produces a negative width or height, however the drag went', () => {
    for (const rot of [0, 90, 180, 270]) {
      const vp = makeViewport(W, H, rot);
      const box = boxFor(vp);
      const rect = screenRectToPdfRect({ x: 400, y: 300 }, { x: 120, y: 90 }, box, vp);
      expect(rect.width).toBeGreaterThan(0);
      expect(rect.height).toBeGreaterThan(0);
    }
  });

  it('screenBoxToPdfRect matches the two-corner form', () => {
    const vp = makeViewport(W, H, 90);
    const box = boxFor(vp);
    expect(screenBoxToPdfRect({ x: 100, y: 50, width: 200, height: 100 }, box, vp)).toEqual(
      screenRectToPdfRect({ x: 100, y: 50 }, { x: 300, y: 150 }, box, vp),
    );
  });

  it('rectFromCorners normalises any corner order', () => {
    expect(rectFromCorners({ x: 10, y: 20 }, { x: 4, y: 50 })).toEqual({
      x: 4,
      y: 20,
      width: 6,
      height: 30,
    });
  });
});

describe('pdfRectToScreenRect — the inverse, for re-rendering', () => {
  it('round-trips a rect at every rotation and scale', () => {
    const source = { x: 120, y: 240, width: 90, height: 45 };
    for (const rot of [0, 90, 180, 270]) {
      const vp = makeViewport(W, H, rot, 1.25);
      const box = boxFor(vp, 5, 9);
      const screen = pdfRectToScreenRect(source, box, vp);
      const back = screenBoxToPdfRect(screen, box, vp);
      near(back.x, source.x, 6);
      near(back.y, source.y, 6);
      near(back.width, source.width, 6);
      near(back.height, source.height, 6);
    }
  });

  it('places a rect at the expected screen position at /Rotate 0', () => {
    const vp = makeViewport(W, H, 0);
    const box = boxFor(vp);
    expect(pdfRectToScreenRect({ x: 100, y: 600, width: 200, height: 100 }, box, vp)).toEqual({
      x: 100,
      y: 100,
      width: 200,
      height: 100,
    });
  });

  it('swaps the on-screen dimensions at /Rotate 90', () => {
    const vp = makeViewport(W, H, 90);
    const box = boxFor(vp);
    const screen = pdfRectToScreenRect({ x: 50, y: 100, width: 100, height: 200 }, box, vp);
    expect(screen).toEqual({ x: 100, y: 50, width: 200, height: 100 });
  });

  it('toLocalRect subtracts the canvas offset for CSS positioning', () => {
    expect(toLocalRect({ x: 110, y: 220, width: 10, height: 20 }, { left: 100, top: 200, width: 1, height: 1 })).toEqual({
      x: 10,
      y: 20,
      width: 10,
      height: 20,
    });
  });
});

describe('rotatedDrawAnchor — pdf-lib rotates about the x,y anchor', () => {
  const rect = { x: 100, y: 200, width: 60, height: 30 };

  it('0° passes the rectangle straight through', () => {
    expect(rotatedDrawAnchor(rect, 0)).toEqual({
      x: 100,
      y: 200,
      width: 60,
      height: 30,
      angleDeg: 0,
    });
  });

  it('90° anchors at x + width and swaps width/height', () => {
    expect(rotatedDrawAnchor(rect, 90)).toEqual({
      x: 160,
      y: 200,
      width: 30,
      height: 60,
      angleDeg: 90,
    });
  });

  it('180° anchors at the opposite corner and keeps width/height', () => {
    expect(rotatedDrawAnchor(rect, 180)).toEqual({
      x: 160,
      y: 230,
      width: 60,
      height: 30,
      angleDeg: 180,
    });
  });

  it('270° anchors at y + height and swaps width/height', () => {
    expect(rotatedDrawAnchor(rect, 270)).toEqual({
      x: 100,
      y: 230,
      width: 30,
      height: 60,
      angleDeg: 270,
    });
  });

  it('the anchor really does put the drawn box back inside the rect', () => {
    // Re-implement pdf-lib's rotate-about-the-anchor and check the four
    // corners of the drawn box span exactly the requested rectangle.
    for (const angle of [0, 90, 180, 270]) {
      const a = rotatedDrawAnchor(rect, angle);
      const rad = (angle * Math.PI) / 180;
      const cos = Math.round(Math.cos(rad));
      const sin = Math.round(Math.sin(rad));
      const corners = [
        [0, 0],
        [a.width, 0],
        [0, a.height],
        [a.width, a.height],
      ].map(([u, v]) => ({
        x: a.x + u * cos - v * sin,
        y: a.y + u * sin + v * cos,
      }));
      const xs = corners.map((c) => c.x);
      const ys = corners.map((c) => c.y);
      expect(Math.min(...xs)).toBe(rect.x);
      expect(Math.max(...xs)).toBe(rect.x + rect.width);
      expect(Math.min(...ys)).toBe(rect.y);
      expect(Math.max(...ys)).toBe(rect.y + rect.height);
    }
  });

  it('normalises an unusual angle before choosing the anchor', () => {
    expect(rotatedDrawAnchor(rect, -90)).toEqual(rotatedDrawAnchor(rect, 270));
    expect(rotatedDrawAnchor(rect, 450)).toEqual(rotatedDrawAnchor(rect, 90));
  });

  it('normalizeQuarterTurn snaps to 0/90/180/270', () => {
    expect(normalizeQuarterTurn(0)).toBe(0);
    expect(normalizeQuarterTurn(89)).toBe(90);
    expect(normalizeQuarterTurn(-270)).toBe(90);
    expect(normalizeQuarterTurn(360)).toBe(0);
    expect(normalizeQuarterTurn(720 + 180)).toBe(180);
  });
});

describe('textMatrixToSizeAndAngle', () => {
  it('reads the size out of the proven round-trip matrix [20,0,0,20,50,700]', () => {
    const m: Matrix6 = [20, 0, 0, 20, 50, 700];
    expect(textMatrixToSizeAndAngle(m)).toEqual({ sizePt: 20, angleDeg: 0 });
    // transform[4],[5] ARE the x,y handed to drawText — that is what makes
    // click-to-snap over an existing line exact.
    expect(textMatrixOrigin(m)).toEqual({ x: 50, y: 700 });
  });

  it('reads a 90° rotated line', () => {
    const r = textMatrixToSizeAndAngle([0, 12, -12, 0, 5, 6]);
    near(r.sizePt, 12);
    near(r.angleDeg, 90);
  });

  it('reads a 45° line, where size is the hypotenuse not `a`', () => {
    const r = textMatrixToSizeAndAngle([10, 10, -10, 10, 0, 0]);
    near(r.sizePt, Math.hypot(10, 10));
    near(r.angleDeg, 45);
  });

  it('reports a mirrored/upside-down line as a negative angle', () => {
    const r = textMatrixToSizeAndAngle([-8, 0, 0, -8, 0, 0]);
    near(r.sizePt, 8);
    expect(Math.abs(r.angleDeg)).toBeCloseTo(180, 9);
  });

  it('never returns -0 for a horizontal line', () => {
    expect(Object.is(textMatrixToSizeAndAngle([10, -0, 0, 10, 0, 0]).angleDeg, -0)).toBe(false);
  });
});

describe('inspectPageGeometry — the two setups that break the arithmetic', () => {
  it('is ok for an ordinary page', () => {
    const r = inspectPageGeometry({ userUnit: 1, cropBox: [0, 0, 595, 842] });
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
    expect(r.originOffset).toEqual({ x: 0, y: 0 });
    expect(r.userUnit).toBe(1);
  });

  it('treats a missing UserUnit and a missing box as the defaults', () => {
    const r = inspectPageGeometry({});
    expect(r.ok).toBe(true);
    expect(r.userUnit).toBe(1);
    expect(r.originOffset).toEqual({ x: 0, y: 0 });
  });

  it('flags a UserUnit other than 1, in Thai', () => {
    const r = inspectPageGeometry({ userUnit: 2.5 });
    expect(r.ok).toBe(false);
    expect(r.issues.map((i) => i.code)).toEqual(['user-unit']);
    expect(r.issues[0].messageTh).toContain('2.5');
    expect(r.issues[0].messageTh).toMatch(/[ก-๙]/);
  });

  it('flags a CropBox whose origin is not (0,0) and reports the offset', () => {
    const r = inspectPageGeometry({ cropBox: [20, 30, 620, 830] });
    expect(r.ok).toBe(false);
    expect(r.issues.map((i) => i.code)).toEqual(['crop-origin']);
    expect(r.originOffset).toEqual({ x: 20, y: 30 });
    expect(r.issues[0].messageTh).toMatch(/[ก-๙]/);
  });

  it('falls back to the MediaBox when there is no CropBox', () => {
    expect(inspectPageGeometry({ mediaBox: [5, 5, 600, 800] }).originOffset).toEqual({
      x: 5,
      y: 5,
    });
  });

  it('reports both issues at once', () => {
    const r = inspectPageGeometry({ userUnit: 3, cropBox: [1, 2, 3, 4] });
    expect(r.issues.map((i) => i.code)).toEqual(['user-unit', 'crop-origin']);
  });

  it('ignores a nonsensical UserUnit of 0', () => {
    expect(inspectPageGeometry({ userUnit: 0 }).userUnit).toBe(1);
  });

  it('converts between CropBox-relative and user space', () => {
    const r = inspectPageGeometry({ cropBox: [20, 30, 620, 830] });
    expect(cropRelativeToUserSpace({ x: 0, y: 0 }, r)).toEqual({ x: 20, y: 30 });
    expect(userSpaceToCropRelative({ x: 20, y: 30 }, r)).toEqual({ x: 0, y: 0 });
  });
});
