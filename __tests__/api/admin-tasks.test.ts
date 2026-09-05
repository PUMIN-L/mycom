// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mocks ─────────────────────────────────────────────────────────────────────

// The error classes are declared inside the factory so `instanceof` inside the
// route matches what these tests throw (same module instance).
vi.mock('@/app/lib/taskStore', () => ({
  listTopics: vi.fn(),
  getTopic: vi.fn(),
  addTopic: vi.fn(),
  updateTopic: vi.fn(),
  setTopicActive: vi.fn(),
  reorderTopics: vi.fn(),
  deleteTopic: vi.fn(),
  listTasks: vi.fn(),
  getTask: vi.fn(),
  addTask: vi.fn(),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
  countDueTasks: vi.fn(),
  TASK_STATUSES: ['pending', 'done'],
  TaskValidationError: class extends Error {
    name = 'TaskValidationError';
  },
  TopicInUseError: class extends Error {
    name = 'TopicInUseError';
    constructor(public readonly topicId: number, public readonly taskCount: number) {
      super('หัวข้อนี้มีงานอยู่ ไม่สามารถลบได้ กรุณาซ่อนแทน');
    }
  },
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
  deleteTask,
  countDueTasks,
  TaskValidationError,
  TopicInUseError,
} from '@/app/lib/taskStore';

vi.mock('@/app/lib/crmStore', () => ({ getAlerts: vi.fn() }));
import { getAlerts } from '@/app/lib/crmStore';

vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }));
import { getSession } from '@/app/lib/session';

const admin = { userId: '1', username: 'admin', expiresAt: new Date() } as any;

