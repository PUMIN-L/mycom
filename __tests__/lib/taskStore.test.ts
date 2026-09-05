// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// A single transaction connection whose queries we script per test, matching
// the pattern in crmStore.test.ts / quotationSave.test.ts. `withTransaction` is
// mocked so the REAL transaction body runs — several tests below replace that
// mock with one that rolls back (or retries) exactly as db.ts does.
const conn = { query: vi.fn() };
const topQuery = vi.fn();
const runTransaction = vi.fn();

vi.mock('@/app/lib/db', () => ({
  query: (...args: unknown[]) => topQuery(...args),
  withTransaction: (...args: unknown[]) => runTransaction(...args),
}));

import {
  listTopics,
  getTopic,
  addTopic,
  updateTopic,
  setTopicActive,
  reorderTopics,
  deleteTopic,
  listTasks,
  getTask,
  addTask,
  updateTask,
  completeTask,
  reopenTask,
  deleteTask,
  addTaskLink,
  removeTaskLink,
  replaceTaskLinks,
  countDueTasks,
  buildLinkLabel,
  TaskValidationError,
  TopicInUseError,
  UNASSIGNED_TOPIC_NAME,
} from '@/app/lib/taskStore';

/** Generic "the write worked / the read found nothing" answer. */
function defaultAnswer(sql: string) {
  return /^\s*SELECT/i.test(sql)
    ? Promise.resolve([[]])
    : Promise.resolve([{ affectedRows: 1 }]);
}

beforeEach(() => {
  vi.clearAllMocks();
  conn.query.mockReset().mockImplementation((sql: string) => defaultAnswer(sql));
  topQuery.mockReset().mockImplementation((sql: string) => defaultAnswer(sql));
  runTransaction
    .mockReset()
    .mockImplementation(async (fn: (c: typeof conn) => Promise<unknown>) => fn(conn));
});

const sqlOf = (call: unknown[]) => String(call[0]);
const topCalls = (pattern: RegExp) => topQuery.mock.calls.filter((c) => pattern.test(sqlOf(c)));
const connCalls = (pattern: RegExp) => conn.query.mock.calls.filter((c) => pattern.test(sqlOf(c)));

// ── An in-memory crm_tasks / task_links pair with real transaction semantics ──
//
// task_links has NO foreign key (not even on taskId), so "the task and its links
// land together or not at all" is the store's own job. These tests therefore run
// the real transaction body against tiny tables and roll them back on failure,
// exactly as db.ts's withTransaction does — a lost DELETE or a half-written link
// set shows up as wrong ROWS here, not as a missing string in a SQL assertion.
type TaskRow = {
  id: string;
  topicId: number;
  title: string;
  detail: string | null;
  dueDate: string | null;
  status: string;
  completedAt: string | null;
  createdAt: string;
};
type LinkRow = {
  taskId: string;
  targetType: string;
  targetId: string;
  label: string;
  createdAt: string;
};
type TxStore = { tasks: TaskRow[]; links: LinkRow[] };

function newStore(seed: Partial<TxStore> = {}): TxStore {
  return { tasks: seed.tasks ?? [], links: seed.links ?? [] };
}

/** A tiny SQL interpreter over `store`. `failOnLinkInsert` makes the Nth
 * (1-based) task_links INSERT blow up, to prove the whole write is undone. */
function storeInterpreter(store: TxStore, opts: { failOnLinkInsert?: number } = {}) {
  let linkInserts = 0;
  return (sql: string, params: unknown[] = []) => {
    const text = String(sql).trim();

    if (/^INSERT INTO crm_tasks/i.test(text)) {
      const [id, topicId, title, detail, dueDate, createdAt] = params as [
        string, number, string, string | null, string | null, string,
      ];
      if (store.tasks.some((t) => t.id === id)) {
        return Promise.reject({ code: 'ER_DUP_ENTRY', message: `Duplicate entry '${id}'` });
      }
      store.tasks.push({
        id, topicId, title, detail, dueDate, status: 'pending', completedAt: null, createdAt,
      });
      return Promise.resolve([{ affectedRows: 1 }]);
    }

    if (/^INSERT INTO task_links/i.test(text)) {
      linkInserts += 1;
      if (opts.failOnLinkInsert === linkInserts) {
        return Promise.reject(
          Object.assign(new Error('lost'), { code: 'PROTOCOL_CONNECTION_LOST' })
        );
      }
      const [taskId, targetType, targetId, label, createdAt] = params as string[];
      const existing = store.links.find(
        (l) => l.taskId === taskId && l.targetType === targetType && l.targetId === targetId
      );
      if (existing) {
        // `ON DUPLICATE KEY UPDATE label = label` — the row keeps its ORIGINAL
        // snapshot. Without that clause the PK would raise instead.
        if (!/ON DUPLICATE KEY UPDATE/i.test(text)) {
          return Promise.reject({ code: 'ER_DUP_ENTRY', message: 'Duplicate entry for PRIMARY' });
        }
        return Promise.resolve([{ affectedRows: 0 }]);
      }
      store.links.push({ taskId, targetType, targetId, label, createdAt });
      return Promise.resolve([{ affectedRows: 1 }]);
    }

    if (/^DELETE FROM task_links WHERE taskId = \?/i.test(text)) {
      const [taskId] = params as string[];
      const before = store.links.length;
      store.links = store.links.filter((l) => l.taskId !== taskId);
      return Promise.resolve([{ affectedRows: before - store.links.length }]);
    }

    if (/^DELETE FROM crm_tasks WHERE id = \?/i.test(text)) {
      const [id] = params as string[];
      const before = store.tasks.length;
      store.tasks = store.tasks.filter((t) => t.id !== id);
      return Promise.resolve([{ affectedRows: before - store.tasks.length }]);
    }

    return defaultAnswer(text);
  };
}

