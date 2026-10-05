/**
 * An in-memory stand-in for the tables app/lib/inventoryStore.ts touches —
 * inventory_groups / _items / _events / _counters, plus suppliers (read only)
 * — that RUNS the statements the store sends, with transactions that roll
 * back on a throw like db.ts's withTransaction. Tests built on it assert the
 * rows a later request would see, not which SQL went out.
 *
 * It understands only the statement shapes the store uses:
 *   INSERT [IGNORE] INTO t (cols) VALUES (…), (…)
 *   SELECT <projection> FROM t [i LEFT JOIN suppliers s ON s.id = i.supplierId]
 *     WHERE a = ? AND b IN (?, ?) [ORDER BY …] [FOR UPDATE]
 *   UPDATE t SET a = ?, b = ? WHERE …
 *   DELETE FROM t WHERE …
 * Anything else throws, so a statement added to the store without teaching
 * it here fails loudly instead of quietly returning nothing.
 */

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

const TABLES = ["inventory_groups", "inventory_items", "inventory_events", "inventory_counters", "suppliers"];
const PRIMARY_KEY: Record<string, string> = { inventory_counters: "kind" };

export interface FakeInventoryDb {
  tables: Tables;
  /** Every statement run, normalized. */
  statements: string[];
  /** Throw this error when a statement matching `pattern` runs (once). */
  failOn: (pattern: RegExp, error?: Error) => void;
  run: (sql: string, params?: unknown[]) => Promise<[unknown, unknown]>;
  transaction: <T>(fn: (conn: { query: FakeInventoryDb["run"] }) => Promise<T>) => Promise<T>;
}

const norm = (sql: string) => sql.replace(/\s+/g, " ").trim();
const clone = (t: Tables): Tables => Object.fromEntries(Object.entries(t).map(([k, rows]) => [k, rows.map((r) => ({ ...r }))]));

type Cond = { col: string; values: unknown[] };

/** "a = ? AND b IN (?, ?)" → conditions, consuming params from `take`. */
function parseWhere(where: string, take: () => unknown): Cond[] {
  return where.split(" AND ").map((part) => {
    const eq = /^(?:\w+\.)?(\w+) = \?$/.exec(part.trim());
    if (eq) return { col: eq[1], values: [take()] };
    const inn = /^(?:\w+\.)?(\w+) IN \(([?, ]+)\)$/.exec(part.trim());
    if (inn) return { col: inn[1], values: inn[2].split(",").map(() => take()) };
    throw new Error(`fakeInventoryDb: unsupported WHERE part: ${part}`);
  });
}

const matches = (row: Row, conds: Cond[]) => conds.every((c) => c.values.some((v) => row[c.col] === v));

function literal(token: string, take: () => unknown): unknown {
  const t = token.trim();
  if (t === "?") return take();
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (t === "NULL") return null;
  throw new Error(`fakeInventoryDb: unsupported VALUES token: ${t}`);
}

