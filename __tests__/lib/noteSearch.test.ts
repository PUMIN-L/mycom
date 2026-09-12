// @vitest-environment node
import { describe, it, expect } from 'vitest';

import {
  CUSTOMER_NOTE_MAX_LENGTH,
  NOTE_MATCH_SAMPLE_CAP,
  NOTE_MATCH_SCAN_CAP,
  NOTE_REPLACEMENT_MAX_LENGTH,
  NOTE_REPLACE_MAX_ITEMS,
  NOTE_SCAN_TIME_BUDGET_MS,
  NOTE_SEARCH_MAX_INPUT_LENGTH,
  NOTE_SEARCH_ROW_CAP,
  NOTE_SEARCH_TERM_MAX_LENGTH,
  NoteScanBudgetError,
  applyReplace,
  boundIncomingTerm,
  buildMatcher,
  countMatches,
  createScanBudget,
  findMatches,
  noteLengthRefusal,
  readIdentityToken,
  validateReplaceItemCount,
  validateReplacement,
} from '@/app/lib/noteSearch';
import type { NoteMatcher } from '@/app/lib/noteSearch';

// A real customer note, in the shape the proposal shows: dated lines, Thai
// with Latin brand names mixed in, growing downwards for years.
const CALL_LOG = [
  '6/9/26  โทรหา QC ส่งข้อมูล Company ไปให้ทางอีเมล์เรียบร้อย',
  '7/9/26  โทรหา เพื่อติดตามใบเสนอราคา ลูกค้าสนใจให้ทำใบเสนอราคา',
  '10/9/26 โทรหาเพื่อติดตามใบเสนอราคา เวอร์เนีย ลูกค้ายังไม่มีอัปเดต',
].join('\n');

/** buildMatcher, asserting it succeeded — the tests below are about matching,
 *  not about re-checking the guard on every line. */
function matcher(term: string, options?: { matchCase?: boolean; useRegex?: boolean }): NoteMatcher {
  const built = buildMatcher({ term, ...options });
  if (!built.ok) throw new Error(`expected a matcher, got refusal: ${built.reason}`);
  return built.matcher;
}

/** The refusal, asserting it WAS refused. */
function refusal(term: string, options?: { matchCase?: boolean; useRegex?: boolean }) {
  const built = buildMatcher({ term, ...options });
  expect(built.ok).toBe(false);
  if (built.ok) throw new Error('unreachable');
  return built;
}

// ════════════════════════════════════════════════════════════════════════════
// buildMatcher — the guard
// ════════════════════════════════════════════════════════════════════════════

describe('buildMatcher — refuses a pattern that can match the empty string', () => {
  // The whole reason this guard exists: the person using this system owns the
  // business. `.*` plus "แทนที่ทั้งหมด" is "erase every customer's call log in
  // one click", and it must never get as far as a query.
  it.each([
    ['.*', 'the case the spec names'],
    ['.*?', 'lazy, matches empty just as happily'],
    ['a?', 'an optional single character'],
    ['(?:)', 'an empty non-capturing group'],
    ['x{0}', 'a quantifier of zero — no asterisk anywhere in the text'],
    ['[\\s\\S]*', 'the "match anything including newlines" idiom'],
    ['\\d{0,3}', 'a zero-lower-bound quantifier'],
    ['(เวอร์เนีย)?', 'Thai, still optional, still matches empty'],
    ['^', 'an anchor on its own'],
    ['$', 'the other anchor'],
  ])('refuses %s (%s)', (pattern) => {
    const built = refusal(pattern, { useRegex: true });
    expect(built.code).toBe('matches_empty');
    expect(built.reason).toContain('ข้อความว่าง');
  });

  it.each([
    ['\\b', 'a word boundary — zero WIDTH, and empty-string-safe'],
    ['(?=Company)', 'a lookahead'],
    ['(?<=x)', 'a lookbehind'],
  ])('refuses the zero-width %s (%s) even though it fails against ""', (pattern) => {
    // These three are the reason the probe corpus is not just `""`. Each one
    // fails to match an empty string, then matches at every position of a real
    // note — which would splice the replacement in everywhere.
    expect(new RegExp(pattern).test('')).toBe(false);
    expect(refusal(pattern, { useRegex: true }).code).toBe('matches_empty');
  });

  it('detects it by RUNNING the pattern, not by reading its text', () => {
    // `.{0,}` means exactly what `.*` means and shares not one character with
    // it. Any guard built on inspecting the pattern text loses this race
    // forever; running the pattern wins it once.
    expect(refusal('.{0,}', { useRegex: true }).code).toBe('matches_empty');
    // And the converse: a pattern that LOOKS dangerous but cannot match empty
    // is allowed through.
    expect(buildMatcher({ term: '.+', useRegex: true }).ok).toBe(true);
    expect(buildMatcher({ term: 'เวอร์เนีย.*ดิจิตอล', useRegex: true }).ok).toBe(true);
  });

  it('allows the useful regexes an admin would actually type', () => {
    for (const pattern of ['\\d+/\\d+/\\d+', 'ใบเสนอราคา|ใบแจ้งหนี้', '^10/9', 'QC\\s+ส่ง']) {
      expect(buildMatcher({ term: pattern, useRegex: true }).ok).toBe(true);
    }
  });
});

