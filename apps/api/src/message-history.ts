import { db } from './db.js';

/** Return the complete shared conversation history in chronological display order. */
export async function latestConversationMessages(conversationId: string) {
  return db.message.findMany({
    where: { conversationId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, clientId: true, senderId: true, body: true, createdAt: true },
  });
}