const mutReq = (url: string, method: string, body?: any) =>
  new NextRequest(url, {
    method,
    headers: { origin: 'http://localhost:3000', host: 'localhost:3000' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

// ── Import handlers ──────────────────────────────────────────────────────────

import { GET as tasksGET, POST as tasksPOST } from '@/app/api/admin/tasks/route';
import { PATCH as taskPATCH, DELETE as taskDELETE } from '@/app/api/admin/tasks/[id]/route';
import { GET as topicsGET, POST as topicsPOST } from '@/app/api/admin/task-topics/route';
import { PATCH as topicPATCH, DELETE as topicDELETE } from '@/app/api/admin/task-topics/[id]/route';
import { PATCH as reorderPATCH } from '@/app/api/admin/task-topics/reorder/route';
import { GET as alertsGET } from '@/app/api/admin/alerts/route';

const TOPIC = {
  id: 1, name: 'โทรหาลูกค้า', icon: '📞', color: 'blue', sortOrder: 1, isActive: true, createdAt: 'c',
};
const TASK = {
  id: 't1', topicId: 1, title: 'โทรหาเจ้านี้', detail: null, dueDate: '2026-09-10',
  status: 'pending', completedAt: null, createdAt: 'c', links: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(null);
  vi.mocked(getTopic).mockResolvedValue(TOPIC as any);
  vi.mocked(getTask).mockResolvedValue(TASK as any);
});

function login() {
  vi.mocked(getSession).mockResolvedValue(admin);
}

describe('Admin Tasks API — auth', () => {
  it('every task and topic route returns 401 for anonymous', async () => {
    const responses = await Promise.all([
      tasksGET(new NextRequest('http://localhost:3000/api/admin/tasks')),
      tasksPOST(mutReq('http://localhost:3000/api/admin/tasks', 'POST', { topicId: 1, title: 'x' })),
      taskPATCH(mutReq('http://localhost:3000/api/admin/tasks/t1', 'PATCH', { title: 'x' }), ctx('t1')),
      taskDELETE(mutReq('http://localhost:3000/api/admin/tasks/t1', 'DELETE'), ctx('t1')),
      topicsGET(new NextRequest('http://localhost:3000/api/admin/task-topics')),
      topicsPOST(mutReq('http://localhost:3000/api/admin/task-topics', 'POST', { name: 'x' })),
      topicPATCH(mutReq('http://localhost:3000/api/admin/task-topics/1', 'PATCH', { name: 'x' }), ctx('1')),
      topicDELETE(mutReq('http://localhost:3000/api/admin/task-topics/1', 'DELETE'), ctx('1')),
      reorderPATCH(mutReq('http://localhost:3000/api/admin/task-topics/reorder', 'PATCH', { ids: [1] })),
    ]);

    expect(responses.map((r) => r.status)).toEqual(Array(responses.length).fill(401));
    // A rejected request must never reach the store.
    expect(addTask).not.toHaveBeenCalled();
    expect(deleteTask).not.toHaveBeenCalled();
    expect(deleteTopic).not.toHaveBeenCalled();
    expect(reorderTopics).not.toHaveBeenCalled();
  });
});

describe('GET /api/admin/tasks', () => {
  beforeEach(login);

  it('returns the board with no filters', async () => {
    vi.mocked(listTasks).mockResolvedValue([TASK] as any);

    const res = await tasksGET(new NextRequest('http://localhost:3000/api/admin/tasks'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([TASK]);
    expect(listTasks).toHaveBeenCalledWith({});
  });

  it('passes topicId, status and limit through', async () => {
    vi.mocked(listTasks).mockResolvedValue([] as any);

    await tasksGET(new NextRequest('http://localhost:3000/api/admin/tasks?topicId=3&status=done&limit=50'));

    expect(listTasks).toHaveBeenCalledWith({ topicId: 3, status: 'done', limit: 50 });
  });

  it('400s on a non-numeric topicId and on an unknown status — and reads nothing', async () => {
    const bad = await tasksGET(new NextRequest('http://localhost:3000/api/admin/tasks?topicId=abc'));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toContain('หัวข้อ');

    const badStatus = await tasksGET(new NextRequest('http://localhost:3000/api/admin/tasks?status=archived'));
    expect(badStatus.status).toBe(400);
    expect((await badStatus.json()).error).toContain('สถานะ');

    expect(listTasks).not.toHaveBeenCalled();
  });

  it('ignores a non-positive limit rather than rejecting the whole request', async () => {
    vi.mocked(listTasks).mockResolvedValue([] as any);
    await tasksGET(new NextRequest('http://localhost:3000/api/admin/tasks?limit=0'));
    expect(listTasks).toHaveBeenCalledWith({});
  });
});

describe('POST /api/admin/tasks', () => {
  beforeEach(login);

  it('creates a task with its links and answers 201', async () => {
    const created = { ...TASK, id: 't-new' };
    vi.mocked(addTask).mockResolvedValue(created as any);

    const res = await tasksPOST(
      mutReq('http://localhost:3000/api/admin/tasks', 'POST', {
        topicId: 1,
        title: 'ทำใบเสนอราคา',
        detail: 'ด่วน',
        dueDate: '2026-09-10',
        links: [{ targetType: 'customer', targetId: 'c1', label: 'บริษัท เอ' }],
      })
    );

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(created);
    expect(addTask).toHaveBeenCalledWith({
      topicId: 1,
      title: 'ทำใบเสนอราคา',
      detail: 'ด่วน',
      dueDate: '2026-09-10',
      links: [{ targetType: 'customer', targetId: 'c1', label: 'บริษัท เอ' }],
    });
  });

  it('400s when topicId is missing or not a positive integer', async () => {
    for (const topicId of [undefined, 0, -1, 'abc', 1.5]) {
      const res = await tasksPOST(
        mutReq('http://localhost:3000/api/admin/tasks', 'POST', { topicId, title: 'x' })
      );
      expect(res.status).toBe(400);
    }
    expect(addTask).not.toHaveBeenCalled();
  });

  it('400s when the topic does not exist — a missing topic is never auto-created', async () => {
    vi.mocked(getTopic).mockResolvedValue(null);

    const res = await tasksPOST(
      mutReq('http://localhost:3000/api/admin/tasks', 'POST', { topicId: 99, title: 'x' })
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('ไม่พบหัวข้อ');
    expect(addTask).not.toHaveBeenCalled();
  });

  it('400s when the topic has since been hidden (stale tab)', async () => {
    vi.mocked(getTopic).mockResolvedValue({ ...TOPIC, isActive: false } as any);

    const res = await tasksPOST(
      mutReq('http://localhost:3000/api/admin/tasks', 'POST', { topicId: 1, title: 'x' })
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('ถูกซ่อน');
    expect(addTask).not.toHaveBeenCalled();
  });

  it('400s when links is not an array', async () => {
    const res = await tasksPOST(
      mutReq('http://localhost:3000/api/admin/tasks', 'POST', { topicId: 1, title: 'x', links: 'c1' })
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('ลิงก์');
    expect(addTask).not.toHaveBeenCalled();
  });

  it('surfaces a store validation error as a 400 carrying its Thai message, not a 500', async () => {
    // An empty title, a malformed dueDate and an unknown targetType all arrive
    // here as TaskValidationError.
    for (const message of [
      'กรุณาระบุชื่องาน',
      'รูปแบบวันครบกำหนดต้องเป็น YYYY-MM-DD',
      'ชนิดของลิงก์ไม่ถูกต้อง',
    ]) {
      vi.mocked(addTask).mockRejectedValueOnce(new TaskValidationError(message));

      const res = await tasksPOST(
        mutReq('http://localhost:3000/api/admin/tasks', 'POST', { topicId: 1, title: 'x' })
      );

      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe(message);
    }
  });
});

describe('PATCH /api/admin/tasks/[id]', () => {
  beforeEach(login);

  it('404s for a task that does not exist, without writing', async () => {
    vi.mocked(getTask).mockResolvedValue(null);

    const res = await taskPATCH(
      mutReq('http://localhost:3000/api/admin/tasks/gone', 'PATCH', { title: 'x' }),
      ctx('gone')
    );

    expect(res.status).toBe(404);
    expect(updateTask).not.toHaveBeenCalled();
  });

  it('edits fields and returns the updated task', async () => {
    const updated = { ...TASK, title: 'แก้แล้ว' };
    vi.mocked(updateTask).mockResolvedValue(updated as any);

    const res = await taskPATCH(
      mutReq('http://localhost:3000/api/admin/tasks/t1', 'PATCH', { title: 'แก้แล้ว', detail: 'ใหม่' }),
      ctx('t1')
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(updated);
    expect(updateTask).toHaveBeenCalledWith('t1', { title: 'แก้แล้ว', detail: 'ใหม่' });
  });

  it('passes a null dueDate through as a CLEAR, and omits it entirely when absent', async () => {
    vi.mocked(updateTask).mockResolvedValue(TASK as any);

    await taskPATCH(mutReq('http://localhost:3000/api/admin/tasks/t1', 'PATCH', { dueDate: null }), ctx('t1'));
    expect(updateTask).toHaveBeenLastCalledWith('t1', { dueDate: null });

    await taskPATCH(mutReq('http://localhost:3000/api/admin/tasks/t1', 'PATCH', { title: 'x' }), ctx('t1'));
    expect(updateTask).toHaveBeenLastCalledWith('t1', { title: 'x' });
    expect(vi.mocked(updateTask).mock.calls.at(-1)![1]).not.toHaveProperty('dueDate');
  });

  it('400s on a status outside pending/done', async () => {
    const res = await taskPATCH(
      mutReq('http://localhost:3000/api/admin/tasks/t1', 'PATCH', { status: 'archived' }),
      ctx('t1')
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('สถานะ');
    expect(updateTask).not.toHaveBeenCalled();
  });

  it('accepts both real statuses', async () => {
    vi.mocked(updateTask).mockResolvedValue(TASK as any);

    for (const status of ['pending', 'done']) {
      const res = await taskPATCH(
        mutReq('http://localhost:3000/api/admin/tasks/t1', 'PATCH', { status }),
        ctx('t1')
      );
      expect(res.status).toBe(200);
      expect(updateTask).toHaveBeenLastCalledWith('t1', { status });
    }
  });

  it('400s when links is not an array', async () => {
    const res = await taskPATCH(
      mutReq('http://localhost:3000/api/admin/tasks/t1', 'PATCH', { links: { targetId: 'c1' } }),
      ctx('t1')
    );

    expect(res.status).toBe(400);
    expect(updateTask).not.toHaveBeenCalled();
  });

  it('400s on a move INTO a hidden topic, but still lets a task already filed under one be edited', async () => {
    vi.mocked(updateTask).mockResolvedValue(TASK as any);
    vi.mocked(getTask).mockResolvedValue({ ...TASK, topicId: 4 } as any);
    vi.mocked(getTopic).mockResolvedValue({ ...TOPIC, id: 4, isActive: false } as any);

    // Editing in place: the topic is hidden but it is the task's OWN topic.
    const kept = await taskPATCH(
      mutReq('http://localhost:3000/api/admin/tasks/t1', 'PATCH', { topicId: 4, title: 'x' }),
      ctx('t1')
    );
    expect(kept.status).toBe(200);

    // Moving a task INTO a hidden topic is refused.
    vi.mocked(getTask).mockResolvedValue({ ...TASK, topicId: 1 } as any);
    const moved = await taskPATCH(
      mutReq('http://localhost:3000/api/admin/tasks/t1', 'PATCH', { topicId: 4 }),
      ctx('t1')
    );
    expect(moved.status).toBe(400);
    expect((await moved.json()).error).toContain('ถูกซ่อน');
  });

  it('400s on an invalid topicId and 400s when the target topic is gone', async () => {
    const badId = await taskPATCH(
      mutReq('http://localhost:3000/api/admin/tasks/t1', 'PATCH', { topicId: 0 }),
      ctx('t1')
    );
    expect(badId.status).toBe(400);

    vi.mocked(getTopic).mockResolvedValue(null);
    const gone = await taskPATCH(
      mutReq('http://localhost:3000/api/admin/tasks/t1', 'PATCH', { topicId: 42 }),
      ctx('t1')
    );
    expect(gone.status).toBe(400);
    expect(updateTask).not.toHaveBeenCalled();
  });

  it('surfaces a store validation error as a 400 with its Thai message', async () => {
    vi.mocked(updateTask).mockRejectedValue(new TaskValidationError('รูปแบบวันครบกำหนดต้องเป็น YYYY-MM-DD'));

    const res = await taskPATCH(
      mutReq('http://localhost:3000/api/admin/tasks/t1', 'PATCH', { dueDate: '10/09/2026' }),
      ctx('t1')
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('รูปแบบวันครบกำหนดต้องเป็น YYYY-MM-DD');
  });
});

describe('DELETE /api/admin/tasks/[id]', () => {
  beforeEach(login);

  it('deletes on an explicit admin command', async () => {
    vi.mocked(deleteTask).mockResolvedValue(true);

    const res = await taskDELETE(mutReq('http://localhost:3000/api/admin/tasks/t1', 'DELETE'), ctx('t1'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(deleteTask).toHaveBeenCalledWith('t1');
  });

  it('404s when the task was already gone', async () => {
    vi.mocked(deleteTask).mockResolvedValue(false);

    const res = await taskDELETE(mutReq('http://localhost:3000/api/admin/tasks/t1', 'DELETE'), ctx('t1'));

    expect(res.status).toBe(404);
  });
});

describe('GET/POST /api/admin/task-topics', () => {
  beforeEach(login);

  it('returns active topics by default and hidden ones on request', async () => {
    vi.mocked(listTopics).mockResolvedValue([TOPIC] as any);

    const res = await topicsGET(new NextRequest('http://localhost:3000/api/admin/task-topics'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([TOPIC]);
    expect(listTopics).toHaveBeenCalledWith(false);

    await topicsGET(new NextRequest('http://localhost:3000/api/admin/task-topics?includeHidden=1'));
    expect(listTopics).toHaveBeenLastCalledWith(true);

    await topicsGET(new NextRequest('http://localhost:3000/api/admin/task-topics?includeHidden=true'));
    expect(listTopics).toHaveBeenLastCalledWith(true);
  });

  it('creates a topic with 201', async () => {
    vi.mocked(addTopic).mockResolvedValue({ ...TOPIC, id: 6, name: 'ทวงหนี้', icon: '💸' } as any);

    const res = await topicsPOST(
      mutReq('http://localhost:3000/api/admin/task-topics', 'POST', { name: 'ทวงหนี้', icon: '💸', color: 'teal' })
    );

    expect(res.status).toBe(201);
    expect(addTopic).toHaveBeenCalledWith({ name: 'ทวงหนี้', icon: '💸', color: 'teal' });
    // The BODY is the topic itself, not { topic } or { success } — the modal
    // appends exactly what comes back, so a wrapper here would put a blank row
    // on the board ("I added a topic and nothing appeared").
    expect(await res.json()).toMatchObject({ id: 6, name: 'ทวงหนี้', icon: '💸' });
  });

  it('400s with the store\'s Thai message on an empty name or a raw CSS colour', async () => {
    vi.mocked(addTopic).mockRejectedValueOnce(new TaskValidationError('กรุณาระบุชื่อหัวข้อ'));
    const noName = await topicsPOST(mutReq('http://localhost:3000/api/admin/task-topics', 'POST', { name: '' }));
    expect(noName.status).toBe(400);
    expect((await noName.json()).error).toBe('กรุณาระบุชื่อหัวข้อ');

    vi.mocked(addTopic).mockRejectedValueOnce(new TaskValidationError('สีของหัวข้อไม่ถูกต้อง'));
    const badColor = await topicsPOST(
      mutReq('http://localhost:3000/api/admin/task-topics', 'POST', { name: 'x', color: '#ff0000' })
    );
    expect(badColor.status).toBe(400);
    expect((await badColor.json()).error).toBe('สีของหัวข้อไม่ถูกต้อง');
  });
});

describe('PATCH /api/admin/task-topics/[id]', () => {
  beforeEach(login);

  it('400s on a non-numeric id and 404s on a topic that does not exist', async () => {
    const badId = await topicPATCH(
      mutReq('http://localhost:3000/api/admin/task-topics/abc', 'PATCH', { name: 'x' }),
      ctx('abc')
    );
    expect(badId.status).toBe(400);

    vi.mocked(getTopic).mockResolvedValue(null);
    const missing = await topicPATCH(
      mutReq('http://localhost:3000/api/admin/task-topics/9', 'PATCH', { name: 'x' }),
      ctx('9')
    );
    expect(missing.status).toBe(404);
    expect(updateTopic).not.toHaveBeenCalled();
  });

  it('renames/recolours and returns the fresh row', async () => {
    vi.mocked(getTopic).mockResolvedValue({ ...TOPIC, name: 'ชื่อใหม่' } as any);

    const res = await topicPATCH(
      mutReq('http://localhost:3000/api/admin/task-topics/1', 'PATCH', { name: 'ชื่อใหม่', color: 'rose' }),
      ctx('1')
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ name: 'ชื่อใหม่' });
    expect(updateTopic).toHaveBeenCalledWith(1, { name: 'ชื่อใหม่', color: 'rose' });
    expect(setTopicActive).not.toHaveBeenCalled();
  });

  it('hides a topic through isActive — and never deletes it', async () => {
    const res = await topicPATCH(
      mutReq('http://localhost:3000/api/admin/task-topics/4', 'PATCH', { isActive: false }),
      ctx('4')
    );

    expect(res.status).toBe(200);
    expect(setTopicActive).toHaveBeenCalledWith(4, false);
    expect(updateTopic).not.toHaveBeenCalled();
    expect(deleteTopic).not.toHaveBeenCalled();
  });

  it('restores a hidden topic', async () => {
    await topicPATCH(
      mutReq('http://localhost:3000/api/admin/task-topics/4', 'PATCH', { isActive: true }),
      ctx('4')
    );
    expect(setTopicActive).toHaveBeenCalledWith(4, true);
  });

  it('400s with the Thai message when the colour is not a token', async () => {
    vi.mocked(updateTopic).mockRejectedValue(new TaskValidationError('สีของหัวข้อไม่ถูกต้อง'));

    const res = await topicPATCH(
      mutReq('http://localhost:3000/api/admin/task-topics/1', 'PATCH', { color: 'rgb(1,2,3)' }),
      ctx('1')
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('สีของหัวข้อไม่ถูกต้อง');
  });
});

describe('DELETE /api/admin/task-topics/[id]', () => {
  beforeEach(login);

  it('refuses (400) while tasks still reference the topic, and nothing is deleted', async () => {
    vi.mocked(deleteTopic).mockRejectedValue(new TopicInUseError(2, 3));

    const res = await topicDELETE(mutReq('http://localhost:3000/api/admin/task-topics/2', 'DELETE'), ctx('2'));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('หัวข้อนี้มีงานอยู่ ไม่สามารถลบได้ กรุณาซ่อนแทน');
  });

  it('deletes a topic nothing references', async () => {
    vi.mocked(deleteTopic).mockResolvedValue(true);

    const res = await topicDELETE(mutReq('http://localhost:3000/api/admin/task-topics/9', 'DELETE'), ctx('9'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(deleteTopic).toHaveBeenCalledWith(9);
  });

  it('400s on a bad id and 404s on one that is already gone', async () => {
    const badId = await topicDELETE(mutReq('http://localhost:3000/api/admin/task-topics/abc', 'DELETE'), ctx('abc'));
    expect(badId.status).toBe(400);
    expect(deleteTopic).not.toHaveBeenCalled();

    vi.mocked(deleteTopic).mockResolvedValue(false);
    const missing = await topicDELETE(mutReq('http://localhost:3000/api/admin/task-topics/9', 'DELETE'), ctx('9'));
    expect(missing.status).toBe(404);
  });
});

describe('PATCH /api/admin/task-topics/reorder', () => {
  beforeEach(login);

  it('writes the whole new order and returns every topic, hidden ones included', async () => {
    vi.mocked(reorderTopics).mockResolvedValue(true);
    vi.mocked(listTopics).mockResolvedValue([TOPIC] as any);

    const res = await reorderPATCH(
      mutReq('http://localhost:3000/api/admin/task-topics/reorder', 'PATCH', { ids: [3, 1, 2] })
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, topics: [TOPIC] });
    expect(reorderTopics).toHaveBeenCalledWith([3, 1, 2]);
    expect(listTopics).toHaveBeenCalledWith(true);
  });

  it('400s when ids is missing, not an array, or contains a bad id', async () => {
    for (const body of [{}, { ids: '1,2' }, { ids: [1, 'x'] }, { ids: [1, 0] }, { ids: [1, -2] }]) {
      const res = await reorderPATCH(
        mutReq('http://localhost:3000/api/admin/task-topics/reorder', 'PATCH', body)
      );
      expect(res.status).toBe(400);
    }
    expect(reorderTopics).not.toHaveBeenCalled();
  });
});

// ── The alert feed's task-board contribution ─────────────────────────────────

describe('GET /api/admin/alerts — new keys alongside every existing one', () => {
  const baseAlerts = {
    expiringWarranties: [{ id: 'eq-1' }],
    nearingCalibration: [{ id: 'eq-2' }],
    incompleteEquipments: [{ id: 'eq-3' }],
    incompleteEquipmentsTotal: 1,
    missingDocuments: [{ id: 'sr-1' }],
    upcomingSchedules: [{ id: 's1', overdue: false }],
    customerCallFollowUps: [{ id: 'call-1', overdue: false }],
    customerCallFollowUpsTotal: 12,
  };

  beforeEach(() => {
    login();
    vi.mocked(getAlerts).mockResolvedValue(baseAlerts as any);
    vi.mocked(countDueTasks).mockResolvedValue(4);
  });

  it('returns all six original keys plus customerCallFollowUps and dueTaskCount', async () => {
    const res = await alertsGET(new NextRequest('http://localhost:3000/api/admin/alerts'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ...baseAlerts, dueTaskCount: 4 });
    expect(getAlerts).toHaveBeenCalledWith(30, 7);
    expect(countDueTasks).toHaveBeenCalledTimes(1);
  });

  it('still returns the follow-up calls in full with scheduleDays=1 (the window does not apply to them)', async () => {
    const res = await alertsGET(
      new NextRequest('http://localhost:3000/api/admin/alerts?scheduleDays=1')
    );

    const body = await res.json();
    expect(getAlerts).toHaveBeenCalledWith(30, 1);
    expect(body.customerCallFollowUps).toEqual(baseAlerts.customerCallFollowUps);
    expect(body.customerCallFollowUpsTotal).toBe(12);
  });

  it('still clamps both day windows to [1, 365]', async () => {
    await alertsGET(
      new NextRequest('http://localhost:3000/api/admin/alerts?warrantyDays=-5&scheduleDays=999')
    );
    expect(getAlerts).toHaveBeenCalledWith(1, 365);
  });

  it('401s for anonymous, and counts nothing', async () => {
    vi.mocked(getSession).mockResolvedValue(null);

    const res = await alertsGET(new NextRequest('http://localhost:3000/api/admin/alerts'));

    expect(res.status).toBe(401);
    expect(countDueTasks).not.toHaveBeenCalled();
    expect(getAlerts).not.toHaveBeenCalled();
  });
});
