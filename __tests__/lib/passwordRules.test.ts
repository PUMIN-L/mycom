// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { MAX_PASSWORD_BYTES, MIN_PASSWORD_LENGTH, newPasswordProblem } from '@/app/lib/passwordRules';

describe('newPasswordProblem', () => {
  it('accepts a long enough password', () => {
    expect(newPasswordProblem('correct-horse-battery', 'admin')).toBeNull();
    expect(newPasswordProblem('x'.repeat(MAX_PASSWORD_BYTES), 'admin')).toBeNull();
  });

  it.each([undefined, null, 12345678901234, '', ['a-long-password-x']])('wants a string: %p', (value) => {
    expect(newPasswordProblem(value, 'admin')).toBe('กรุณากรอกรหัสผ่านใหม่');
  });

  it(`counts characters, not UTF-16 units: ${MIN_PASSWORD_LENGTH - 1} emoji are too few`, () => {
    expect(newPasswordProblem('😀'.repeat(MIN_PASSWORD_LENGTH - 1), 'admin')).toContain('อย่างน้อย');
    expect(newPasswordProblem('😀'.repeat(MIN_PASSWORD_LENGTH), 'admin')).toBeNull();
  });

  // bcrypt reads 72 bytes and drops the rest without a word.
  it('refuses more than bcrypt reads — 24 Thai characters fit, 25 do not', () => {
    expect(newPasswordProblem('ก'.repeat(24), 'admin')).toBeNull();
    expect(newPasswordProblem('ก'.repeat(25), 'admin')).toContain('ยาวเกินไป');
    expect(newPasswordProblem('x'.repeat(MAX_PASSWORD_BYTES + 1), 'admin')).toContain('ยาวเกินไป');
  });

  it('refuses leading or trailing spaces (a paste that brought a space along)', () => {
    expect(newPasswordProblem(' correct-horse-battery', 'admin')).toContain('ช่องว่าง');
    expect(newPasswordProblem('correct-horse-battery\n', 'admin')).toContain('ช่องว่าง');
  });

  it('refuses the username itself, case aside', () => {
    expect(newPasswordProblem('Administrator-01', 'administrator-01')).toBe('รหัสผ่านใหม่ต้องไม่เหมือนชื่อผู้ใช้');
  });
});