/** Wires the transaction connection to `store`. */
function mountTxStore(store: TxStore, opts: { failOnLinkInsert?: number } = {}) {
  conn.query.mockImplementation(storeInterpreter(store, opts));
}

/** Wires the non-transactional `query()` to `store` as well, for the store
 * functions that write outside a transaction. */
function mountQueryStore(store: TxStore) {
  topQuery.mockImplementation(storeInterpreter(store));
}

function snapshotOf(store: TxStore) {
  return { tasks: store.tasks.map((t) => ({ ...t })), links: store.links.map((l) => ({ ...l })) };
}

function restore(store: TxStore, snapshot: ReturnType<typeof snapshotOf>) {
  store.tasks = snapshot.tasks;
  store.links = snapshot.links;
}

/** withTransaction that ROLLS BACK the in-memory tables when the body throws. */
function mountRollbackTransaction(store: TxStore) {
  runTransaction.mockImplementation(async (fn: (c: typeof conn) => Promise<unknown>) => {
    const snapshot = snapshotOf(store);
    try {
      return await fn(conn);
    } catch (error) {
      restore(store, snapshot);
      throw error;
    }
  });
}

/** withTransaction that behaves like db.ts on a transient connection loss:
 * roll the first attempt back, then run the SAME callback again. */
function mountRetryingTransaction(store: TxStore) {
  runTransaction.mockImplementation(async (fn: (c: typeof conn) => Promise<unknown>) => {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const snapshot = snapshotOf(store);
      try {
        return await fn(conn);
      } catch (error) {
        restore(store, snapshot);
        if (attempt === 2) throw error;
      }
    }
  });
}

// ── Topics ───────────────────────────────────────────────────────────────────

describe('listTopics / getTopic', () => {
  it('hides retired topics by default and includes them on request', async () => {
    topQuery.mockResolvedValue([[]]);

    await listTopics();
    expect(sqlOf(topQuery.mock.calls[0])).toContain('WHERE isActive = 1');

    await listTopics(true);
    expect(sqlOf(topQuery.mock.calls[1])).not.toContain('WHERE isActive');
    expect(sqlOf(topQuery.mock.calls[1])).toContain('ORDER BY sortOrder ASC, id ASC');
  });

  it('maps TINYINT(1) isActive to a real boolean', async () => {
    topQuery.mockResolvedValue([
      [
        { id: 1, name: 'โทรหาลูกค้า', icon: '📞', color: 'blue', sortOrder: 1, isActive: 1, createdAt: 'c' },
        { id: 2, name: 'ซ่อน', icon: '', color: 'slate', sortOrder: 2, isActive: 0, createdAt: 'c' },
      ],
    ]);

    const topics = await listTopics(true);
    expect(topics[0].isActive).toBe(true);
    expect(topics[1].isActive).toBe(false);
  });

  it('getTopic returns null when the row is gone', async () => {
    topQuery.mockResolvedValue([[]]);
    expect(await getTopic(42)).toBeNull();
  });
});

describe('addTopic', () => {
  function mockMaxIdThenInsert(maxIds: (number | null)[], insertResults: ('ok' | 'dup')[]) {
    let reads = 0;
    let writes = 0;
    topQuery.mockImplementation((sql: string) => {
      if (/SELECT MAX\(id\) AS maxId FROM task_topics/.test(sql)) {
        const maxId = maxIds[Math.min(reads, maxIds.length - 1)];
        reads += 1;
        return Promise.resolve([[{ maxId }]]);
      }
      const outcome = insertResults[Math.min(writes, insertResults.length - 1)];
      writes += 1;
      if (outcome === 'dup') {
        return Promise.reject({ code: 'ER_DUP_ENTRY', message: 'Duplicate entry for PRIMARY' });
      }
      return Promise.resolve([{ affectedRows: 1 }]);
    });
  }

  it('allocates id = MAX(id) + 1', async () => {
    mockMaxIdThenInsert([7], ['ok']);

    const topic = await addTopic({ name: 'ทวงหนี้', icon: '💸', color: 'teal' });

    expect(topic).toMatchObject({ id: 8, name: 'ทวงหนี้', icon: '💸', color: 'teal', isActive: true });
    expect(topic.sortOrder).toBe(8); // new topics land at the end of the board
    expect(Number.isNaN(Date.parse(topic.createdAt))).toBe(false);
  });

  it('starts at 1 on an empty table', async () => {
    mockMaxIdThenInsert([null], ['ok']);
    expect((await addTopic({ name: 'อื่นๆ' })).id).toBe(1);
  });

  it('re-reads the max and retries on ER_DUP_ENTRY instead of failing the request', async () => {
    // Two admins adding a topic at once both compute id 6; the loser must land
    // on 7, not surface a duplicate-key error.
    mockMaxIdThenInsert([5, 6], ['dup', 'ok']);

    const topic = await addTopic({ name: 'นัดส่งของ' });

    expect(topic.id).toBe(7);
    expect(topCalls(/INSERT INTO task_topics/)).toHaveLength(2);
  });

  it('gives up after 5 attempts and rethrows the duplicate error', async () => {
    mockMaxIdThenInsert([5], ['dup']);

    await expect(addTopic({ name: 'ชนตลอด' })).rejects.toMatchObject({ code: 'ER_DUP_ENTRY' });
    expect(topCalls(/INSERT INTO task_topics/)).toHaveLength(5);
  });

  it('strips HTML from the name and rejects an empty one', async () => {
    mockMaxIdThenInsert([0], ['ok']);
    expect((await addTopic({ name: '<b>โทรหาลูกค้า</b>' })).name).toBe('โทรหาลูกค้า');

    await expect(addTopic({ name: '   ' })).rejects.toBeInstanceOf(TaskValidationError);
    await expect(addTopic({ name: '<script>x</script>' })).rejects.toBeInstanceOf(TaskValidationError);
  });

  it('accepts only a colour TOKEN, never a raw CSS value', async () => {
    mockMaxIdThenInsert([0], ['ok']);

    expect((await addTopic({ name: 'a', color: 'amber' })).color).toBe('amber');
    // A raw value here would end up in a class/style attribute downstream.
    await expect(addTopic({ name: 'a', color: '#ff0000' })).rejects.toBeInstanceOf(TaskValidationError);
    await expect(addTopic({ name: 'a', color: 'bg-red-500' })).rejects.toBeInstanceOf(TaskValidationError);
    // Omitted → the first token, never an empty string.
    expect((await addTopic({ name: 'a' })).color).toBe('blue');
  });

  it('trims the emoji by CODE POINT so a surrogate pair is never cut in half', async () => {
    mockMaxIdThenInsert([0], ['ok']);

    const topic = await addTopic({ name: 'a', icon: '👨‍👩‍👧‍👦🚗📞🔧📄💸📌🎯🔥' });

    const input = '👨‍👩‍👧‍👦🚗📞🔧📄💸📌🎯🔥';
    // Eight CODE POINTS, which is the whole ZWJ family sequence plus one car —
    // not the eight UTF-16 units a plain substring would keep, which lop the
    // family sequence apart mid-emoji.
    expect([...topic.icon]).toHaveLength(8);
    expect(topic.icon).toBe([...input].slice(0, 8).join(''));
    expect(topic.icon).not.toBe(input.substring(0, 8));
    const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    expect(loneSurrogate.test(topic.icon)).toBe(false);
  });
});

