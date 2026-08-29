import { db } from './db.js';
import { messageSelection } from './message-selection.js';

interface TextMessageInput { conversationId: string; clientId: string; kind: 'TEXT'; body: string }
interface LocationMessageInput {
  conversationId: string;
  clientId: string;
  kind: 'LOCATION';
  body: string;
  locationLatitude: number;
  locationLongitude: number;
  locationAccuracy: number | null;
}
type MessageInput = TextMessageInput | LocationMessageInput;

/** Persist once; an identical unique-key collision is a retry, not a new delivery. */
export async function persistMessage(input: MessageInput, senderId: string) {
  try {
    const message = await db.message.create({ data: { ...input, senderId }, select: messageSelection });
    return { kind: 'created' as const, message };
  } catch (error) {
    if ((error as { code?: string }).code !== 'P2002') throw error;
    const message = await db.message.findUnique({
      where: { conversationId_clientId: { conversationId: input.conversationId, clientId: input.clientId } },
      select: messageSelection,
    });
    if (message && message.senderId === senderId && sameMessage(message, input)) return { kind: 'retry' as const, message };
    return { kind: 'conflict' as const };
  }
}

function sameMessage(message: {
  kind: string;
  body: string;
  locationLatitude: number | null;
  locationLongitude: number | null;
  locationAccuracy: number | null;
}, input: MessageInput) {
  if (message.kind !== input.kind || message.body !== input.body) return false;
  if (input.kind === 'TEXT') {
    return message.locationLatitude === null && message.locationLongitude === null && message.locationAccuracy === null;
  }
  return message.locationLatitude === input.locationLatitude
    && message.locationLongitude === input.locationLongitude
    && message.locationAccuracy === input.locationAccuracy;
}
