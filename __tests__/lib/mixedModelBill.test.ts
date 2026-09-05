// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { isMixedModelBill, type LoadedEquipment } from '@/app/dashboard/types';

/**
 * `isMixedModelBill` is the FORM's copy of the rule `runEquipmentSync` applies
 * server-side (`saleIsMixedModel`, built from `productGroupKey`). If the two
 * ever disagree the warning shows on the wrong bills — either promising an edit
 * that the server will silently drop, or scaring the admin off one that works.
 * These cases mirror the crmStore ones one for one.
 */
const eq = (productId: string, i = 0): LoadedEquipment => ({
  id: `eq-${i}`,
  serialNumber: '',
  productId,
  productName: '',
});

describe('isMixedModelBill', () => {
  it('is false for an empty list (creating, or machines that could not be read)', () => {
    expect(isMixedModelBill([])).toBe(false);
  });

  it('is false for one machine', () => {
    expect(isMixedModelBill([eq('P1')])).toBe(false);
  });

  it('is false when every machine is the same model', () => {
    expect(isMixedModelBill([eq('P1', 1), eq('P1', 2), eq('P1', 3)])).toBe(false);
  });

  it('is TRUE when two models share the bill', () => {
    expect(isMixedModelBill([eq('P1', 1), eq('P2', 2)])).toBe(true);
  });

  it('treats "_custom" and "no product" as ONE group, exactly like productGroupKey', () => {
    expect(isMixedModelBill([eq('_custom', 1), eq('', 2)])).toBe(false);
    expect(isMixedModelBill([eq('_custom', 1), eq('  ', 2)])).toBe(false);
  });

  it('is TRUE when a catalog machine sits beside a custom one', () => {
    expect(isMixedModelBill([eq('P1', 1), eq('_custom', 2)])).toBe(true);
  });

  it('ignores surrounding whitespace rather than reading it as another model', () => {
    expect(isMixedModelBill([eq('P1', 1), eq(' P1 ', 2)])).toBe(false);
  });
});