describe('updateTopic / setTopicActive', () => {
  it('renames without rewriting a single task row', async () => {
    topQuery.mockResolvedValue([{ affectedRows: 1 }]);

    expect(await updateTopic(3, { name: 'ใบเสนอราคาค้าง', color: 'rose' })).toBe(true);

    const [sql, params] = topQuery.mock.calls[0];
    expect(sql).toContain('UPDATE task_topics SET');
    expect(params).toEqual(['ใบเสนอราคาค้าง', 'rose', 3]);
    // Tasks reference topicId, not the name — every task shows the new heading
    // with no write of its own.
    expect(topCalls(/crm_tasks/)).toHaveLength(0);
  });

  it('issues nothing at all when no field was supplied', async () => {
    expect(await updateTopic(3, {})).toBe(false);
    expect(topQuery).not.toHaveBeenCalled();
  });

  it('hiding a topic is a flag flip — never a DELETE, and never touches its tasks', async () => {
    topQuery.mockResolvedValue([{ affectedRows: 1 }]);

    expect(await setTopicActive(4, false)).toBe(true);

    const [sql, params] = topQuery.mock.calls[0];
    expect(sql).toBe('UPDATE task_topics SET isActive = ? WHERE id = ?');
    expect(params).toEqual([0, 4]);
    expect(topCalls(/DELETE/i)).toHaveLength(0);
    expect(topCalls(/crm_tasks/)).toHaveLength(0);
  });

  it('reports false when the topic does not exist', async () => {
    topQuery.mockResolvedValue([{ affectedRows: 0 }]);
    expect(await setTopicActive(99, true)).toBe(false);
  });

  it('still lists the tasks filed under a hidden topic, with their badge intact', async () => {
    topQuery.mockImplementation((sql: string) => {
      if (/FROM crm_tasks t/.test(sql)) {
        return Promise.resolve([
          [
            {
              id: 't1', topicId: 4, title: 'นัดเข้า Service ให้เจ้าเก่า', detail: null,
              dueDate: null, status: 'pending', completedAt: null, createdAt: '2026-09-01T00:00:00.000Z',
              topicName: 'นัดเข้า Service', topicIcon: '🔧', topicColor: 'purple',
            },
          ],
        ]);
      }
      return Promise.resolve([[]]);
    });

    const tasks = await listTasks({ topicId: 4 });

    expect(tasks).toHaveLength(1);
    expect(tasks[0].topicName).toBe('นัดเข้า Service');
    expect(topCalls(/DELETE/i)).toHaveLength(0);
  });
});

describe('reorderTopics', () => {
  it('writes every sortOrder in ONE transaction, in the submitted order', async () => {
    expect(await reorderTopics([5, 1, 3])).toBe(true);

    expect(runTransaction).toHaveBeenCalledTimes(1);
    const updates = connCalls(/UPDATE task_topics SET sortOrder = \?/);
    expect(updates.map((c) => c[1])).toEqual([
      [1, 5],
      [2, 1],
      [3, 3],
    ]);
  });

  it('ignores an id that no longer exists instead of failing the whole reorder', async () => {
    // A stale tab submits a topic that has since been deleted: its UPDATE
    // matches nothing, and every other topic must still be reordered.
    conn.query.mockImplementation((_sql: string, params: unknown[] = []) =>
      Promise.resolve([{ affectedRows: (params as number[])[1] === 999 ? 0 : 1 }])
    );

    expect(await reorderTopics([1, 999, 2])).toBe(true);
    expect(connCalls(/UPDATE task_topics SET sortOrder = \?/)).toHaveLength(3);
  });

  it('does nothing (and opens no transaction) for an empty or non-numeric list', async () => {
    expect(await reorderTopics([])).toBe(true);
    expect(await reorderTopics(['x' as unknown as number])).toBe(true);
    expect(runTransaction).not.toHaveBeenCalled();
  });
});

