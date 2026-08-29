import type { Message } from './types';

const rapidDuplicateWindowMs = 1_000;

/** Replace an optimistic/socket copy instead of rendering the same client message twice. */
export function reconcileMessage(messages: Message[], incoming: Message): Message[] {
  const reconciled: Message[] = [];
  let inserted = false;
  for (const message of messages) {
    if (message.id === incoming.id || message.clientId === incoming.clientId) {
      if (!inserted) reconciled.push(incoming);
      inserted = true;
    } else {
      reconciled.push(message);
    }
  }
  if (!inserted) reconciled.push(incoming);
  return reconciled;
}

/** Merge incoming messages into an existing list, deduplicating by server or client ID. */
export function mergeMessages(existing: Message[], incoming: Message[]): Message[] {
  const sorted = incoming
    .reduce((merged, message) => reconcileMessage(merged, message), [...existing])
    .sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
    );
  return sorted.reduce<Message[]>((visible, message) => {
    const previous = visible.at(-1);
    const elapsed = previous ? Date.parse(message.createdAt) - Date.parse(previous.createdAt) : NaN;
    const isPersistedRapidDuplicate = previous !== undefined
      && previous.deliveryState === undefined
      && message.deliveryState === undefined
      && (previous.kind === undefined || previous.kind === 'TEXT')
      && (message.kind === undefined || message.kind === 'TEXT')
      && previous.senderId === message.senderId
      && previous.body === message.body
      && elapsed >= 0
      && elapsed <= rapidDuplicateWindowMs;
    if (!isPersistedRapidDuplicate) visible.push(message);
    return visible;
  }, []);
}
