// @vitest-environment node
/**
 * parsePositiveMoney — a money amount from a request body, checked as the
 * DECIMAL(12,2) column will hold it: rounded to the satang first.
 */
import { describe, it, expect } from 'vitest';
import { parsePositiveMoney, toSatang, MAX_MONEY_AMOUNT } from '@/app/lib/moneyAmount';

describe('toSatang', () => {
  it.each([
    [1.005, 1.01],
    [1.015, 1.02],
    [2.675, 2.68],
    [12.344, 12.34],
    [0.004, 0],
    [0.005, 0.01],
    [1234567.895, 1234567.9],
    [9_999_999_999.99, 9_999_999_999.99],
    [9_999_999_999.994, 9_999_999_999.99],
    [9_999_999_999.995, 10_000_000_000],
  ])('%p → %p', (n, satang) => {
    expect(toSatang(n)).toBe(satang);
  });
});

describe('parsePositiveMoney', () => {
  it.each([
    [1500, 1500],
    ['1500', 1500],
    [' 99.5 ', 99.5],
    [0.01, 0.01],
    [0.005, 0.01],
    [1.005, 1.01], // 1.005 * 100 is 100.49999… in floating point
    [12.344, 12.34],
    [MAX_MONEY_AMOUNT, MAX_MONEY_AMOUNT],
  ])('%p → %p', (input, amount) => {
    expect(parsePositiveMoney(input)).toEqual({ ok: true, amount });
  });

  // The bug: these were "more than 0", and the database stored ฿0.00.
  it.each([0.004, 0.0049, '0.001'])('%p rounds to ฿0.00 and is refused', (input) => {
    expect(parsePositiveMoney(input)).toEqual({ ok: false, error: 'จำนวนเงินต้องอย่างน้อย 0.01 บาท' });
  });

  it.each([0, -1, -0.01, NaN, Infinity, -Infinity, '', '   ', 'abc', '1,000', null, undefined, true, false, {}, [5]])(
    '%p is not a positive amount',
    (input) => {
      expect(parsePositiveMoney(input)).toEqual({ ok: false, error: 'จำนวนเงินต้องมากกว่า 0' });
    }
  );

  it('refuses more than a DECIMAL(12,2) holds, instead of a database error or a silent clamp', () => {
    expect(parsePositiveMoney(10_000_000_000)).toEqual({
      ok: false,
      error: 'จำนวนเงินสูงเกินไป (สูงสุด 9,999,999,999.99 บาท)',
    });
    expect(parsePositiveMoney(9_999_999_999.996).ok).toBe(false); // rounds up past the ceiling
  });
});