describe('deleteTopic', () => {
  function mockTaskCount(count: number, deleted = 1) {
    topQuery.mockImplementation((sql: string) => {
      if (/SELECT COUNT\(\*\) AS cnt FROM crm_tasks/.test(sql)) {
        return Promise.resolve([[{ cnt: count }]]);
      }
      return Promise.resolve([{ affectedRows: deleted }]);
    });
  }

  it('refuses while ANY task references the topic — and deletes nothing', async () => {
    mockTaskCount(3);

    await expect(deleteTopic(2)).rejects.toBeInstanceOf(TopicInUseError);
    // topicId is a soft reference with no FK: deleting here would silently
    // orphan three tasks and lose the history behind them.
    expect(topCalls(/DELETE/i)).toHaveLength(0);
  });

  it('carries the topic id and task count on the error so the caller can explain itself', async () => {
    mockTaskCount(7);

    const error: unknown = await deleteTopic(2).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TopicInUseError);
    const inUse = error as TopicInUseError;
    expect(inUse.topicId).toBe(2);
    expect(inUse.taskCount).toBe(7);
    expect(inUse.message).toContain('ซ่อน'); // tells the admin to hide it instead
  });

  it('counts DONE tasks too, not just pending ones', async () => {
    mockTaskCount(1);
    await expect(deleteTopic(2)).rejects.toBeInstanceOf(TopicInUseError);

    const [sql] = topQuery.mock.calls[0];
    expect(sql).toContain('SELECT COUNT(*) AS cnt FROM crm_tasks WHERE topicId = ?');
    expect(sql).not.toContain("status");
  });

  it('deletes a topic nothing references', async () => {
    mockTaskCount(0);

    expect(await deleteTopic(9)).toBe(true);
    const deletes = topCalls(/DELETE FROM task_topics WHERE id = \?/);
    expect(deletes).toHaveLength(1);
    expect(deletes[0][1]).toEqual([9]);
  });

  it('returns false for a topic that is already gone', async () => {
    mockTaskCount(0, 0);
    expect(await deleteTopic(9)).toBe(false);
  });
});

// ── Tasks ────────────────────────────────────────────────────────────────────

describe('listTasks / getTask', () => {
  function mockRows(rows: Record<string, unknown>[], links: Record<string, unknown>[] = []) {
    topQuery.mockImplementation((sql: string) => {
      if (/FROM crm_tasks t/.test(sql)) return Promise.resolve([rows]);
      if (/FROM task_links WHERE taskId IN/.test(sql)) return Promise.resolve([links]);
      return Promise.resolve([[]]);
    });
  }

  const row = (over: Record<string, unknown> = {}) => ({
    id: 't1', topicId: 1, title: 'โทรหาเจ้านี้', detail: null, dueDate: '2026-09-05',
    status: 'pending', completedAt: null, createdAt: '2026-09-01T00:00:00.000Z',
    topicName: 'โทรหาลูกค้า', topicIcon: '📞', topicColor: 'blue', ...over,
  });

  it('keeps a task whose topic row has vanished, under a fallback heading', async () => {
    // Data edited outside the app (or a topic row deleted directly in the DB):
    // the task must still load — never be dropped, never throw.
    mockRows([row({ id: 't-orphan', topicId: 77, topicName: null, topicIcon: null, topicColor: null })]);

    const tasks = await listTasks();

    expect(tasks).toHaveLength(1);
    expect(tasks[0].topicId).toBe(77);
    expect(tasks[0].topicName).toBe(UNASSIGNED_TOPIC_NAME);
    expect(tasks[0].topicIcon).toBe('📌');
    expect(tasks[0].topicColor).toBe('slate');
    // A LEFT JOIN is what keeps it in the result set at all.
    expect(sqlOf(topQuery.mock.calls[0])).toContain('LEFT JOIN task_topics tp ON tp.id = t.topicId');
  });

  it('loads the links for a whole page in ONE query, never one per task', async () => {
    mockRows(
      [row({ id: 't1' }), row({ id: 't2' }), row({ id: 't3' })],
      [
        { taskId: 't1', targetType: 'customer', targetId: 'c1', label: 'บริษัท เอ', createdAt: 'x' },
        { taskId: 't3', targetType: 'quotation', targetId: 'q1', label: 'QT-001', createdAt: 'x' },
      ]
    );

    const tasks = await listTasks();

    expect(topCalls(/FROM task_links WHERE taskId IN/)).toHaveLength(1);
    expect(tasks[0].links).toHaveLength(1);
    expect(tasks[1].links).toEqual([]); // never undefined
    expect(tasks[2].links![0].targetId).toBe('q1');
  });

  it('skips the link query entirely when there are no tasks', async () => {
    mockRows([]);
    expect(await listTasks()).toEqual([]);
    expect(topCalls(/FROM task_links/)).toHaveLength(0);
  });

  it('filters by topic and status, and validates the status', async () => {
    mockRows([]);

    await listTasks({ topicId: 3, status: 'done' });
    const [sql, params] = topQuery.mock.calls[0];
    expect(sql).toContain('t.topicId = ?');
    expect(sql).toContain('t.status = ?');
    expect(params).toEqual([3, 'done']);
    // The done view is ordered by most recently completed.
    expect(sql).toContain('ORDER BY t.completedAt DESC');

    await expect(listTasks({ status: 'archived' as never })).rejects.toBeInstanceOf(TaskValidationError);
  });

  it('orders the open board overdue → today → later → undated', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-05T03:00:00.000Z'));
    mockRows([]);

    await listTasks();

    const [sql, params] = topQuery.mock.calls[0];
    expect(sql).toContain('WHEN t.dueDate IS NULL OR t.dueDate = \'\' THEN 3');
    expect(sql).toContain('WHEN t.dueDate < ? THEN 0');
    expect(params).toEqual(['2026-09-05', '2026-09-05']);
    vi.useRealTimers();
  });

  it('clamps the row limit', async () => {
    mockRows([]);

    await listTasks();
    expect(sqlOf(topQuery.mock.calls[0])).toContain('LIMIT 200');

    topQuery.mockClear();
    await listTasks({ limit: 9999 });
    expect(sqlOf(topQuery.mock.calls[0])).toContain('LIMIT 500');

    topQuery.mockClear();
    await listTasks({ limit: 0 });
    expect(sqlOf(topQuery.mock.calls[0])).toContain('LIMIT 200');
  });

  it('getTask returns null for a missing id', async () => {
    mockRows([]);
    expect(await getTask('nope')).toBeNull();
  });
});

