// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/app/lib/db', () => ({ query: vi.fn() }));
import { query } from '@/app/lib/db';
import {
  saveContactMessage,
  markContactMessageEmailed,
  listContactMessages,
  countContactMessagesSince,
} from '@/app/lib/contactMessageStore';

beforeEach(() => vi.clearAllMocks());

const lead = {
  id: 'm1',
  name: 'A',
  email: 'a@x.com',
  phone: '0812345678',
  subject: 'S',
  message: 'M',
  createdAt: '2026-01-01',
};

describe('contactMessageStore', () => {
  it('countContactMessagesSince counts the rows from that instant on', async () => {
    vi.mocked(query).mockResolvedValue([[{ n: 7 }]] as never);
    expect(await countContactMessagesSince('2026-09-25T01:00:00.000Z')).toBe(7);
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain('COUNT(*)');
    expect(sql).toContain('createdAt >= ?');
    expect(params).toEqual(['2026-09-25T01:00:00.000Z']);
  });

  it('countContactMessagesSince reads a driver string count as a number', async () => {
    vi.mocked(query).mockResolvedValue([[{ n: '12' }]] as never);
    expect(await countContactMessagesSince('2026-09-25T01:00:00.000Z')).toBe(12);
  });

  it('saveContactMessage inserts with emailedOk=0 by default', async () => {
    vi.mocked(query).mockResolvedValue([{ affectedRows: 1 }] as any);
    await saveContactMessage(lead);
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain('INSERT INTO contact_messages');
    expect(params).toEqual(['m1', 'A', 'a@x.com', '0812345678', 'S', 'M', 0, '2026-01-01']);
  });

  it('saveContactMessage stores emailedOk=1 when true', async () => {
    vi.mocked(query).mockResolvedValue([{ affectedRows: 1 }] as any);
    await saveContactMessage({ ...lead, emailedOk: true });
    expect(vi.mocked(query).mock.calls[0][1]![6]).toBe(1);
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
      [{ id: 'm1', name: 'A', email: 'a@x.com', phone: null, subject: null, message: 'M', emailedOk: 1, createdAt: 't' }],
    ] as any);
    const rows = await listContactMessages();
    expect(rows).toEqual([
      { id: 'm1', name: 'A', email: 'a@x.com', phone: '', subject: '', message: 'M', emailedOk: true, createdAt: 't' },
    ]);
    expect(vi.mocked(query).mock.calls[0][0]).toContain('ORDER BY createdAt DESC');
  });
});
