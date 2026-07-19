// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/app/lib/db', () => ({ query: vi.fn() }));
import { query } from '@/app/lib/db';
import {
  saveContactMessage,
  markContactMessageEmailed,
  listContactMessages,
} from '@/app/lib/contactMessageStore';

beforeEach(() => vi.clearAllMocks());

const lead = {
  id: 'm1',
  name: 'A',
  email: 'a@x.com',
  subject: 'S',
  message: 'M',
  createdAt: '2026-01-01',
};

describe('contactMessageStore', () => {
  it('saveContactMessage inserts with emailedOk=0 by default', async () => {
    vi.mocked(query).mockResolvedValue([{ affectedRows: 1 }] as any);
    await saveContactMessage(lead);
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain('INSERT INTO contact_messages');
    expect(params).toEqual(['m1', 'A', 'a@x.com', 'S', 'M', 0, '2026-01-01']);
  });

  it('saveContactMessage stores emailedOk=1 when true', async () => {
    vi.mocked(query).mockResolvedValue([{ affectedRows: 1 }] as any);
    await saveContactMessage({ ...lead, emailedOk: true });
    expect(vi.mocked(query).mock.calls[0][1]![5]).toBe(1);
  });

  it('markContactMessageEmailed flips the flag', async () => {
    vi.mocked(query).mockResolvedValue([{ affectedRows: 1 }] as any);
    await markContactMessageEmailed('m1', true);
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain('UPDATE contact_messages SET emailedOk');
    expect(params).toEqual([1, 'm1']);
  });

  it('markContactMessageEmailed can set the flag back to 0', async () => {
    vi.mocked(query).mockResolvedValue([{ affectedRows: 1 }] as any);
    await markContactMessageEmailed('m1', false);
    expect(vi.mocked(query).mock.calls[0][1]).toEqual([0, 'm1']);
  });

  it('listContactMessages maps rows (emailedOk→boolean, null subject→"") newest-first', async () => {
    vi.mocked(query).mockResolvedValue([
      [{ id: 'm1', name: 'A', email: 'a@x.com', subject: null, message: 'M', emailedOk: 1, createdAt: 't' }],
    ] as any);
    const rows = await listContactMessages();
    expect(rows).toEqual([
      { id: 'm1', name: 'A', email: 'a@x.com', subject: '', message: 'M', emailedOk: true, createdAt: 't' },
    ]);
    expect(vi.mocked(query).mock.calls[0][0]).toContain('ORDER BY createdAt DESC');
  });
});
