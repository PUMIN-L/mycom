// @vitest-environment node
/**
 * Running numbers of the accounting module (lib/accounting/numbering.ts):
 * TYPE + YYYYMM + 4 digits, from 0001 each month; handed out under a lock so
 * concurrent issues neither share nor skip a number; the latest one given
 * back when its document is deleted.
 */
import { describe, it, expect } from "vitest";
import {
  allocateDocNo,
  docPeriod,
  formatDocNo,
  parseDocNo,
  releaseDocNoIfLatest,
  MAX_DOC_SEQ,
  DocNumberExhaustedError,
} from "@/app/lib/accounting/numbering";

describe("the number's shape", () => {
  it("is TYPE + YYYYMM + 4 digits", () => {
    expect(docPeriod("2026-11-18")).toBe("202611");
    expect(formatDocNo("INV", "202611", 33)).toBe("INV2026110033");
    expect(formatDocNo("RE", "202601", 1)).toBe("RE2026010001");
  });

  it("refuses a date that does not exist", () => {
    expect(() => docPeriod("2026-02-31")).toThrow();
    expect(() => docPeriod("18/11/2026")).toThrow();
  });

  it("reads back only numbers it could have minted", () => {
    expect(parseDocNo("INV2026110033")).toEqual({ type: "INV", period: "202611", seq: 33 });
    expect(parseDocNo("CN2026120001")).toEqual({ type: "CN", period: "202612", seq: 1 });
    for (const other of ["INV2026130001", "INV2026110000", "INV050926-23", "QT2026110001", "", null, "INV20261100331"]) {
      expect(parseDocNo(other), String(other)).toBeNull();
    }
  });
});

// ── A stand-in database with a real row lock ────────────────────────────────
// SELECT … FOR UPDATE takes the counter row's lock and holds it until the
// transaction commits; a plain SELECT would not wait. So these tests pin that
// the allocator reads under the lock and computes from what it read.

type Row = Record<string, unknown>;
function makeDb(opts: { maxDocNo?: string | null } = {}) {
  const counters = new Map<string, number>();
  const tails = new Map<string, Promise<void>>();
  const statements: string[] = [];
  const tick = () => new Promise((r) => setTimeout(r, Math.random() * 3));

  function begin() {
    const releases: (() => void)[] = [];
    const conn = {
      async query(sql: string, params: unknown[] = []): Promise<[Row[] | Row, unknown[]]> {
        statements.push(sql);
        await tick();
        if (sql.startsWith("INSERT IGNORE INTO acc_counters")) {
          const key = `${params[0]}|${params[1]}`;
          if (!counters.has(key)) counters.set(key, 0);
          return [{}, []];
        }
        if (sql.includes("FROM acc_counters") && sql.includes("FOR UPDATE")) {
          const key = `${params[0]}|${params[1]}`;
          const previous = tails.get(key) ?? Promise.resolve();
          let release!: () => void;
          const mine = new Promise<void>((r) => (release = r));
          tails.set(key, previous.then(() => mine));
          await previous;
          releases.push(release);
          return [[{ lastNo: counters.get(key) ?? 0 }], []];
        }
        if (sql.includes("MAX(docNo)")) return [[{ maxNo: opts.maxDocNo ?? null }], []];
        if (sql.startsWith("UPDATE acc_counters")) {
          counters.set(`${params[1]}|${params[2]}`, Number(params[0]));
          return [{}, []];
        }
        throw new Error(`unexpected SQL: ${sql}`);
      },
      commit() {
        releases.forEach((release) => release());
      },
    };
    return conn;
  }
  return { begin, counters, statements };
}

describe("allocateDocNo", () => {
  it("starts each series and month at 0001, and counts on", async () => {
    const db = makeDb();
    const take = async (type: "INV" | "RE", date: string) => {
      const tx = db.begin();
      const no = await allocateDocNo(tx as never, type, date);
      tx.commit();
      return no;
    };
    expect(await take("INV", "2026-11-18")).toBe("INV2026110001");
    expect(await take("INV", "2026-11-30")).toBe("INV2026110002");
    expect(await take("RE", "2026-11-30")).toBe("RE2026110001");
    expect(await take("INV", "2026-12-01")).toBe("INV2026120001");
  });

  it("gives 50 issues at the same moment 50 different numbers, none skipped", async () => {
    const db = makeDb();
    const numbers = await Promise.all(
      Array.from({ length: 50 }, async () => {
        const tx = db.begin();
        const no = await allocateDocNo(tx as never, "INV", "2026-11-18");
        tx.commit();
        return no;
      })
    );
    const seqs = numbers.map((n) => parseDocNo(n)!.seq).sort((a, b) => a - b);
    expect(seqs).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
  });

  it("never hands out a number already on a document, even with the counter row lost", async () => {
    const db = makeDb({ maxDocNo: "INV2026110041" });
    const tx = db.begin();
    expect(await allocateDocNo(tx as never, "INV", "2026-11-18")).toBe("INV2026110042");
    tx.commit();
    // …and the documents query only looks at numbers this module minted.
    expect(db.statements.find((s) => s.includes("MAX(docNo)"))).toContain("source = 'internal'");
  });

  it("refuses a 10,000th number in a month instead of printing five digits", async () => {
    const db = makeDb({ maxDocNo: formatDocNo("INV", "202611", MAX_DOC_SEQ) });
    const tx = db.begin();
    await expect(allocateDocNo(tx as never, "INV", "2026-11-18")).rejects.toBeInstanceOf(DocNumberExhaustedError);
    tx.commit();
  });
});

describe("releaseDocNoIfLatest", () => {
  function fakeCounter(lastNo: number) {
    const updates: unknown[][] = [];
    const conn = {
      async query(sql: string, params: unknown[] = []) {
        if (sql.includes("FOR UPDATE")) return [[{ lastNo }], []];
        if (sql.startsWith("UPDATE acc_counters")) {
          updates.push(params);
          return [{}, []];
        }
        throw new Error(`unexpected SQL: ${sql}`);
      },
    };
    return { conn, updates };
  }

  it("gives the latest number back, so the next document takes it", async () => {
    const { conn, updates } = fakeCounter(5);
    expect(await releaseDocNoIfLatest(conn as never, "INV2026110005")).toBe(true);
    expect(updates).toEqual([[4, "INV", "202611"]]);
  });

  it("keeps an older number given (the gap is said on the page before deleting)", async () => {
    const { conn, updates } = fakeCounter(7);
    expect(await releaseDocNoIfLatest(conn as never, "INV2026110005")).toBe(false);
    expect(updates).toEqual([]);
  });

  it("ignores a number this module did not mint (an external document's)", async () => {
    const { conn, updates } = fakeCounter(5);
    expect(await releaseDocNoIfLatest(conn as never, "IV-2569/0005")).toBe(false);
    expect(updates).toEqual([]);
  });
});
