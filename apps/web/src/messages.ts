import type { Message } from './types';

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
  return incoming
    .reduce((merged, message) => reconcileMessage(merged, message), [...existing])
    .sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
    );
}