describe('addTask', () => {
  const linkInput = [
    { targetType: 'customer' as const, targetId: 'c1', label: 'บริษัท เอ' },
    { targetType: 'quotation' as const, targetId: 'q1', label: 'QT-2026-001' },
  ];

  it('writes the task and all of its links, and returns them', async () => {
    const store = newStore();
    mountTxStore(store);
    mountRollbackTransaction(store);

    const task = await addTask({
      topicId: 1, title: 'ทำใบเสนอราคาให้เจ้านี้', detail: 'ด่วน', dueDate: '2026-09-10', links: linkInput,
    });

    expect(store.tasks).toHaveLength(1);
    expect(store.tasks[0]).toMatchObject({ id: task.id, topicId: 1, status: 'pending', completedAt: null });
    expect(store.links.map((l) => l.targetId)).toEqual(['c1', 'q1']);
    expect(store.links.every((l) => l.taskId === task.id)).toBe(true);
    expect(task.links).toHaveLength(2);
  });

  it('rolls the WHOLE write back when the second link fails — no task, no links (8.8)', async () => {
    const store = newStore();
    mountTxStore(store, { failOnLinkInsert: 2 });
    mountRollbackTransaction(store);

    await expect(
      addTask({ topicId: 1, title: 'งานที่ต้องหายไปทั้งก้อน', links: linkInput })
    ).rejects.toMatchObject({ code: 'PROTOCOL_CONNECTION_LOST' });

    expect(store.tasks).toEqual([]);
    expect(store.links).toEqual([]);
  });

  it('a retried transaction leaves ONE task and ONE row per link — no duplicate id, no duplicate links (8.9)', async () => {
    const store = newStore();
    mountTxStore(store, { failOnLinkInsert: 2 }); // only the FIRST attempt's 2nd insert
    mountRetryingTransaction(store);

    const task = await addTask({ topicId: 1, title: 'ต้องรอดหลัง retry', links: linkInput });

    expect(store.tasks.map((t) => t.id)).toEqual([task.id]);
    expect(store.links).toHaveLength(2);
    expect(new Set(store.links.map((l) => `${l.targetType}:${l.targetId}`)).size).toBe(2);
    expect(store.links.every((l) => l.taskId === task.id)).toBe(true);
    // The id is minted INSIDE the callback, so the abandoned attempt's id is
    // not replayed on top of the surviving row.
    expect(connCalls(/INSERT INTO crm_tasks/)).toHaveLength(2);
    const ids = connCalls(/INSERT INTO crm_tasks/).map((c) => (c[1] as string[])[0]);
    expect(ids[0]).not.toBe(ids[1]);
    expect(ids[1]).toBe(task.id);
  });

  it('de-duplicates a link set that names the same target twice (8.11)', async () => {
    const store = newStore();
    mountTxStore(store);
    mountRollbackTransaction(store);

    const task = await addTask({
      topicId: 1,
      title: 'ผูกซ้ำ',
      links: [
        { targetType: 'customer', targetId: 'c1', label: 'บริษัท เอ' },
        { targetType: 'customer', targetId: 'c1', label: 'บริษัท เอ (พิมพ์ซ้ำ)' },
      ],
    });

    expect(store.links).toHaveLength(1);
    expect(store.links[0].label).toBe('บริษัท เอ'); // the FIRST snapshot wins
    expect(task.links).toHaveLength(1);
  });

  it('re-linking an existing key is a no-op that keeps the original snapshot, not a PK error (8.11)', async () => {
    const store = newStore({
      links: [
        { taskId: 't1', targetType: 'customer', targetId: 'c1', label: 'ชื่อเดิม', createdAt: 'old' },
      ],
    });
    // Driven through the same interpreter: without the ON DUPLICATE clause the
    // composite PK would raise ER_DUP_ENTRY here.
    mountQueryStore(store);

    await addTaskLink('t1', { targetType: 'customer', targetId: 'c1', label: 'ชื่อใหม่' });

    expect(store.links).toHaveLength(1);
    expect(store.links[0]).toEqual({
      taskId: 't1', targetType: 'customer', targetId: 'c1', label: 'ชื่อเดิม', createdAt: 'old',
    });
    expect(sqlOf(topQuery.mock.calls[0])).toContain('ON DUPLICATE KEY UPDATE label = label');
  });

  it('sanitizes what it stores and rejects bad input BEFORE opening a transaction', async () => {
    const store = newStore();
    mountTxStore(store);
    mountRollbackTransaction(store);

    const task = await addTask({ topicId: 2, title: '<b>โทรหาเจ้านี้</b>', detail: '<i>ด่วน</i>' });
    expect(task.title).toBe('โทรหาเจ้านี้');
    expect(task.detail).toBe('ด่วน');

    runTransaction.mockClear();
    await expect(addTask({ topicId: 0, title: 'x' })).rejects.toBeInstanceOf(TaskValidationError);
    await expect(addTask({ topicId: 1, title: '  ' })).rejects.toBeInstanceOf(TaskValidationError);
    await expect(addTask({ topicId: 1, title: 'x', dueDate: '10/09/2026' })).rejects.toBeInstanceOf(TaskValidationError);
    await expect(
      addTask({ topicId: 1, title: 'x', links: [{ targetType: 'invoice' as never, targetId: 'i1' }] })
    ).rejects.toBeInstanceOf(TaskValidationError);
    await expect(
      addTask({ topicId: 1, title: 'x', links: [{ targetType: 'customer', targetId: '  ' }] })
    ).rejects.toBeInstanceOf(TaskValidationError);
    expect(runTransaction).not.toHaveBeenCalled();
    expect(store.tasks).toHaveLength(1); // only the valid one above
  });

  it('stores an empty detail and an absent due date as NULL', async () => {
    const store = newStore();
    mountTxStore(store);
    mountRollbackTransaction(store);

    const task = await addTask({ topicId: 1, title: 'ไม่มีกำหนด', detail: '   ' });

    expect(task.detail).toBeNull();
    expect(task.dueDate).toBeNull();
    expect(store.tasks[0].dueDate).toBeNull();
  });
});

