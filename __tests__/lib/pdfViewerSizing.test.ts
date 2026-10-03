// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  PDF_ZOOM_MAX,
  PDF_ZOOM_MIN,
  pdfDevicePixelRatio,
  pdfGutter,
  pdfPageWidth,
} from '@/app/lib/pdfViewerSizing';

describe('pdfPageWidth', () => {
  it('fills a phone screen at 100% — 360px less 8px either side', () => {
    expect(pdfPageWidth(360, 1)).toBe(344);
  });

  it('stops at 900px on a wide screen (about what scale 1.5 drew there)', () => {
    expect(pdfPageWidth(1920, 1)).toBe(900);
  });

  it('zooms from the fitted width, inside the zoom range', () => {
    expect(pdfPageWidth(360, 2)).toBe(688);
    expect(pdfPageWidth(360, 99)).toBe(Math.round(344 * PDF_ZOOM_MAX));
    expect(pdfPageWidth(360, 0.01)).toBe(Math.round(344 * PDF_ZOOM_MIN));
  });

  it('is null until the viewer has been measured — nothing is drawn at a guessed size', () => {
    expect(pdfPageWidth(0, 1)).toBeNull();
    expect(pdfPageWidth(NaN, 1)).toBeNull();
  });

  it('keeps less space either side on a phone than on a desktop', () => {
    expect(pdfGutter(360)).toBe(8);
    expect(pdfGutter(1024)).toBe(16);
  });
});

describe('pdfDevicePixelRatio', () => {
  const A4 = 297 / 210;

  it('uses the screen ratio, but no more than 2 — a 3× phone draws at 2×', () => {
    expect(pdfDevicePixelRatio(344, A4, 3)).toBe(2);
    expect(pdfDevicePixelRatio(344, A4, 2)).toBe(2);
    expect(pdfDevicePixelRatio(344, A4, 1)).toBe(1);
  });

  // iOS Safari draws a blank page for a canvas over ~16.7M pixels.
  it('lowers it when zoomed far, so one canvas stays under iOS Safari’s limit', () => {
    const width = 900 * PDF_ZOOM_MAX;
    const ratio = pdfDevicePixelRatio(width, A4, 2);
    expect(ratio).toBeLessThan(2);
    expect((width * ratio) * (width * A4 * ratio)).toBeLessThanOrEqual(12_000_000 + 1);
  });

  it('treats a missing or odd screen ratio as 1', () => {
    expect(pdfDevicePixelRatio(344, A4, 0)).toBe(1);
    expect(pdfDevicePixelRatio(344, A4, NaN)).toBe(1);
  });
});
