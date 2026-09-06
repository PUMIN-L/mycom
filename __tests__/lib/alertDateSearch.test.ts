// @vitest-environment node
import { describe, it, expect } from 'vitest';

import {
  BULK_RESCHEDULE_MAX_ITEMS,
  BULK_RESCHEDULE_MAX_SHIFT_DAYS,
  DATE_SEARCH_MAX_RANGE_DAYS,
  DATE_SEARCH_ROW_CAP,
  IMMOVABLE_REASONS,
  computeTargetDate,
  evaluateMovability,
  immovableReasonFor,
  isRowMovable,
  selectAllPlan,
  selectableRows,
  summariseShift,
  validateItemCount,
  validateSearchRange,
  validateShiftDays,
} from '@/app/lib/alertDateSearch';
import type { DatedAlertKind, DatedAlertRow } from '@/app/lib/alertDateSearch';

// Every date this feature writes has to match this exactly. The columns are
// VARCHAR compared LEXICALLY, so an unpadded "2026-9-4" sorts before
// "2026-10-05" and quietly poisons every range query that reads the column —
// which is why this is asserted on EVERY computed result below, not just the
// one scenario that is about padding.
const YMD = /^\d{4}-\d{2}-\d{2}$/;

function shift(date: string, days: number): string | null {
  const result = computeTargetDate('shift', { matchedDate: date }, { shiftDays: days });
  if (result !== null) expect(result).toMatch(YMD);
  return result;
}

function row(over: Partial<DatedAlertRow> & { kind: DatedAlertKind }): DatedAlertRow {
  return {
    id: 'x',
    matchedDate: '2026-06-12',
    title: '',
    subtitle: '',
    customerName: '',
    companyName: '',
    status: 'pending',
    overdue: false,
    snoozedUntil: null,
    movable: true,
    immovableReason: null,
    immovableCode: null,
    ...over,
  } as DatedAlertRow;
}

// ── computeTargetDate: the arithmetic, pinned ────────────────────────────────

describe('computeTargetDate — shift arithmetic', () => {
  it('crosses a month end (2026-01-31 +7)', () => {
    expect(shift('2026-01-31', 7)).toBe('2026-02-07');
  });

  it('crosses a year end (2026-12-28 +7)', () => {
    expect(shift('2026-12-28', 7)).toBe('2027-01-04');
  });

  it('treats a leap February differently from a common one', () => {
    // The same +7 from the same day-of-month lands a day apart, because 2028
    // has a 29th and 2027 does not. Getting these two to agree would mean the
    // arithmetic is wrong.
    expect(shift('2028-02-25', 7)).toBe('2028-03-03');
    expect(shift('2027-02-25', 7)).toBe('2027-03-04');
  });

  it('lands exactly on 29 February in a leap year', () => {
    expect(shift('2028-02-22', 7)).toBe('2028-02-29');
  });

  it('zero-pads the result (2026-08-28 +7 is "2026-09-04", never "2026-9-4")', () => {
    const result = shift('2026-08-28', 7);
    expect(result).toBe('2026-09-04');
    // Spelled out because this is the assertion the whole column depends on.
    expect(result).not.toBe('2026-9-4');
  });

  it('goes backwards across a month start and a year start', () => {
    expect(shift('2026-03-03', -7)).toBe('2026-02-24');
    expect(shift('2027-01-03', -7)).toBe('2026-12-27');
    expect(shift('2028-03-07', -7)).toBe('2028-02-29');
  });

  it('shifts into the past without complaint — that is deliberate (D5)', () => {
    // An admin catching up on a backlog has every reason to pull work forward.
    // Refusing here would be an accident of validation, not a rule; the confirm
    // dialog names how many land before today instead.
    expect(shift('2026-06-12', -400)).toBe('2025-05-08');
  });

  it('handles the largest permitted shift in both directions', () => {
    expect(shift('2026-06-12', BULK_RESCHEDULE_MAX_SHIFT_DAYS)).toBe('2036-06-09');
    expect(shift('2026-06-12', -BULK_RESCHEDULE_MAX_SHIFT_DAYS)).toBe('2016-06-14');
  });

  it('refuses a shift of 0 or one past the cap', () => {
    expect(shift('2026-06-12', 0)).toBeNull();
    expect(shift('2026-06-12', BULK_RESCHEDULE_MAX_SHIFT_DAYS + 1)).toBeNull();
    expect(shift('2026-06-12', -(BULK_RESCHEDULE_MAX_SHIFT_DAYS + 1))).toBeNull();
    expect(shift('2026-06-12', 1.5)).toBeNull();
  });

  it('returns null rather than a malformed string when the source date is bad', () => {
    // The caller turns null into `invalid_result`. Nothing malformed may ever
    // be handed to someone who will write it into one of these columns.
    expect(shift('2026-6-12', 7)).toBeNull();
    expect(shift('', 7)).toBeNull();
    expect(shift('not-a-date', 7)).toBeNull();
    expect(shift('2026-13-01', 7)).toBeNull();
  });
});