describe('updateTask', () => {
  it('CLEARS the due date when it is sent as null, and leaves it alone when omitted (8.13)', async () => {
    topQuery.mockImplementation((sql: string) => defaultAnswer(sql));

    await updateTask('t1', { dueDate: null });
    const cleared = topCalls(/UPDATE crm_tasks SET/)[0];
    expect(sqlOf(cleared)).toContain('dueDate = ?');
    expect((cleared[1] as unknown[])[0]).toBeNull();

    topQuery.mockClear();
    await updateTask('t1', { dueDate: '' });
    expect((topCalls(/UPDATE crm_tasks SET/)[0][1] as unknown[])[0]).toBeNull();

    topQuery.mockClear();
    await updateTask('t1', { title: 'แค่เปลี่ยนชื่อ' });
    const titleOnly = topCalls(/UPDATE crm_tasks SET/)[0];
    expect(sqlOf(titleOnly)).not.toContain('dueDate');
    expect(titleOnly[1]).toEqual(['แค่เปลี่ยนชื่อ', 't1']);
  });

  it('issues no UPDATE at all for an empty patch', async () => {
    topQuery.mockImplementation((sql: string) => defaultAnswer(sql));
    await updateTask('t1', {});
    expect(topCalls(/UPDATE crm_tasks/)).toHaveLength(0);
  });

  it('closing a task keeps the ORIGINAL completion time when it was already done (8.12)', async () => {
    topQuery.mockImplementation((sql: string) => defaultAnswer(sql));

    await updateTask('t1', { status: 'done' });

    const [sql] = topCalls(/UPDATE crm_tasks SET/)[0];
    // completedAt is assigned before status, so it still sees the OLD status.
    expect(sql).toContain("completedAt = CASE WHEN status = 'done' THEN completedAt ELSE ? END");
    expect(sql).toContain("status = 'done'");
  });

  it('reopening clears completedAt (8.12)', async () => {
    topQuery.mockImplementation((sql: string) => defaultAnswer(sql));

    await updateTask('t1', { status: 'pending' });

    const [sql] = topCalls(/UPDATE crm_tasks SET/)[0];
    expect(sql).toContain("status = 'pending'");
    expect(sql).toContain('completedAt = NULL');
  });

  it('rejects a status outside pending/done', async () => {
    await expect(updateTask('t1', { status: 'archived' as never })).rejects.toBeInstanceOf(TaskValidationError);
    expect(topCalls(/UPDATE crm_tasks/)).toHaveLength(0);
  });

  it('replaces the whole link set and the row together, in one transaction', async () => {
    const store = newStore({
      tasks: [
        { id: 't1', topicId: 1, title: 'เดิม', detail: null, dueDate: null, status: 'pending', completedAt: null, createdAt: 'c' },
      ],
      links: [
        { taskId: 't1', targetType: 'customer', targetId: 'c-old', label: 'เจ้าเก่า', createdAt: 'old' },
        { taskId: 't2', targetType: 'customer', targetId: 'c-other', label: 'งานอื่น', createdAt: 'old' },
      ],
    });
    mountTxStore(store);
    mountRollbackTransaction(store);

    await updateTask('t1', { title: 'ใหม่', links: [{ targetType: 'equipment', targetId: 'eq-1', label: 'เครื่อง A' }] });

    expect(runTransaction).toHaveBeenCalledTimes(1);
    expect(store.links.filter((l) => l.taskId === 't1')).toEqual([
      expect.objectContaining({ targetType: 'equipment', targetId: 'eq-1', label: 'เครื่อง A' }),
    ]);
    // Another task's links are untouched.
    expect(store.links.filter((l) => l.taskId === 't2')).toHaveLength(1);
  });

  it('an empty links array clears the set without deleting the task', async () => {
    const store = newStore({
      tasks: [
        { id: 't1', topicId: 1, title: 'เดิม', detail: null, dueDate: null, status: 'pending', completedAt: null, createdAt: 'c' },
      ],
      links: [{ taskId: 't1', targetType: 'customer', targetId: 'c1', label: 'เจ้าเก่า', createdAt: 'old' }],
    });
    mountTxStore(store);
    mountRollbackTransaction(store);

    await updateTask('t1', { links: [] });

    expect(store.links).toEqual([]);
    expect(store.tasks).toHaveLength(1);
  });
});

describe('completeTask / reopenTask', () => {
  it('a second complete cannot overwrite the first completion time (8.12)', async () => {
    topQuery.mockImplementation((sql: string) => defaultAnswer(sql));

    await completeTask('t1');

    const [sql, params] = topCalls(/UPDATE crm_tasks SET status = 'done'/)[0];
    expect(sql).toContain("AND status <> 'done'");
    expect(Number.isNaN(Date.parse(String((params as unknown[])[0])))).toBe(false);
    expect((params as unknown[])[1]).toBe('t1');
  });

  it('reopen sets status back to pending and clears completedAt', async () => {
    topQuery.mockImplementation((sql: string) => defaultAnswer(sql));

    await reopenTask('t1');

    const [sql, params] = topCalls(/UPDATE crm_tasks SET status = 'pending'/)[0];
    expect(sql).toContain('completedAt = NULL');
    expect(params).toEqual(['t1']);
  });

  it('neither ever deletes anything', async () => {
    topQuery.mockImplementation((sql: string) => defaultAnswer(sql));
    await completeTask('t1');
    await reopenTask('t1');
    expect(topCalls(/DELETE/i)).toHaveLength(0);
  });
});

