// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { hasSessionHint, SESSION_HINT_COOKIE, sessionHintCookieOptions } from '@/app/lib/sessionHint';

describe('sessionHint', () => {
  it('finds the hint anywhere in document.cookie', () => {
    expect(hasSessionHint('has_session=1')).toBe(true);
    expect(hasSessionHint('lang=th; has_session=1; x=y')).toBe(true);
  });

  it('is not fooled by a cookie whose name only starts the same', () => {
    expect(hasSessionHint('has_session_old=1')).toBe(false);
    expect(hasSessionHint('xhas_session=1')).toBe(false);
    expect(hasSessionHint('')).toBe(false);
  });

  it('is readable by script — the one thing it is for', () => {
    expect(SESSION_HINT_COOKIE).toBe('has_session');
    expect(sessionHintCookieOptions(new Date(0))).toMatchObject({ httpOnly: false, path: '/', sameSite: 'lax' });
  });
});
