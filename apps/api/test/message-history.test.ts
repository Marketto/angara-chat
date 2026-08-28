import { beforeEach, describe, expect, it, vi } from 'vitest';

const findMany = vi.fn();
vi.mock('../src/db.js', () => ({ db: { message: { findMany } } }));

describe('latest conversation history', () => {
  beforeEach(() => vi.clearAllMocks());

  it('queries the newest 100 messages and returns them chronologically', async () => {
    const newestFirst = [
      { id: 'new', createdAt: new Date('2026-08-28T12:00:00Z') },
      { id: 'old', createdAt: new Date('2026-08-28T11:00:00Z') },
    ];
    findMany.mockResolvedValue(newestFirst);
    const { latestConversationMessages } = await import('../src/message-history.js');

    await expect(latestConversationMessages('conversation-1')).resolves.toEqual([...newestFirst].reverse());
    expect(findMany).toHaveBeenCalledWith({
      where: { conversationId: 'conversation-1' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
      select: { id: true, clientId: true, senderId: true, body: true, createdAt: true },
    });
  });
});