describe('deleteTask', () => {
  it('removes its OWN task_links rows in the same transaction and touches nothing else (8.26)', async () => {
    const store = newStore({
      tasks: [
        { id: 't1', topicId: 1, title: 'ลบทิ้ง', detail: null, dueDate: null, status: 'pending', completedAt: null, createdAt: 'c' },
        { id: 't2', topicId: 1, title: 'อยู่ต่อ', detail: null, dueDate: null, status: 'pending', completedAt: null, createdAt: 'c' },
      ],
      links: [
        { taskId: 't1', targetType: 'customer', targetId: 'c1', label: 'บริษัท เอ', createdAt: 'x' },
        { taskId: 't1', targetType: 'quotation', targetId: 'q1', label: 'QT-001', createdAt: 'x' },
        { taskId: 't2', targetType: 'customer', targetId: 'c1', label: 'บริษัท เอ', createdAt: 'x' },
      ],
    });
    mountTxStore(store);
    mountRollbackTransaction(store);

    expect(await deleteTask('t1')).toBe(true);

    expect(runTransaction).toHaveBeenCalledTimes(1);
    expect(store.tasks.map((t) => t.id)).toEqual(['t2']);
    // task_links has no FK and therefore no ON DELETE CASCADE — the store must
    // clear its own rows, and only its own.
    expect(store.links).toEqual([
      expect.objectContaining({ taskId: 't2', targetId: 'c1' }),
    ]);

    // The link TARGETS are never touched: no statement leaves these two tables.
    const touched = conn.query.mock.calls.map(sqlOf);
    expect(touched.every((sql) => /crm_tasks|task_links/.test(sql))).toBe(true);
    expect(touched.some((sql) => /customers|customer_equipments|quotations|documents/i.test(sql))).toBe(false);
  });

  it('deletes the links BEFORE the task, so a failure cannot strand link rows', async () => {
    const store = newStore({
      tasks: [
        { id: 't1', topicId: 1, title: 'x', detail: null, dueDate: null, status: 'pending', completedAt: null, createdAt: 'c' },
      ],
    });
    mountTxStore(store);
    mountRollbackTransaction(store);

    await deleteTask('t1');

    const order = conn.query.mock.calls.map(sqlOf);
    expect(order.findIndex((s) => /DELETE FROM task_links/.test(s))).toBeLessThan(
      order.findIndex((s) => /DELETE FROM crm_tasks/.test(s))
    );
  });

  it('returns false when the task was already gone', async () => {
    const store = newStore();
    mountTxStore(store);
    mountRollbackTransaction(store);

    expect(await deleteTask('missing')).toBe(false);
  });
});

// ── Links ────────────────────────────────────────────────────────────────────

describe('link labels are snapshots', () => {
  it('builds one label per target type, from the target as it reads TODAY', () => {
    expect(buildLinkLabel('customer', { name: 'สมชาย', companyName: 'บริษัท เอ' })).toBe('สมชาย (บริษัท เอ)');
    expect(buildLinkLabel('customer', { companyName: 'บริษัท เอ' })).toBe('บริษัท เอ');
    expect(buildLinkLabel('customer', { name: 'สมชาย' })).toBe('สมชาย');
    expect(buildLinkLabel('equipment', { productName: 'กล้อง X', serialNumber: 'SN-1' })).toBe('กล้อง X (S/N SN-1)');
    expect(buildLinkLabel('equipment', { serialNumber: 'SN-1' })).toBe('S/N SN-1');
    expect(buildLinkLabel('quotation', { docNo: 'QT-2026-001' })).toBe('QT-2026-001');
    expect(buildLinkLabel('document', { title: 'ใบส่งของ 001' })).toBe('ใบส่งของ 001');
    expect(buildLinkLabel('document', { title: '<b>ใบส่งของ</b>' })).toBe('ใบส่งของ');
  });

  it('a link keeps the label it was created with after the target is gone (8.10)', async () => {
    // The store never re-syncs a label, and never joins the target table — the
    // snapshot is the only thing keeping the chip readable once the quotation
    // has been purged by the 2-year retention job.
    topQuery.mockImplementation((sql: string) => {
      if (/FROM crm_tasks t/.test(sql)) {
        return Promise.resolve([
          [
            {
              id: 't1', topicId: 1, title: 'ตามใบเสนอราคา', detail: null, dueDate: null,
              status: 'pending', completedAt: null, createdAt: 'c',
              topicName: 'รอทำใบเสนอราคา', topicIcon: '📄', topicColor: 'amber',
            },
          ],
        ]);
      }
      if (/FROM task_links/.test(sql)) {
        return Promise.resolve([
          [
            { taskId: 't1', targetType: 'quotation', targetId: 'q-purged', label: 'QT-2024-118', createdAt: 'x' },
          ],
        ]);
      }
      return Promise.resolve([[]]);
    });

    const task = await getTask('t1');

    expect(task!.links).toEqual([
      { taskId: 't1', targetType: 'quotation', targetId: 'q-purged', label: 'QT-2024-118', createdAt: 'x' },
    ]);
    // No attempt is made to look the (deleted) quotation up again.
    expect(topCalls(/FROM quotations/)).toHaveLength(0);
  });

  it('addTaskLink stores the caller\'s snapshot and validates the target type', async () => {
    topQuery.mockResolvedValue([{ affectedRows: 1 }]);

    const link = await addTaskLink('t1', { targetType: 'equipment', targetId: 'eq-1', label: 'กล้อง X (S/N SN-1)' });

    expect(link).toMatchObject({ taskId: 't1', targetType: 'equipment', targetId: 'eq-1', label: 'กล้อง X (S/N SN-1)' });
    expect((topQuery.mock.calls[0][1] as unknown[])[3]).toBe('กล้อง X (S/N SN-1)');

    await expect(addTaskLink('t1', { targetType: 'invoice' as never, targetId: 'i1' })).rejects.toBeInstanceOf(TaskValidationError);
  });

  it('removeTaskLink deletes exactly one link row and nothing else', async () => {
    topQuery.mockResolvedValue([{ affectedRows: 1 }]);

    expect(await removeTaskLink('t1', 'customer', 'c1')).toBe(true);

    const [sql, params] = topQuery.mock.calls[0];
    expect(sql).toBe('DELETE FROM task_links WHERE taskId = ? AND targetType = ? AND targetId = ?');
    expect(params).toEqual(['t1', 'customer', 'c1']);
    expect(topCalls(/DELETE FROM crm_tasks/)).toHaveLength(0);
  });

  it('replaceTaskLinks swaps the set in one transaction and affects only task_links', async () => {
    const store = newStore({
      links: [
        { taskId: 't1', targetType: 'customer', targetId: 'c-old', label: 'เก่า', createdAt: 'old' },
      ],
      tasks: [
        { id: 't1', topicId: 1, title: 'x', detail: null, dueDate: null, status: 'pending', completedAt: null, createdAt: 'c' },
      ],
    });
    mountTxStore(store);
    mountRollbackTransaction(store);

    const links = await replaceTaskLinks('t1', [{ targetType: 'document', targetId: 'd1', label: 'ใบส่งของ 001' }]);

    expect(links).toHaveLength(1);
    expect(store.links).toEqual([
      expect.objectContaining({ taskId: 't1', targetType: 'document', targetId: 'd1', label: 'ใบส่งของ 001' }),
    ]);
    expect(store.tasks).toHaveLength(1);
    expect(connCalls(/crm_tasks/)).toHaveLength(0);
  });
});