export function createFakeInventoryDb(seed: Partial<Tables> = {}): FakeInventoryDb {
  const db: FakeInventoryDb = {
    tables: Object.fromEntries(TABLES.map((t) => [t, (seed[t] ?? []).map((r) => ({ ...r }))])),
    statements: [],
    failOn: () => {},
    run: async () => [[], undefined],
    transaction: async (fn) => fn({ query: db.run }),
  };

  let failure: { pattern: RegExp; error: Error } | null = null;
  db.failOn = (pattern, error = Object.assign(new Error("boom"), { code: "ER_SOMETHING" })) => {
    failure = { pattern, error };
  };

  db.run = async (rawSql: string, params: unknown[] = []) => {
    const sql = norm(rawSql);
    db.statements.push(sql);
    if (failure && failure.pattern.test(sql)) {
      const { error } = failure;
      failure = null;
      throw error;
    }
    let i = 0;
    const take = () => {
      if (i >= params.length) throw new Error(`fakeInventoryDb: not enough params for ${sql}`);
      return params[i++];
    };

    // ── INSERT ──
    let m = /^INSERT (IGNORE )?INTO (\w+) \(([^)]+)\) VALUES (.+)$/.exec(sql);
    if (m) {
      const [, ignore, table, colList, valuesPart] = m;
      const cols = colList.split(",").map((c) => c.trim());
      const groups = [...valuesPart.matchAll(/\(([^)]*)\)/g)].map((g) => g[1]);
      const rows = db.tables[table];
      if (!rows) throw new Error(`fakeInventoryDb: unknown table ${table}`);
      let affected = 0;
      for (const g of groups) {
        const values = g.split(",").map((tok) => literal(tok, take));
        const row: Row = Object.fromEntries(cols.map((c, k) => [c, values[k]]));
        if (table === "inventory_items") row.price = Number(row.price).toFixed(2); // DECIMAL comes back as a string
        const pk = PRIMARY_KEY[table] ?? "id";
        if (rows.some((r) => r[pk] === row[pk])) {
          if (ignore) continue;
          throw Object.assign(new Error(`Duplicate entry for ${table}.${pk}`), { code: "ER_DUP_ENTRY" });
        }
        if (table === "inventory_items" && rows.some((r) => r.kind === row.kind && r.code === row.code)) {
          throw Object.assign(new Error("Duplicate entry for idx_ii_kind_code"), { code: "ER_DUP_ENTRY" });
        }
        rows.push(row);
        affected++;
      }
      if (i !== params.length) throw new Error(`fakeInventoryDb: ${params.length - i} unused params in ${sql}`);
      return [{ affectedRows: affected }, undefined];
    }

    // ── SELECT ──
    m = /^SELECT (.+?) FROM (\w+)(?: (\w+))?( LEFT JOIN suppliers s ON s\.id = i\.supplierId)? WHERE (.+?)(?: ORDER BY (.+?))?( FOR UPDATE)?$/.exec(sql);
    if (m) {
      const [, projection, table, , join, where, orderBy] = m;
      const conds = parseWhere(where, take);
      let rows = (db.tables[table] ?? []).filter((r) => matches(r, conds)).map((r) => ({ ...r }));
      if (join) {
        rows = rows.map((r) => ({
          ...r,
          supplierCurrentName: db.tables.suppliers.find((s) => s.id === r.supplierId)?.companyName ?? null,
        }));
      }
      if (orderBy) {
        const om = /^(?:\w+\.)?(\w+)( DESC)?$/.exec(orderBy.trim());
        if (!om) throw new Error(`fakeInventoryDb: unsupported ORDER BY ${orderBy}`);
        const [, col, desc] = om;
        rows.sort((a, b) => {
          const x = a[col] as string | number;
          const y = b[col] as string | number;
          const c = x < y ? -1 : x > y ? 1 : 0;
          return desc ? -c : c;
        });
      }
      const proj = projection.trim();
      if (proj === "*" || proj === "i.*, s.companyName AS supplierCurrentName") return [rows, []];
      const max = /^MAX\((\w+)\) AS (\w+)$/.exec(proj);
      if (max) {
        const vals = rows.map((r) => Number(r[max[1]]));
        return [[{ [max[2]]: vals.length ? Math.max(...vals) : null }], []];
      }
      if (/^\w+$/.test(proj)) return [rows.map((r) => ({ [proj]: r[proj] })), []];
      throw new Error(`fakeInventoryDb: unsupported projection ${proj}`);
    }

    // ── UPDATE ──
    m = /^UPDATE (\w+) SET (.+?) WHERE (.+)$/.exec(sql);
    if (m) {
      const [, table, setPart, where] = m;
      const sets = setPart.split(",").map((s) => {
        const sm = /^(\w+) = \?$/.exec(s.trim());
        if (!sm) throw new Error(`fakeInventoryDb: unsupported SET ${s}`);
        return { col: sm[1], value: take() };
      });
      const conds = parseWhere(where, take);
      let affected = 0;
      for (const r of db.tables[table] ?? []) {
        if (!matches(r, conds)) continue;
        for (const s of sets) r[s.col] = table === "inventory_items" && s.col === "price" ? Number(s.value).toFixed(2) : s.value;
        affected++;
      }
      return [{ affectedRows: affected }, undefined];
    }

    // ── DELETE ──
    m = /^DELETE FROM (\w+) WHERE (.+)$/.exec(sql);
    if (m) {
      const [, table, where] = m;
      const conds = parseWhere(where, take);
      const before = db.tables[table].length;
      db.tables[table] = db.tables[table].filter((r) => !matches(r, conds));
      return [{ affectedRows: before - db.tables[table].length }, undefined];
    }

    throw new Error(`fakeInventoryDb: unrecognised statement: ${sql}`);
  };

  db.transaction = async (fn) => {
    const snapshot = clone(db.tables);
    try {
      return await fn({ query: db.run });
    } catch (error) {
      db.tables = snapshot;
      throw error;
    }
  };

  return db;
}
