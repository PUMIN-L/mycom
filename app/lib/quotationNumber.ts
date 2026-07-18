// Quotation running-number helpers. docNo format is QT<YYYYMMDD>-NN; the date
// prefix rolls over daily and NN runs within a day starting at DOCNO_START.
// Pure + dependency-free for unit testing and sharing between UIs.

// Each day's running number starts here (business convention).
export const DOCNO_START = 22;

export const pad2 = (n: number) => String(n).padStart(2, "0");

// Next free trailing number for a date prefix (e.g. "QT20260719-"): the day's
// first number is DOCNO_START (-22), then -23, -24, … Numbers from other date
// prefixes are ignored.
export function nextDocNo(prefix: string, used: string[]): string {
  let max = 0;
  for (const d of used) {
    if (d.startsWith(prefix)) {
      const n = parseInt(d.slice(prefix.length), 10);
      if (!Number.isNaN(n) && n > max) max = n;
    }
  }
  return `${prefix}${pad2(Math.max(max + 1, DOCNO_START))}`;
}
