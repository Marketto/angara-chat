import { beforeEach, describe, expect, it, vi } from 'vitest';

const create = vi.fn();
const findUnique = vi.fn();
vi.mock('../src/db.js', () => ({ db: { message: { create, findUnique } } }));

const input = { conversationId: 'conversation-1', clientId: crypto.randomUUID(), body: 'ciao' };
const message = { id: 'message-1', ...input, senderId: 'sender-1', createdAt: new Date() };

describe('message persistence idempotency', () => {
  beforeEach(() => vi.clearAllMocks());

  it('marks a newly inserted message for realtime and push delivery', async () => {
    create.mockResolvedValue(message);
    const { persistMessage } = await import('../src/message-persistence.js');

    await expect(persistMessage(input, 'sender-1')).resolves.toEqual({ kind: 'created', message });
  });

  it('accepts an identical retry without delivering it twice', async () => {
    create.mockRejectedValue({ code: 'P2002' });
    findUnique.mockResolvedValue(message);
    const { persistMessage } = await import('../src/message-persistence.js');

    await expect(persistMessage(input, 'sender-1')).resolves.toEqual({ kind: 'retry', message });
  });

  it('rejects reuse of another message clientId', async () => {
    create.mockRejectedValue({ code: 'P2002' });
    findUnique.mockResolvedValue({ ...message, senderId: 'another-sender' });
    const { persistMessage } = await import('../src/message-persistence.js');

    await expect(persistMessage(input, 'sender-1')).resolves.toEqual({ kind: 'conflict' });
  });

  it('rejects reuse of a clientId with changed message content', async () => {
    create.mockRejectedValue({ code: 'P2002' });
    findUnique.mockResolvedValue({ ...message, body: 'testo originale' });
    const { persistMessage } = await import('../src/message-persistence.js');

    await expect(persistMessage(input, 'sender-1')).resolves.toEqual({ kind: 'conflict' });
  });
});
