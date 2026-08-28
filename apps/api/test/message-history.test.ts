import { beforeEach, describe, expect, it, vi } from 'vitest';

const findMany = vi.fn();
vi.mock('../src/db.js', () => ({ db: { message: { findMany } } }));

describe('conversation history', () => {
  beforeEach(() => vi.clearAllMocks());

  it('queries the complete history in chronological order for every device', async () => {
    const chronological = [
      { id: 'old', createdAt: new Date('2026-08-28T11:00:00Z') },
      { id: 'new', createdAt: new Date('2026-08-28T12:00:00Z') },
    ];
    findMany.mockResolvedValue(chronological);
    const { latestConversationMessages } = await import('../src/message-history.js');

    await expect(latestConversationMessages('conversation-1')).resolves.toEqual(chronological);
    expect(findMany).toHaveBeenCalledWith({
      where: { conversationId: 'conversation-1' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, clientId: true, senderId: true, body: true, createdAt: true },
    });
  });
});