describe('computeTargetDate — set mode', () => {
  it('returns the chosen date regardless of the row it is applied to', () => {
    const result = computeTargetDate(
      'set',
      { matchedDate: '2026-01-31' },
      { targetDate: '2026-06-12' }
    );
    expect(result).toBe('2026-06-12');
    expect(result).toMatch(YMD);
  });

  it('rejects a malformed target date', () => {
    expect(computeTargetDate('set', { matchedDate: '2026-01-31' }, { targetDate: '12-06-2026' })).toBeNull();
    expect(computeTargetDate('set', { matchedDate: '2026-01-31' }, { targetDate: '2026-6-12' })).toBeNull();
    expect(computeTargetDate('set', { matchedDate: '2026-01-31' }, { targetDate: '' })).toBeNull();
  });

  it('does not need a valid source date to set an absolute one', () => {
    // A task with no due date is refused earlier, by `no_date` — but "set"
    // itself does not depend on where the row currently sits.
    expect(computeTargetDate('set', { matchedDate: null }, { targetDate: '2026-06-12' })).toBe(
      '2026-06-12'
    );
  });
});

// ── The one rule ─────────────────────────────────────────────────────────────

describe('evaluateMovability — the single rule the UI and the API share', () => {
  it('allows a pending equipment schedule and a pending customer call', () => {
    expect(evaluateMovability({ kind: 'schedule', status: 'pending', matchedDate: '2026-06-12' }))
      .toEqual({ movable: true, code: null, reason: null });
    expect(evaluateMovability({ kind: 'customer_call', status: 'pending', matchedDate: '2026-06-12' }).movable)
      .toBe(true);
  });

  it('allows a pending task that has a due date', () => {
    expect(isRowMovable({ kind: 'task', status: 'pending', matchedDate: '2026-06-12' })).toBe(true);
  });

  // The six refusals the spec enumerates, each with its own reason and its own
  // way out.
  const immovable: Array<[string, Parameters<typeof evaluateMovability>[0], string]> = [
    ['warranty is a fact about the machine', { kind: 'warranty', status: 'Active' }, 'immovable_fact'],
    ['calibration due date is derived from the last calibration', { kind: 'calibration', status: 'Active' }, 'immovable_fact'],
    ['a receivable due date is a credit term', { kind: 'receivable', status: 'unpaid' }, 'immovable_fact'],
    ['a completed appointment is evidence of a visit', { kind: 'schedule', status: 'completed', matchedDate: '2026-06-12' }, 'closed'],
    ['a cancelled appointment stays cancelled', { kind: 'customer_call', status: 'cancelled', matchedDate: '2026-06-12' }, 'closed'],
    ['a done task must be reopened first', { kind: 'task', status: 'done', matchedDate: '2026-06-12' }, 'closed'],
  ];

  it.each(immovable)('refuses: %s', (_label, input, code) => {
    const verdict = evaluateMovability(input);
    expect(verdict.movable).toBe(false);
    expect(verdict.code).toBe(code);
    expect(verdict.reason).toBeTruthy();
  });

  it('refuses a warranty row even when its status looks open', () => {
    // Kind is checked BEFORE status on purpose: a "pending" fact is still a
    // fact, and no status may talk a warranty date into being movable.
    expect(evaluateMovability({ kind: 'warranty', status: 'pending' }).code).toBe('immovable_fact');
    expect(evaluateMovability({ kind: 'calibration', status: 'pending' }).code).toBe('immovable_fact');
    expect(evaluateMovability({ kind: 'receivable', status: 'pending' }).code).toBe('immovable_fact');
  });

  it('refuses a task with no due date as no_date, not as closed', () => {
    // Different problem, different way out: this one needs a due date set, not
    // a reopen.
    expect(evaluateMovability({ kind: 'task', status: 'pending', matchedDate: null }).code).toBe('no_date');
    expect(evaluateMovability({ kind: 'task', status: 'pending', matchedDate: '' }).code).toBe('no_date');
    expect(evaluateMovability({ kind: 'task', status: 'pending', matchedDate: '   ' }).code).toBe('no_date');
  });

  it('refuses an unknown kind per item rather than throwing', () => {
    // One fabricated value in a hand-built request must not take the valid
    // items down with it, and must not surface as a 500.
    const verdict = evaluateMovability({ kind: 'not_a_real_kind', status: 'pending' });
    expect(verdict.movable).toBe(false);
    expect(verdict.code).toBe('immovable_fact');
    expect(verdict.reason).toBe(IMMOVABLE_REASONS.unknown);
  });

  it('refuses an unrecognised status rather than treating it as open', () => {
    expect(evaluateMovability({ kind: 'schedule', status: 'weird', matchedDate: '2026-06-12' }).movable).toBe(false);
    expect(evaluateMovability({ kind: 'task', status: '', matchedDate: '2026-06-12' }).movable).toBe(false);
  });

  it('every refusal is Thai, offers a way out, and names no database column', () => {
    for (const [label, reason] of Object.entries(IMMOVABLE_REASONS)) {
      // Thai script present.
      expect(reason, label).toMatch(/[฀-๿]/);
      // The reason a user reads must not require knowing the schema.
      expect(reason, label).not.toMatch(
        /warrantyEndDate|dueDate|scheduledDate|calibrationDate|customer_equipments|billing_documents|crm_tasks|service_schedules/
      );
      // A bare "ไม่สามารถแก้ไขได้" tells an admin nothing except that the
      // software is in his way, so every reason must be a real sentence.
      expect(reason.length, label).toBeGreaterThan(40);
    }
    // And each one points somewhere specific.
    expect(IMMOVABLE_REASONS.warranty).toContain('ข้อมูลเครื่อง');
    expect(IMMOVABLE_REASONS.calibration).toContain('บันทึกวันสอบเทียบ');
    expect(IMMOVABLE_REASONS.receivable).toContain('/billing/receivables');
    expect(IMMOVABLE_REASONS.completed).toContain('สร้างนัดใหม่');
    expect(IMMOVABLE_REASONS.cancelled).toContain('สร้างนัดใหม่');
    expect(IMMOVABLE_REASONS.done).toContain('เปิดใหม่');
    expect(IMMOVABLE_REASONS.noDate).toContain('กำหนดวันครบกำหนด');
  });

  it('immovableReasonFor returns null exactly when the row is movable', () => {
    expect(immovableReasonFor({ kind: 'schedule', status: 'pending', matchedDate: '2026-06-12' })).toBeNull();
    expect(immovableReasonFor({ kind: 'warranty', status: 'Active' })).toBe(IMMOVABLE_REASONS.warranty);
  });

  it('a snoozed row is still movable — snooze is not deletion (D9)', () => {
    // `snoozedUntil` is not an input to the rule at all: "don't nag me until
    // then" says nothing about whether the appointment can be rescheduled.
    const snoozed = row({ kind: 'schedule', status: 'pending', snoozedUntil: '2026-06-20T00:00:00.000Z' });
    expect(isRowMovable(snoozed)).toBe(true);
  });
});

