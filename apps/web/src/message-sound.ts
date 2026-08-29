import type { Message } from './types';

const maximumTrackedMessages = 500;

export function createIncomingMessageSound(play: () => void) {
  const seen = new Set<string>();
  const order: string[] = [];

  function remember(messageId: string) {
    seen.add(messageId);
    order.push(messageId);
    if (order.length <= maximumTrackedMessages) return;
    const oldest = order.shift();
    if (oldest) seen.delete(oldest);
  }

  return {
    handle(message: Message, currentUserId: string, appIsActive: boolean) {
      if (message.senderId === currentUserId || seen.has(message.id)) return false;
      remember(message.id);
      if (!appIsActive) return false;
      play();
      return true;
    },
  };
}
