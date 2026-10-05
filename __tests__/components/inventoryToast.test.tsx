/** useToast (components/inventory/inventoryUi.tsx): a new toast replaces the
 *  old one and gets its full time — the old timer does not cut it short. */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useToast } from '@/app/components/inventory/inventoryUi';

afterEach(() => vi.useRealTimers());

describe('useToast', () => {
  it('a second toast stays its full time', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useToast(3500));
    act(() => result.current[1]('แรก'));
    act(() => vi.advanceTimersByTime(3000));
    act(() => result.current[1]('สอง', 'error'));
    act(() => vi.advanceTimersByTime(1000)); // the first one's 3.5 s are up
    expect(result.current[0]).toEqual({ message: 'สอง', type: 'error' });
    act(() => vi.advanceTimersByTime(2600));
    expect(result.current[0]).toBeNull();
  });
});