// ── Selection ────────────────────────────────────────────────────────────────

describe('selectableRows / selectAllPlan', () => {
  // 27 rows: 8 pending equipment schedules, 4 pending tasks, and 15 that
  // cannot move — the exact mix the spec scenario describes.
  const mixed: DatedAlertRow[] = [
    ...Array.from({ length: 8 }, (_, i) =>
      row({ kind: 'schedule', id: `s${i}`, status: 'pending' })
    ),
    ...Array.from({ length: 4 }, (_, i) =>
      row({ kind: 'task', id: `t${i}`, status: 'pending' })
    ),
    ...Array.from({ length: 5 }, (_, i) => row({ kind: 'warranty', id: `w${i}`, status: 'Active' })),
    ...Array.from({ length: 4 }, (_, i) => row({ kind: 'calibration', id: `c${i}`, status: 'Active' })),
    ...Array.from({ length: 3 }, (_, i) => row({ kind: 'receivable', id: `r${i}`, status: 'unpaid' })),
    ...Array.from({ length: 3 }, (_, i) =>
      row({ kind: 'schedule', id: `sc${i}`, status: 'completed' })
    ),
  ];

  it('ticks 12 of 27 and ticks nothing that would later be refused', () => {
    const plan = selectAllPlan(mixed);
    expect(plan.scopeCount).toBe(27);
    expect(plan.eligibleCount).toBe(12);
    expect(plan.selectedCount).toBe(12);
    expect(plan.cappedOut).toBe(0);
    // Ticking rows destined for refusal is how you teach an admin to stop
    // reading warnings.
    const chosen = new Set(plan.ids);
    for (const r of mixed) {
      if (chosen.has(r.id)) expect(isRowMovable(r)).toBe(true);
    }
  });

  it('scopes to the active category filter, and says so via scopeCount', () => {
    const plan = selectAllPlan(mixed, 'schedule');
    // 11 schedule rows in scope (8 pending + 3 completed), 8 of them movable.
    expect(plan.scopeCount).toBe(11);
    expect(plan.eligibleCount).toBe(8);
    expect(plan.ids).toHaveLength(8);
    expect(plan.ids.every((id) => id.startsWith('s') && !id.startsWith('sc'))).toBe(true);
  });

  it('"all" is the same as no filter', () => {
    expect(selectAllPlan(mixed, 'all')).toEqual(selectAllPlan(mixed));
  });

  it('announces the cap instead of trimming quietly (240 movable, cap 200)', () => {
    const many = Array.from({ length: 240 }, (_, i) =>
      row({ kind: 'schedule', id: `m${i}`, status: 'pending' })
    );
    const plan = selectAllPlan(many, 'all', BULK_RESCHEDULE_MAX_ITEMS);
    expect(plan.selectedCount).toBe(200);
    expect(plan.eligibleCount).toBe(240);
    // The number the button has to say out loud: "และเหลืออีก 40 รายการ".
    expect(plan.cappedOut).toBe(40);
    // Capped in DISPLAY ORDER, so what was ticked is what he was looking at.
    expect(plan.ids[0]).toBe('m0');
    expect(plan.ids[199]).toBe('m199');
  });

  it('reports an empty plan when nothing in the result can move', () => {
    const none = [
      row({ kind: 'warranty', id: 'w', status: 'Active' }),
      row({ kind: 'schedule', id: 's', status: 'completed' }),
    ];
    const plan = selectAllPlan(none);
    expect(plan.selectedCount).toBe(0);
    expect(plan.eligibleCount).toBe(0);
    expect(plan.scopeCount).toBe(2);
    expect(selectableRows(none)).toEqual([]);
  });
});

