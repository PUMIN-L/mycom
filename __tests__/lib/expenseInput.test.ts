// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { expenseTextError } from '@/app/lib/expenseInput';

describe('expenseTextError', () => {
  it('creating: the title is required and must be text', () => {
    expect(expenseTextError({ title: 'ค่าไฟ' }, true)).toBeNull();
    expect(expenseTextError({}, true)).toBe('กรุณาระบุชื่อรายการ');
    expect(expenseTextError({ title: '  ' }, true)).toBe('กรุณาระบุชื่อรายการ');
    expect(expenseTextError({ title: 1 }, true)).toBe('กรุณาระบุชื่อรายการ');
  });

  it('editing: the title may be left out, never blanked', () => {
    expect(expenseTextError({ note: 'x' }, false)).toBeNull();
    expect(expenseTextError({ title: '' }, false)).toBe('กรุณาระบุชื่อรายการ');
  });

  it('category and note: text, or absent / null', () => {
    expect(expenseTextError({ title: 't', category: 'c', note: null }, true)).toBeNull();
    expect(expenseTextError({ title: 't', category: 3 }, true)).toBe('ข้อมูลไม่ถูกต้อง');
    expect(expenseTextError({ title: 't', note: ['x'] }, false)).toBe('ข้อมูลไม่ถูกต้อง');
  });

  it('a body that is not an object', () => {
    for (const body of [null, undefined, 'x', 5, []]) {
      expect(expenseTextError(body, false)).toBe('ข้อมูลไม่ถูกต้อง');
    }
  });
});
