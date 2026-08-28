import { db } from './db.js';

/** Return the newest history window in chronological display order. */
export async function latestConversationMessages(conversationId: string) {
  const messages = await db.message.findMany({
    where: { conversationId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100,
    select: { id: true, clientId: true, senderId: true, body: true, createdAt: true },
  });
  return messages.reverse();
}