// ── The confirm dialog's numbers ─────────────────────────────────────────────

describe('summariseShift', () => {
  it('reports the resulting range so a month-end crossing is visible first', () => {
    // 28-31 Jan +7 -> 4-7 Feb, which is exactly the thing an admin should see
    // before pressing OK.
    const rows = ['2026-01-28', '2026-01-29', '2026-01-30', '2026-01-31'].map((d) => ({
      matchedDate: d,
    }));
    const summary = summariseShift(rows, 7, '2026-01-20');
    expect(summary.count).toBe(4);
    expect(summary.earliest).toBe('2026-02-04');
    expect(summary.latest).toBe('2026-02-07');
    expect(summary.beforeTodayCount).toBe(0);
  });

  it('counts how many land before today, with today injected (never a clock)', () => {
    // Three tasks due tomorrow, shifted -5: all three land before today.
    const rows = [
      { matchedDate: '2026-06-13' },
      { matchedDate: '2026-06-13' },
      { matchedDate: '2026-06-13' },
    ];
    const summary = summariseShift(rows, -5, '2026-06-12');
    expect(summary.count).toBe(3);
    expect(summary.beforeTodayCount).toBe(3);
    expect(summary.earliest).toBe('2026-06-08');
    expect(summary.latest).toBe('2026-06-08');
  });

  it('counts only the ones that actually land in the past', () => {
    const rows = [{ matchedDate: '2026-06-13' }, { matchedDate: '2026-06-30' }];
    const summary = summariseShift(rows, -5, '2026-06-12');
    // 2026-06-08 is before today; 2026-06-25 is not.
    expect(summary.beforeTodayCount).toBe(1);
  });

  it('a row landing exactly on today is not counted as past', () => {
    const summary = summariseShift([{ matchedDate: '2026-06-19' }], -7, '2026-06-12');
    expect(summary.beforeTodayCount).toBe(0);
    expect(summary.earliest).toBe('2026-06-12');
  });

  it('separates rows whose target cannot be computed from those that can', () => {
    const summary = summariseShift(
      [{ matchedDate: '2026-06-12' }, { matchedDate: null }, { matchedDate: 'garbage' }],
      7,
      '2026-06-12'
    );
    expect(summary.count).toBe(1);
    expect(summary.invalidCount).toBe(2);
    expect(summary.earliest).toBe('2026-06-19');
  });

  it('returns nulls for an empty selection instead of inventing a range', () => {
    expect(summariseShift([], 7, '2026-06-12')).toEqual({
      count: 0,
      earliest: null,
      latest: null,
      beforeTodayCount: 0,
      invalidCount: 0,
    });
  });
});

