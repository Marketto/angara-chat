import { describe, expect, it, vi } from 'vitest';
import { deliverQueuedMessages } from './outbox-delivery';
import type { QueuedMessage } from './outbox';
import type { Message } from './types';

const queued = (clientId: string, failure?: QueuedMessage['failure']): QueuedMessage => ({
  clientId,
  conversationId: 'conversation-1',
  userId: 'user-1',
  body: `body-${clientId}`,
  createdAt: `2026-08-28T12:00:0${clientId}.000Z`,
  ...(failure ? { failure } : {}),
});
const persisted = (message: QueuedMessage): Message => ({
  id: `server-${message.clientId}`,
  clientId: message.clientId,
  conversationId: message.conversationId,
  senderId: message.userId,
  body: message.body,
  createdAt: message.createdAt,
});

function callbacks() {
  return {
    remove: vi.fn(async () => undefined),
    markFailed: vi.fn(async () => undefined),
    onState: vi.fn(),
    onDelivered: vi.fn(),
  };
}

describe('persistent outbox delivery', () => {
  it('keeps a timed-out pre-deploy message and requests an automatic retry', async () => {
    const message = queued('1');
    const effects = callbacks();

    await expect(deliverQueuedMessages({ messages: [message], send: vi.fn(async () => null), ...effects }))
      .resolves.toEqual({ retryAfterMs: 3_000 });
    expect(effects.remove).not.toHaveBeenCalled();
    expect(effects.onState).toHaveBeenNthCalledWith(1, message, 'sending');
    expect(effects.onState).toHaveBeenNthCalledWith(2, message, 'queued');
  });

  it('uses the server rate-limit window before retrying', async () => {
    const effects = callbacks();
    await expect(deliverQueuedMessages({
      messages: [queued('1')],
      send: vi.fn(async () => ({ ok: false as const, error: 'RATE_LIMITED' as const, retryAfterMs: 42_000 })),
      ...effects,
    })).resolves.toEqual({ retryAfterMs: 42_000 });
  });

  it('quarantines a permanent failure and continues with later valid messages', async () => {
    const poison = queued('1');
    const valid = queued('2');
    const effects = callbacks();
    const send = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: 'FORBIDDEN' })
      .mockResolvedValueOnce({ ok: true, message: persisted(valid) });

    await expect(deliverQueuedMessages({ messages: [poison, valid], send, ...effects })).resolves.toEqual({});
    expect(effects.markFailed).toHaveBeenCalledWith(poison, 'FORBIDDEN');
    expect(effects.remove).toHaveBeenCalledWith(valid.clientId);
    expect(effects.onDelivered).toHaveBeenCalledWith(persisted(valid));
  });

  it('preserves and skips a message already quarantined by a previous run', async () => {
    const failed = queued('1', 'CLIENT_ID_CONFLICT');
    const send = vi.fn();
    const effects = callbacks();

    await expect(deliverQueuedMessages({ messages: [failed], send, ...effects })).resolves.toEqual({});
    expect(send).not.toHaveBeenCalled();
    expect(effects.remove).not.toHaveBeenCalled();
    expect(effects.onState).toHaveBeenCalledWith(failed, 'failed');
  });
});
