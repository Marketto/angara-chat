import { describe, expect, it, vi } from 'vitest';
import { createIncomingMessageSound } from './message-sound';
import type { Message } from './types';

const incoming: Message = {
  id: 'message-1',
  clientId: 'client-1',
  conversationId: 'conversation-1',
  senderId: 'user-2',
  body: 'Ciao',
  createdAt: '2026-08-29T12:00:00.000Z',
};

describe('incoming message sound', () => {
  it('plays once for a newly received message while the app is visible', () => {
    const play = vi.fn();
    const sound = createIncomingMessageSound(play);

    expect(sound.handle(incoming, 'user-1', true)).toBe(true);
    expect(sound.handle(incoming, 'user-1', true)).toBe(false);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('does not play for messages sent by another device of the same account', () => {
    const play = vi.fn();
    const sound = createIncomingMessageSound(play);

    expect(sound.handle({ ...incoming, senderId: 'user-1' }, 'user-1', true)).toBe(false);
    expect(play).not.toHaveBeenCalled();
  });

  it('leaves background notification audio to the operating system', () => {
    const play = vi.fn();
    const sound = createIncomingMessageSound(play);

    expect(sound.handle(incoming, 'user-1', false)).toBe(false);
    expect(play).not.toHaveBeenCalled();
  });
});