// ── Validation shared by the panel and the route ─────────────────────────────

describe('validateSearchRange', () => {
  it('accepts a single day (from === to) — one code path, not two', () => {
    expect(validateSearchRange('2026-06-12', '2026-06-12')).toBeNull();
  });

  it('accepts a normal range', () => {
    expect(validateSearchRange('2026-06-01', '2026-06-07')).toBeNull();
  });

  it('accepts a past range — the feed`s windows do not apply here', () => {
    expect(validateSearchRange('2020-01-01', '2020-01-31')).toBeNull();
  });

  it('refuses an inverted range rather than swapping it silently', () => {
    // Swapping would hide the typo and answer confidently for a range nobody
    // asked about.
    const error = validateSearchRange('2026-06-20', '2026-06-12');
    expect(error).toBeTruthy();
    expect(error).toMatch(/[฀-๿]/);
  });

  it('refuses a range wider than the cap, naming the cap and the width', () => {
    const error = validateSearchRange('2026-01-01', '2027-02-04'); // 400 days inclusive
    expect(error).toContain(String(DATE_SEARCH_MAX_RANGE_DAYS));
    expect(error).toContain('400');
  });

  it('accepts a range exactly at the cap and refuses one day more', () => {
    // Inclusive width: from..to is (to - from) + 1 days.
    expect(validateSearchRange('2026-01-01', '2026-12-31')).toBeNull(); // 365
    expect(validateSearchRange('2026-01-01', '2027-01-01')).toBeNull(); // 366 = cap
    expect(validateSearchRange('2026-01-01', '2027-01-02')).toBeTruthy(); // 367
  });

  it('refuses a malformed date without guessing what was meant', () => {
    expect(validateSearchRange('12-06-2026', '2026-06-12')).toBeTruthy();
    expect(validateSearchRange('2026-6-12', '2026-06-12')).toBeTruthy();
    expect(validateSearchRange('2026-06-12', '')).toBeTruthy();
    expect(validateSearchRange('', '')).toBeTruthy();
  });

  it('documents that the shared validator checks SHAPE, not calendar overflow', () => {
    // `isValidDateString` in dateFormat.ts accepts "2026-02-30" because
    // `new Date("2026-02-30T00:00:00")` rolls over to 2 March rather than
    // returning Invalid Date. That is pre-existing behaviour of the shared
    // validator every date column in this app already relies on, and this
    // feature deliberately does not fork a second, stricter one — two
    // validators disagreeing about what a date is would be worse than the
    // overflow. It is harmless here: the value is still `^\d{4}-\d{2}-\d{2}$`,
    // so lexical ordering on the column is intact, and a range query for it
    // simply matches nothing. Pinned so a future change to dateFormat.ts is a
    // visible decision rather than a surprise.
    expect(validateSearchRange('2026-02-30', '2026-03-01')).toBeNull();
  });
});

describe('validateShiftDays / validateItemCount', () => {
  it('accepts a real shift in either direction', () => {
    expect(validateShiftDays(7)).toBeNull();
    expect(validateShiftDays(-5)).toBeNull();
    expect(validateShiftDays(BULK_RESCHEDULE_MAX_SHIFT_DAYS)).toBeNull();
  });

  it('refuses 0, a non-integer and anything past the cap', () => {
    expect(validateShiftDays(0)).toBeTruthy();
    expect(validateShiftDays(1.5)).toBeTruthy();
    expect(validateShiftDays('7')).toBeNull(); // Number("7") is an integer
    expect(validateShiftDays('abc')).toBeTruthy();
    expect(validateShiftDays(4000)).toContain(String(BULK_RESCHEDULE_MAX_SHIFT_DAYS));
    expect(validateShiftDays(-4000)).toBeTruthy();
  });

  it('refuses an over-cap batch by naming BOTH the cap and the count', () => {
    const error = validateItemCount(201);
    expect(error).toContain(String(BULK_RESCHEDULE_MAX_ITEMS));
    expect(error).toContain('201');
    expect(validateItemCount(BULK_RESCHEDULE_MAX_ITEMS)).toBeNull();
    expect(validateItemCount(0)).toBeTruthy();
  });
});

describe('caps', () => {
  it('are the numbers the spec fixed, so the guide can render them', () => {
    expect(DATE_SEARCH_ROW_CAP).toBe(200);
    expect(DATE_SEARCH_MAX_RANGE_DAYS).toBe(366);
    expect(BULK_RESCHEDULE_MAX_ITEMS).toBe(200);
    expect(BULK_RESCHEDULE_MAX_SHIFT_DAYS).toBe(3650);
  });
});
