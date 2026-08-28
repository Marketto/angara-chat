import type { QueuedMessage } from './outbox';
import type { Message, MessageSendAcknowledgement, PermanentMessageSendError } from './types';

const permanentErrors = new Set<PermanentMessageSendError>(['INVALID_MESSAGE', 'FORBIDDEN', 'CLIENT_ID_CONFLICT']);
const defaultRetryDelayMs = 3_000;

interface DeliveryOptions {
  messages: QueuedMessage[];
  send(message: QueuedMessage): Promise<MessageSendAcknowledgement | null>;
  remove(clientId: string): Promise<unknown>;
  markFailed(message: QueuedMessage, failure: PermanentMessageSendError): Promise<unknown>;
  onState(message: QueuedMessage, state: 'sending' | 'queued' | 'failed'): void;
  onDelivered(message: Message): void;
}

/** Drain in order; retain permanent failures without letting them poison later messages. */
export async function deliverQueuedMessages(options: DeliveryOptions): Promise<{ retryAfterMs?: number }> {
  for (const message of options.messages) {
    if (message.failure) {
      options.onState(message, 'failed');
      continue;
    }
    options.onState(message, 'sending');
    const acknowledgement = await options.send(message);
    if (acknowledgement?.ok) {
      await options.remove(message.clientId);
      options.onDelivered(acknowledgement.message);
      continue;
    }
    const failure = acknowledgement?.error;
    if (failure && permanentErrors.has(failure as PermanentMessageSendError)) {
      const permanentFailure = failure as PermanentMessageSendError;
      await options.markFailed(message, permanentFailure);
      options.onState(message, 'failed');
      continue;
    }
    options.onState(message, 'queued');
    return { retryAfterMs: acknowledgement?.retryAfterMs ?? defaultRetryDelayMs };
  }
  return {};
}
