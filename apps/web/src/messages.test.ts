import { describe, expect, it } from 'vitest';
import { mergeMessages, reconcileMessage } from './messages';
import type { Message } from './types';

const queued: Message = {
  id: 'queued:client-1',
  clientId: 'client-1',
  conversationId: 'conversation-1',
  senderId: 'sender-1',
  body: 'ciao',
  createdAt: '2026-08-27T06:00:00.000Z',
  deliveryState: 'sending',
};

const persisted: Message = {
  ...queued,
  id: 'message-1',
  createdAt: '2026-08-27T06:00:01.000Z',
  deliveryState: undefined,
};

describe('message reconciliation', () => {
  it('replaces an optimistic message with the server copy using clientId', () => {
    expect(reconcileMessage([queued], persisted)).toEqual([persisted]);
  });

  it('is idempotent when socket delivery and acknowledgement carry the same message', () => {
    expect(reconcileMessage([persisted], persisted)).toEqual([persisted]);
  });

  it('repairs an array that already contains duplicate copies', () => {
    expect(reconcileMessage([queued, persisted], persisted)).toEqual([persisted]);
  });

  it('keeps a live message that arrived while a history snapshot was loading', () => {
    const live = { ...persisted, id: 'message-2', clientId: 'client-2' };
    expect(mergeMessages([persisted, live], [persisted])).toEqual([persisted, live]);
  });

  it('prefers the server snapshot over an optimistic copy with the same clientId', () => {
    expect(mergeMessages([queued], [persisted])).toEqual([persisted]);
  });
});
