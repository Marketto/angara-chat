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