describe('buildMatcher — refuses the shapes that backtrack catastrophically', () => {
  // Part (a) of the guard. JavaScript has no regex timeout and one `exec()` is
  // atomic, so a pattern like `(a+)+b` cannot be stopped once it is running —
  // in the browser the tab simply stops responding, and this code runs in the
  // browser to build the confirm dialog for a bulk edit. The only defence
  // against a SINGLE catastrophic match is to never start it.
  it.each([
    ['(a+)+', 'the textbook case'],
    ['(a*)*', 'star on star'],
    ['(a+)*', 'star on plus'],
    ['(a+)+b', 'with the failing tail that makes it actually explode'],
    ['(x+x+)+y', 'two quantifiers inside, one outside'],
    ['(\\d+)+', 'the same shape written with a character-class escape'],
    ['([ก-ฮ]+)+', 'and with a Thai character class'],
    ['(?:\\s+\\S+)+', 'a non-capturing group — the classic trim-pattern ReDoS'],
    ['(a+){2,}', 'the outer quantifier written as {2,}'],
    ['(a+)+?', 'lazy outer quantifier, same explosion'],
    ['((a+))+', 'buried one group deeper'],
    ['หา(ก(ข+)+)', 'buried inside a group that is not itself repeated'],
  ])('refuses %s (%s)', (pattern) => {
    const built = refusal(pattern, { useRegex: true });
    expect(built.code).toBe('catastrophic_backtracking');
    // Thai, and it says what to do instead — the admin is not a programmer and
    // "catastrophic backtracking" is not a phrase he can act on.
    expect(built.reason).toContain('ซ้อนกันสองชั้น');
    expect(built.reason).toContain('ก+');
  });

  it.each([
    ['(a|aa)+', 'one alternative is a prefix of the other'],
    ['(x|xy)*', 'same, with the star'],
    ['(ก|กก)+', 'and in Thai'],
  ])('refuses the overlapping alternation %s (%s)', (pattern) => {
    const built = refusal(pattern, { useRegex: true });
    expect(built.code).toBe('catastrophic_backtracking');
    expect(built.reason).toContain('ทับซ้อนกัน');
  });

  it('refuses the case-insensitive overlap too, because Aa is off by default', () => {
    // `(A|aa)+` is only ambiguous because the search is case-insensitive; with
    // Aa ON the two alternatives cannot both match the same text.
    expect(refusal('(A|aa)+', { useRegex: true }).code).toBe('catastrophic_backtracking');
    expect(buildMatcher({ term: '(A|aa)+', useRegex: true, matchCase: true }).ok).toBe(true);
  });

  // A GUARD THAT BLOCKS ORDINARY PATTERNS IS ITS OWN BUG. Every pattern below
  // looks like the ones above and is perfectly safe: the check is on a group
  // that ENDS in a quantifier, not on a group that merely contains one, and on
  // alternatives that overlap, not on alternatives that exist.
  it.each([
    ['(abc)+', 'a repeated literal group — the commonest regex there is'],
    ['a+b+', 'two quantifiers, no group at all'],
    ['(a|b)+', 'alternatives that cannot both match the same text'],
    ['(ก|ข)+', 'the same in Thai'],
    ['(ใบเสนอราคา|ใบแจ้งหนี้)+', 'a shared prefix is not a prefix relation'],
    ['(a+b)+', 'a quantifier inside, but the branch ends in a literal'],
    ['(\\d+) บาท', 'a quantified group that is NOT itself repeated'],
    ['(?:ABC){2}', 'a counted repetition of a literal'],
    ['\\d+/\\d+/\\d+', 'a date'],
    ['เวอร์เนีย.*ดิจิตอล', 'a wildcard between two real words'],
    ['QC\\s+ส่ง', 'whitespace between two words'],
    ['^10/9', 'an anchored line prefix'],
    ['[a-z]+[0-9]+', 'two quantified classes in a row'],
    ['(2569|2026)', 'an unquantified alternation of years'],
    ['(?:QT|INV)-\\d+', 'a document-number prefix'],
    ['เวอร์เนีย(ดิจิตอล)?', 'an optional word after a required one'],
    ['(\\d{1,3},)+\\d{3}', 'thousands separators — a repeated group ending in a comma'],
    ['(บาท|USD)$', 'a unit at the end of a line'],
  ])('does NOT refuse %s (%s)', (pattern) => {
    const built = buildMatcher({ term: pattern, useRegex: true });
    expect(built.ok).toBe(true);
  });

  it('never fires in plain mode, where every bracket is escaped text', () => {
    // Someone searching for the literal string "(ก+)+" in a note — a bizarre
    // thing to have written down, but the escaping makes it harmless, and a
    // guard that refused it would be refusing a plain-text search.
    const m = matcher('(ก+)+');
    expect(m.useRegex).toBe(false);
    expect(countMatches('สูตรที่ลูกค้าส่งมา (ก+)+ ตามนั้น', m)).toBe(1);
  });

  it('still runs the pattern for the empty-match check — the two guards stack', () => {
    // `(a?)+` is both shapes at once. The static check runs FIRST, before any
    // `exec()`, because the empty-match probe is itself seven `exec()` calls
    // and one is all a catastrophic pattern needs.
    expect(refusal('(a?)+', { useRegex: true }).code).toBe('catastrophic_backtracking');
    // While a pattern that is only an empty-matcher still reports as one.
    expect(refusal('.*', { useRegex: true }).code).toBe('matches_empty');
  });
});