// ── The bell counter ─────────────────────────────────────────────────────────

describe('countDueTasks', () => {
  type FakeTask = { id: string; status: string; dueDate: string | null };

  /** Applies the statement's OWN where-clause to in-memory rows, so a query
   * that loses the status filter or the date bound returns a visibly wrong
   * number here rather than passing. NULL comparisons follow SQL, not JS. */
  function countAgainst(tasks: FakeTask[]) {
    topQuery.mockImplementation((sql: string, params: unknown[] = []) => {
      const today = String(params[0]);
      const matched = tasks.filter((t) => {
        if (/status = 'pending'/.test(sql) && t.status !== 'pending') return false;
        if (/dueDate IS NOT NULL/.test(sql) && t.dueDate === null) return false;
        if (/dueDate <> ''/.test(sql) && t.dueDate === '') return false;
        if (/dueDate <= \?/.test(sql) && !(t.dueDate !== null && t.dueDate <= today)) return false;
        return true;
      });
      return Promise.resolve([[{ cnt: matched.length }]]);
    });
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('counts only pending tasks whose due date has ARRIVED (8.14)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-05T03:00:00.000Z')); // Bangkok: Sep 5, 10:00
    countAgainst([
      { id: 'no-due', status: 'pending', dueDate: null },
      { id: 'blank-due', status: 'pending', dueDate: '' },
      { id: 'tomorrow', status: 'pending', dueDate: '2026-09-06' },
      { id: 'next-year', status: 'pending', dueDate: '2027-01-01' },
      { id: 'today', status: 'pending', dueDate: '2026-09-05' },
      { id: 'overdue', status: 'pending', dueDate: '2026-08-01' },
      { id: 'done-overdue', status: 'done', dueDate: '2026-08-01' },
    ]);

    // today + overdue only. A to-do list must never be allowed to inflate the
    // bell into a number nobody trusts.
    expect(await countDueTasks()).toBe(2);
  });

  it('counts a task with no due date as zero (8.14)', async () => {
    countAgainst([{ id: 'someday', status: 'pending', dueDate: null }]);
    expect(await countDueTasks()).toBe(0);
  });

  it('does not count a task due tomorrow (8.14)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-05T03:00:00.000Z'));
    countAgainst([{ id: 'tomorrow', status: 'pending', dueDate: '2026-09-06' }]);
    expect(await countDueTasks()).toBe(0);
  });

  it('stops counting a task the moment it is completed (8.14)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-05T03:00:00.000Z'));
    const overdue: FakeTask = { id: 'x', status: 'pending', dueDate: '2026-08-01' };

    countAgainst([overdue]);
    expect(await countDueTasks()).toBe(1);

    countAgainst([{ ...overdue, status: 'done' }]);
    expect(await countDueTasks()).toBe(0);
  });

  it('uses the BANGKOK calendar day, so a due task is not uncounted for 7 hours every night (8.15)', async () => {
    // UTC 2026-09-04T19:00Z is already 2026-09-05 02:00 in Bangkok. Vercel runs
    // at UTC, so a naive server "today" would still say Sep 4 and a task due
    // today would go uncounted until 07:00 Thai time.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-04T19:00:00.000Z'));
    countAgainst([{ id: 'due-today-bkk', status: 'pending', dueDate: '2026-09-05' }]);

    expect(await countDueTasks()).toBe(1);
    expect((topQuery.mock.calls[0][1] as unknown[])[0]).toBe('2026-09-05');
  });

  it('returns 0 rather than NaN when the count comes back empty', async () => {
    topQuery.mockResolvedValue([[]]);
    expect(await countDueTasks()).toBe(0);
  });

  it('never writes anything', async () => {
    countAgainst([]);
    await countDueTasks();
    expect(topCalls(/INSERT|UPDATE|DELETE/i)).toHaveLength(0);
    expect(runTransaction).not.toHaveBeenCalled();
  });
});