describe('buildMatcher — the other refusals', () => {
  it('refuses an empty term, and whitespace-only, with a Thai reason', () => {
    for (const term of ['', '   ', '\n', '\t ']) {
      const built = refusal(term);
      expect(built.code).toBe('empty_term');
      // "ไม่พบ" for a search nobody ran reads as "this word is nowhere in your
      // customers' notes" — a confident wrong answer.
      expect(built.reason).toContain('คำว่าง');
    }
  });

  it('refuses an empty term in regex mode too', () => {
    expect(refusal('  ', { useRegex: true }).code).toBe('empty_term');
  });

  it('refuses a term past the length cap, in both modes', () => {
    const long = 'ก'.repeat(NOTE_SEARCH_TERM_MAX_LENGTH + 1);
    expect(refusal(long).code).toBe('term_too_long');
    expect(refusal(long, { useRegex: true }).code).toBe('term_too_long');
    // Exactly at the cap is fine — the bound is inclusive.
    expect(buildMatcher({ term: 'ก'.repeat(NOTE_SEARCH_TERM_MAX_LENGTH) }).ok).toBe(true);
  });

  it('refuses invalid regex syntax and says so in Thai, keeping the detail', () => {
    const built = refusal('[ก-', { useRegex: true });
    expect(built.code).toBe('invalid_regex');
    expect(built.reason).toContain('ไม่ถูกต้อง');
    // The admin is told how to get out of it without knowing the word regex.
    expect(built.reason).toContain('ปิดปุ่ม .*');
  });

  it('never lets a broken pattern through as a literal search instead', () => {
    // Silently falling back to a literal search for "[ก-" would answer a
    // question nobody asked.
    expect(buildMatcher({ term: '(unclosed', useRegex: true }).ok).toBe(false);
  });

  it('escapes metacharacters when regex mode is OFF', () => {
    const m = matcher('ราคา (ลด 10%)');
    expect(m.useRegex).toBe(false);
    expect(countMatches('ลูกค้าถาม ราคา (ลด 10%) เมื่อวาน', m)).toBe(1);
    // The parentheses are text, not a group: the literal string is required.
    expect(countMatches('ราคา ลด 10%', m)).toBe(0);
  });

  it('a plain-mode "." finds dots only, never every character', () => {
    const m = matcher('.');
    expect(countMatches('a.b.c', m)).toBe(2);
    expect(countMatches('abc', m)).toBe(0);
  });

  it('keeps the term the user typed, verbatim, on the matcher', () => {
    const m = matcher('  เวอร์เนีย  ');
    // Not trimmed: searching for a word with a space before it is a legitimate
    // thing to ask for, and trimming would answer a different question.
    expect(m.term).toBe('  เวอร์เนีย  ');
  });

  it('hands out a FRESH RegExp every call, so lastIndex never leaks between notes', () => {
    const m = matcher('โทร');
    const a = m.regex();
    a.exec('โทรหา');
    expect(a.lastIndex).toBeGreaterThan(0);
    expect(m.regex().lastIndex).toBe(0);
    // The proof that matters: the same matcher, reused across notes, finds the
    // match in each one.
    expect(countMatches('โทรหา QC', m)).toBe(1);
    expect(countMatches('โทรหา QC', m)).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Values that cross a boundary
//
// A term used to be run through `sanitizePlainText` on its way into both
// routes. That helper DELETES tag-like substrings, so the browser validated one
// needle and the server searched for another — and echoed the shortened one
// back for "แทนที่ทั้งหมด" to be built on. These tests pin down that the term is
// now a needle and nothing more.
// ════════════════════════════════════════════════════════════════════════════

describe('buildMatcher — markup characters are ordinary characters in a needle', () => {
  it('searches for `a<b` as typed, and does NOT collapse it to `a`', () => {
    const m = matcher('a<b');
    expect(m.term).toBe('a<b');
    // The bug this replaces: `sanitizePlainText("a<b") === "a"`, which made a
    // replace intended for `a<b` rewrite every letter `a` in the batch.
    expect(countMatches('ราคา a<b ต่อชิ้น', m)).toBe(1);
    expect(countMatches('ราคา a b ต่อชิ้น', m)).toBe(0);
    // And the needle finds nothing extra in a note full of `a`s.
    expect(countMatches('aaaa bbbb', m)).toBe(0);
  });

  it('accepts a term that is ONLY markup characters, instead of refusing it as empty', () => {
    // `sanitizePlainText("<test")` and `sanitizePlainText("<div")` are both "",
    // which came back as "กรุณาพิมพ์คำที่ต้องการค้นหาก่อน" while the box plainly
    // held text. Notes are typed by hand for years; these strings end up in one.
    for (const term of ['<test', '<div', '<b></b>', '<script>']) {
      const built = buildMatcher({ term });
      expect(built.ok).toBe(true);
      expect(built.matcher!.term).toBe(term);
    }
    expect(countMatches('ลูกค้าส่งมาว่า <script>alert(1)</script>', matcher('<script>'))).toBe(1);
  });

  it('searches for `&`, `<` and `>` without entity-encoding them', () => {
    expect(countMatches('บริษัท A & B จำกัด', matcher('A & B'))).toBe(1);
    // The encoded form is NOT what was asked for, so it must not match.
    expect(countMatches('บริษัท A &amp; B จำกัด', matcher('A & B'))).toBe(0);
    expect(countMatches('3 < 5 > 2', matcher('< 5 >'))).toBe(1);
  });

  it('a 200-character term of ampersands is accepted, not rejected as too long', () => {
    // `sanitizePlainText` expands every `&` to `&amp;`, so this term arrived at
    // the length check five times its real size: the screen accepted it and the
    // server answered "คำค้นยาวเกินไป" about a term that is exactly at the cap.
    const amps = '&'.repeat(NOTE_SEARCH_TERM_MAX_LENGTH);
    expect(amps.length).toBe(NOTE_SEARCH_TERM_MAX_LENGTH);
    const built = buildMatcher({ term: amps });
    expect(built.ok).toBe(true);
    expect(built.matcher!.term).toBe(amps);
    // One over is still refused — the cap itself did not move.
    expect(refusal('&'.repeat(NOTE_SEARCH_TERM_MAX_LENGTH + 1)).code).toBe('term_too_long');
  });

  it('REFUSES a term carrying an invisible control character — never strips it', () => {
    // Stripping is the very shape of bug being fixed. A refusal is computed
    // identically in the browser and in both routes, so they cannot disagree.
    for (const term of ['เวอร์เนีย\nดิจิตอล', 'a\tb', 'a\u0000b', 'a\rb', 'a\u007Fb']) {
      const built = refusal(term);
      expect(built.code).toBe('control_characters');
      expect(built.reason).toContain('อักขระควบคุม');
    }
  });

  it('refuses the control character in regex mode too, but keeps the `\\n` ESCAPE usable', () => {
    expect(refusal('ก\nข', { useRegex: true }).code).toBe('control_characters');
    // Two ordinary characters, backslash and n — the documented way to search
    // across the lines of a call log, and it still works.
    const m = matcher('ก\\nข', { useRegex: true });
    expect(countMatches('ก\nข', m)).toBe(1);
  });
});

describe('boundIncomingTerm / readIdentityToken', () => {
  it('bounds a term to ONE character over the cap, so an over-long term still refuses', () => {
    const huge = 'ก'.repeat(50_000);
    const bounded = boundIncomingTerm(huge);
    expect(bounded.length).toBe(NOTE_SEARCH_TERM_MAX_LENGTH + 1);
    // The point of the extra character: a refusal, not a silently trimmed
    // search of the first 200 characters.
    expect(buildMatcher({ term: bounded }).ok).toBe(false);
    expect(refusal(bounded).code).toBe('term_too_long');
  });

  it('leaves every legal term byte for byte alone', () => {
    for (const term of ['เวอร์เนีย', 'a<b', '&'.repeat(NOTE_SEARCH_TERM_MAX_LENGTH), '  ก  ']) {
      expect(boundIncomingTerm(term)).toBe(term);
    }
    expect(boundIncomingTerm(null)).toBe('');
    expect(boundIncomingTerm(undefined)).toBe('');
  });

  it('reads an identity token verbatim — no escaping, no trimming, no truncation', () => {
    // It is one side of an equality test whose other side is the raw column.
    // Anything done to it here is done to only one side.
    const raw = 'บริษัท A & B <ยกเลิก> ' + 'ก'.repeat(NOTE_SEARCH_MAX_INPUT_LENGTH);
    expect(readIdentityToken(raw)).toBe(raw);
    expect(readIdentityToken('  spaced  ')).toBe('  spaced  ');
    expect(readIdentityToken(null)).toBe('');
    expect(readIdentityToken(undefined)).toBe('');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// findMatches — Thai, case, counts, context
// ════════════════════════════════════════════════════════════════════════════

describe('findMatches — Thai', () => {
  it('finds a Thai word in a Thai-only note', () => {
    const note = 'โทรหาลูกค้าเรื่องเวอร์เนีย ลูกค้าขอให้ส่งราคาเวอร์เนียอีกครั้ง';
    const summary = findMatches(note, matcher('เวอร์เนีย'));
    expect(summary.count).toBe(2);
    expect(summary.matches[0].text).toBe('เวอร์เนีย');
  });

  it('finds a Thai word with no spaces around it (Thai has none)', () => {
    // This is exactly why there is no "ทั้งคำ" option: nothing delimits a Thai
    // word, so a substring match is the only match there is.
    expect(countMatches('ติดตามใบเสนอราคาแล้วยังไม่ตอบ', matcher('ใบเสนอราคา'))).toBe(1);
  });

  it('a `\\b` regex finds nothing in Thai — the reason "ทั้งคำ" does not exist', () => {
    // JavaScript defines \b on the edges of [A-Za-z0-9_]. No Thai character is
    // in that set, so this pattern is an always-empty answer. A button that
    // always returns nothing is worse than no button, so the option was never
    // built; a regex-mode user who types it gets the truth.
    const m = matcher('\\bเวอร์เนีย\\b', { useRegex: true });
    expect(countMatches(CALL_LOG, m)).toBe(0);
    // While the same word, searched normally, is right there.
    expect(countMatches(CALL_LOG, matcher('เวอร์เนีย'))).toBe(1);
  });

  it('finds Latin inside a Thai note, and Thai next to Latin', () => {
    expect(countMatches(CALL_LOG, matcher('Company'))).toBe(1);
    expect(countMatches(CALL_LOG, matcher('QC ส่งข้อมูล'))).toBe(1);
  });
});

describe('findMatches — case', () => {
  const mixed = 'ส่ง Company ให้ company แล้ว COMPANY ก็ตอบกลับ';

  it('is case-insensitive by default, across the Latin part only', () => {
    expect(countMatches(mixed, matcher('company'))).toBe(3);
  });

  it('with Aa on, "company" no longer finds "Company"', () => {
    expect(countMatches(mixed, matcher('company', { matchCase: true }))).toBe(1);
    expect(countMatches(mixed, matcher('Company', { matchCase: true }))).toBe(1);
    expect(countMatches(mixed, matcher('COMPANY', { matchCase: true }))).toBe(1);
  });

  it('Thai is unaffected by the Aa button — Thai has no letter case', () => {
    const note = 'เวอร์เนีย ดิจิตอล';
    expect(countMatches(note, matcher('เวอร์เนีย', { matchCase: true }))).toBe(1);
    expect(countMatches(note, matcher('เวอร์เนีย', { matchCase: false }))).toBe(1);
  });
});

describe('findMatches — several matches in one note', () => {
  it('counts every occurrence and reports the first few with context', () => {
    const note = [
      '1/9/26 ทำใบเสนอราคา',
      '2/9/26 ส่งใบเสนอราคาให้ลูกค้า',
      '3/9/26 ตามใบเสนอราคา ยังไม่ตอบ',
    ].join('\n');
    const summary = findMatches(note, matcher('ใบเสนอราคา'));
    expect(summary.count).toBe(3);
    expect(summary.matches).toHaveLength(3);
    expect(summary.countCapped).toBe(false);
    // Each context window is cut from the REAL note and carries the date at
    // the head of its line, which is what makes it possible to tell whether
    // this is the occurrence you meant.
    expect(summary.matches[0].snippet).toContain('1/9/26');
    expect(summary.matches[2].snippet).toContain('3/9/26');
    for (const match of summary.matches) {
      expect(note.slice(match.start, match.end)).toBe('ใบเสนอราคา');
      expect(match.snippet.slice(match.snippetMatchStart, match.snippetMatchEnd)).toBe(
        'ใบเสนอราคา'
      );
      expect(note).toContain(match.snippet);
    }
  });

  it('caps the sample but not the count, and flags a capped count', () => {
    const many = 'ก'.repeat(NOTE_MATCH_SCAN_CAP + 50);
    const summary = findMatches(many, matcher('ก'));
    expect(summary.count).toBe(NOTE_MATCH_SCAN_CAP);
    expect(summary.countCapped).toBe(true);
    expect(summary.matches).toHaveLength(NOTE_MATCH_SAMPLE_CAP);
  });

  it('marks which end of a snippet was cut, so the screen can show a "…"', () => {
    const note = `${'x'.repeat(300)}เวอร์เนีย${'y'.repeat(300)}`;
    const [match] = findMatches(note, matcher('เวอร์เนีย')).matches;
    expect(match.prefixTruncated).toBe(true);
    expect(match.suffixTruncated).toBe(true);

    const short = 'เวอร์เนีย';
    const [whole] = findMatches(short, matcher('เวอร์เนีย')).matches;
    expect(whole.prefixTruncated).toBe(false);
    expect(whole.suffixTruncated).toBe(false);
    expect(whole.snippet).toBe(short);
  });

  it('returns nothing for a note with no match, and for an empty note', () => {
    expect(findMatches('', matcher('เวอร์เนีย')).count).toBe(0);
    expect(findMatches(null, matcher('เวอร์เนีย')).count).toBe(0);
    expect(findMatches(undefined, matcher('เวอร์เนีย')).count).toBe(0);
    expect(findMatches('ไม่มีคำนั้น', matcher('เวอร์เนีย')).count).toBe(0);
  });

  it('SKIPS an over-long note and says so rather than reporting "no matches"', () => {
    const huge = `เวอร์เนีย${'ก'.repeat(NOTE_SEARCH_MAX_INPUT_LENGTH)}`;
    const summary = findMatches(huge, matcher('เวอร์เนีย'));
    expect(summary.skipped).toBe(true);
    expect(summary.count).toBe(0);
    // The caller reports the skip; an unsearched customer must never look the
    // same as a customer with nothing in his note.
  });
});

describe('findMatches — a note full of things that look like HTML', () => {
  // Customer notes are plain text and are rendered as plain text. They can
  // still contain angle brackets, and neither the search nor the replace may
  // interpret them, strip them, or move them.
  const tagish = 'ลูกค้าถาม <b>ราคา</b> ของรุ่น <script>alert(1)</script> กับ a < b';

  it('treats the tags as ordinary characters', () => {
    expect(countMatches(tagish, matcher('ราคา'))).toBe(1);
    expect(countMatches(tagish, matcher('<b>'))).toBe(1);
    expect(countMatches(tagish, matcher('<script>'))).toBe(1);
    expect(countMatches(tagish, matcher('a < b'))).toBe(1);
  });

  it('returns the snippet verbatim — nothing is escaped or removed here', () => {
    const [match] = findMatches(tagish, matcher('ราคา')).matches;
    expect(match.snippet).toContain('<b>');
    expect(tagish).toContain(match.snippet);
  });

  it('replaces around them without disturbing them', () => {
    const out = applyReplace(tagish, matcher('ราคา'), 'ค่าตัว');
    expect(out).toBe('ลูกค้าถาม <b>ค่าตัว</b> ของรุ่น <script>alert(1)</script> กับ a < b');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// applyReplace
// ════════════════════════════════════════════════════════════════════════════

describe('applyReplace — the line structure survives', () => {
  it('does not touch a single newline', () => {
    const out = applyReplace(CALL_LOG, matcher('เวอร์เนีย'), 'เวอร์เนียดิจิตอล')!;
    // The count of lines, and every line boundary, is exactly what it was.
    expect(out.split('\n')).toHaveLength(3);
    expect(out.split('\n')[0]).toBe(CALL_LOG.split('\n')[0]);
    expect(out.split('\n')[1]).toBe(CALL_LOG.split('\n')[1]);
    expect(out.split('\n')[2]).toContain('เวอร์เนียดิจิตอล');
    // Byte for byte outside the replaced spans.
    expect(out.replace('เวอร์เนียดิจิตอล', 'เวอร์เนีย')).toBe(CALL_LOG);
  });

  it('keeps blank lines, trailing newlines and Windows line endings', () => {
    const note = '1/9/26 ก\r\n\r\n2/9/26 ก\n\n';
    const out = applyReplace(note, matcher('ก'), 'ข')!;
    expect(out).toBe('1/9/26 ข\r\n\r\n2/9/26 ข\n\n');
  });

  it('replaces every occurrence, on every line', () => {
    const note = 'ใบเสนอราคา\nใบเสนอราคา\nใบเสนอราคา';
    expect(applyReplace(note, matcher('ใบเสนอราคา'), 'QT')).toBe('QT\nQT\nQT');
  });
});

describe('applyReplace — the replacement is literal', () => {
  it('does not treat $& / $1 / $` as substitutions', () => {
    // `String.replace` would turn "$&" into the matched text. Someone
    // replacing a price with "$5" would get something unexplainable.
    const note = 'ราคา 100 บาท';
    expect(applyReplace(note, matcher('100'), '$5')).toBe('ราคา $5 บาท');
    expect(applyReplace(note, matcher('100'), '$&')).toBe('ราคา $& บาท');
    expect(applyReplace(note, matcher('100'), '$1')).toBe('ราคา $1 บาท');
    expect(applyReplace(note, matcher('100'), "$`")).toBe('ราคา $` บาท');
  });

  it('offers no capture-group substitution even in regex mode', () => {
    const m = matcher('(\\d+) บาท', { useRegex: true });
    expect(applyReplace('ราคา 100 บาท', m, '$1 THB')).toBe('ราคา $1 THB');
  });

  it('cannot run away when the replacement contains the term', () => {
    // One left-to-right pass over the ORIGINAL note; the output is never
    // re-scanned.
    const out = applyReplace('เวอร์เนีย', matcher('เวอร์เนีย'), 'เวอร์เนียดิจิตอล');
    expect(out).toBe('เวอร์เนียดิจิตอล');
  });
});

describe('applyReplace — replacing with an empty string deletes the word', () => {
  it('removes every occurrence and leaves the rest alone', () => {
    const note = '10/9/26 โทรหาเรื่องเวอร์เนีย และเวอร์เนียอีกตัว';
    expect(applyReplace(note, matcher('เวอร์เนีย'), '')).toBe(
      '10/9/26 โทรหาเรื่อง และอีกตัว'
    );
  });

  it('treats null/undefined replacement as an empty string, not as a refusal', () => {
    expect(applyReplace('abc', matcher('b'), null)).toBe('ac');
    expect(applyReplace('abc', matcher('b'), undefined)).toBe('ac');
  });

  it('can empty a note completely, but only because the term covers it', () => {
    // This is a deletion the admin asked for by name, not a wildcard sweep —
    // `.*` never gets a matcher at all.
    expect(applyReplace('เวอร์เนีย', matcher('เวอร์เนีย'), '')).toBe('');
  });
});

describe('applyReplace — no match, and the refusals', () => {
  it('returns the note UNCHANGED (a string, never null) when nothing matches', () => {
    expect(applyReplace(CALL_LOG, matcher('ไม่มีคำนี้'), 'x')).toBe(CALL_LOG);
  });

  it('refuses an over-long note instead of replacing part of it', () => {
    const huge = 'ก'.repeat(NOTE_SEARCH_MAX_INPUT_LENGTH + 1);
    expect(applyReplace(huge, matcher('ก'), 'ข')).toBeNull();
  });

  it('refuses a note with more matches than the scan cap', () => {
    expect(applyReplace('ก'.repeat(NOTE_MATCH_SCAN_CAP + 1), matcher('ก'), 'ข')).toBeNull();
    // At the cap it still works — the refusal is for going past it.
    expect(applyReplace('ก'.repeat(NOTE_MATCH_SCAN_CAP), matcher('ก'), 'ข')).toBe(
      'ข'.repeat(NOTE_MATCH_SCAN_CAP)
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// The envelope rules
// ════════════════════════════════════════════════════════════════════════════

describe('noteLengthRefusal — the 2000-character silent truncation', () => {
  it('passes a note that fits', () => {
    expect(noteLengthRefusal('ก'.repeat(CUSTOMER_NOTE_MAX_LENGTH))).toBeNull();
  });

  it('refuses one character over, and says by how much', () => {
    const reason = noteLengthRefusal('ก'.repeat(CUSTOMER_NOTE_MAX_LENGTH + 1));
    expect(reason).not.toBeNull();
    expect(reason).toContain(String(CUSTOMER_NOTE_MAX_LENGTH + 1));
    expect(reason).toContain(String(CUSTOMER_NOTE_MAX_LENGTH));
    // The point of the refusal: the write routes would `substring(0, 2000)`
    // this and lose the end of a years-long call log without telling anyone.
    expect(reason).toContain('หายไปโดยไม่มีใครรู้');
  });
});

describe('validateReplaceItemCount / validateReplacement', () => {
  it('refuses an empty batch', () => {
    expect(validateReplaceItemCount(0)).toContain('อย่างน้อย 1 ราย');
    expect(validateReplaceItemCount(-1)).not.toBeNull();
    expect(validateReplaceItemCount(1.5)).not.toBeNull();
  });

  it('accepts a batch at the cap and refuses — never trims — one over', () => {
    expect(validateReplaceItemCount(NOTE_REPLACE_MAX_ITEMS)).toBeNull();
    const reason = validateReplaceItemCount(NOTE_REPLACE_MAX_ITEMS + 1)!;
    expect(reason).toContain(String(NOTE_REPLACE_MAX_ITEMS));
    expect(reason).toContain('ไม่ตัดส่วนเกินทิ้ง');
  });

  it('the search row cap never exceeds the replace cap', () => {
    // A list you can see in full is a list you can act on in full. If a page of
    // results could hold more customers than one replace request may carry,
    // "แทนที่ทั้งหมด" on a full page would be refused as too large — a dead end
    // built out of two constants that each looked reasonable alone.
    expect(NOTE_SEARCH_ROW_CAP).toBeLessThanOrEqual(NOTE_REPLACE_MAX_ITEMS);
  });

  it('refuses an over-long replacement', () => {
    expect(validateReplacement('')).toBeNull();
    expect(validateReplacement('ก'.repeat(NOTE_REPLACEMENT_MAX_LENGTH))).toBeNull();
    expect(validateReplacement('ก'.repeat(NOTE_REPLACEMENT_MAX_LENGTH + 1))).not.toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// The scan time budget — part (b) of the backtracking guard
// ════════════════════════════════════════════════════════════════════════════

describe('the scan time budget', () => {
  /**
   * A clock that jumps `step` milliseconds every time it is READ. The budget is
   * about elapsed time, and a test that proves it by actually waiting is a test
   * that is slow when it passes and flaky when the machine is busy. Injecting
   * the clock makes the abort exact: the number of reads is the number of
   * checks the scan performs.
   */
  function fakeClock(step: number): () => number {
    let now = 0;
    return () => {
      const value = now;
      now += step;
      return value;
    };
  }

  /** A pattern with no group anywhere, so the static shape check has nothing to
   *  look at — the budget is the only thing left that can notice it. */
  const STATICALLY_INVISIBLE = '\\d+\\d+\\d+e';

  /** ~3400 characters of real-looking call log, the shape of a note that has
   *  been added to for years. */
  const LONG_CALL_LOG = Array.from(
    { length: 40 },
    (_, i) => `${i + 1}/9/26 โทรหาลูกค้าเรื่องเวอร์เนียดิจิตอล ยังไม่สรุป ขอให้ส่งใบเสนอราคาอีกครั้ง`
  ).join('\n');

  function budgetErrorFrom(run: () => unknown): NoteScanBudgetError {
    try {
      run();
    } catch (error) {
      if (error instanceof NoteScanBudgetError) return error;
      throw error;
    }
    throw new Error('expected the scan to abort on its time budget, but it finished');
  }

  it('the static check cannot see this pattern — which is exactly why (b) exists', () => {
    // `\d+\d+\d+e` divides its input combinatorially with no group and no
    // nested quantifier for `backtrackingRefusal` to recognise. It is allowed
    // through, and the time budget is what stands between it and a dead tab.
    expect(buildMatcher({ term: STATICALLY_INVISIBLE, useRegex: true }).ok).toBe(true);
  });

  it('aborts between matches, in Thai, naming the note it was reading', () => {
    const m = matcher(STATICALLY_INVISIBLE, { useRegex: true });
    const note = '123e '.repeat(200);
    const budget = createScanBudget({ budgetMs: 10, now: fakeClock(1) });

    const error = budgetErrorFrom(() =>
      findMatches(note, m, { budget, label: 'บริษัท ก จำกัด' })
    );
    expect(error.label).toBe('บริษัท ก จำกัด');
    expect(error.message).toContain('บริษัท ก จำกัด');
    expect(error.message).toContain('นานผิดปกติ');
    // The sentence that stops an admin from assuming the worst: an abort is
    // never a half-finished replace.
    expect(error.message).toContain('ยังไม่มีบันทึกของลูกค้ารายใดถูกแก้');
    // And it tells him what to do next without using the word regex.
    expect(error.message).toContain('ปิดโหมด .*');
  });

  it('spends ONE budget across a whole pass of notes, and names the note it stopped on', () => {
    // The case a static check cannot see at all: every note here is trivial,
    // and it is the hundred of them together that runs the clock out. This is
    // the preview pass — `applyReplace` over up to 100 customers, in the
    // browser, at the moment the confirm dialog opens.
    const m = matcher('เวอร์เนีย');
    const notes = Array.from({ length: NOTE_REPLACE_MAX_ITEMS }, (_, i) => ({
      label: `ลูกค้ารายที่ ${i + 1}`,
      note: '6/9/26 ขายเวอร์เนียให้ลูกค้า',
    }));
    const budget = createScanBudget({ budgetMs: 12, now: fakeClock(1) });

    const error = budgetErrorFrom(() => {
      for (const item of notes) {
        applyReplace(item.note, m, 'เวอร์เนียดิจิตอล', { budget, label: item.label });
      }
    });

    // "failed" would leave an admin with 100 suspects. The message names one.
    expect(notes.map((n) => n.label)).toContain(error.label);
    expect(error.message).toContain(error.label as string);
    // It stopped part way — it did not quietly finish and report afterwards.
    expect(error.label).not.toBe(notes[notes.length - 1].label);
  });

  it('a spent budget stops the NEXT note before its scan even begins', () => {
    // Checked on entry as well as between matches, so a pass that is already
    // over its budget adds nothing more to the freeze.
    const budget = createScanBudget({ budgetMs: 0 });
    expect(() =>
      findMatches(CALL_LOG, matcher('โทร'), { budget, label: 'ลูกค้า ข' })
    ).toThrow(NoteScanBudgetError);
    expect(() =>
      applyReplace(CALL_LOG, matcher('โทร'), 'x', { budget, label: 'ลูกค้า ข' })
    ).toThrow(NoteScanBudgetError);
  });

  it('a normal search over the maximum number of notes finishes far inside the budget', () => {
    // The guard must be invisible in ordinary use. This is the worst honest
    // case the feature allows — a full page of results, every note thousands of
    // characters long — measured on the real clock.
    const m = matcher('เวอร์เนีย');
    const budget = createScanBudget();
    for (let i = 0; i < NOTE_SEARCH_ROW_CAP; i++) {
      const summary = findMatches(LONG_CALL_LOG, m, { budget, label: `ลูกค้า ${i + 1}` });
      expect(summary.count).toBe(40);
    }
    expect(budget.elapsedMs()).toBeLessThan(NOTE_SCAN_TIME_BUDGET_MS / 2);
  });

  it('the whole preview pass — 100 replaces — also finishes far inside the budget', () => {
    const m = matcher('เวอร์เนีย');
    const budget = createScanBudget();
    for (let i = 0; i < NOTE_REPLACE_MAX_ITEMS; i++) {
      const next = applyReplace(LONG_CALL_LOG, m, 'เวอร์เนียดิจิตอล', {
        budget,
        label: `ลูกค้า ${i + 1}`,
      });
      expect(next).toContain('เวอร์เนียดิจิตอล');
    }
    expect(budget.elapsedMs()).toBeLessThan(NOTE_SCAN_TIME_BUDGET_MS / 2);
  });

  it('a call given no budget bounds itself, and never fires for real work', () => {
    // Every existing caller passes nothing; each call then gets its own budget,
    // so a lone call is still bounded — it just cannot see what the calls before
    // it spent, which is why a pass that cares creates one and shares it.
    expect(() => findMatches(LONG_CALL_LOG, matcher('เวอร์เนีย'))).not.toThrow();
    expect(() => applyReplace(LONG_CALL_LOG, matcher('เวอร์เนีย'), 'x')).not.toThrow();
    expect(countMatches(LONG_CALL_LOG, matcher('เวอร์เนีย'))).toBe(40);
  });

  it('reports the budget it was given, so a caller can say how long it waited', () => {
    const budget = createScanBudget({ budgetMs: 250, now: fakeClock(0) });
    expect(budget.budgetMs).toBe(250);
    expect(budget.elapsedMs()).toBe(0);
    const error = budgetErrorFrom(() =>
      findMatches('ก', matcher('ก'), {
        budget: createScanBudget({ budgetMs: 5, now: fakeClock(100) }),
      })
    );
    expect(error.budgetMs).toBe(5);
    expect(error.elapsedMs).toBeGreaterThanOrEqual(5);
    // No label passed: the message still reads as a sentence.
    expect(error.label).toBeNull();
    expect(error.message).toContain('นานผิดปกติ');
  });
});
