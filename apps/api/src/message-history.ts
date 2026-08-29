import { db } from './db.js';
import { messageSelection } from './message-selection.js';

/** Return the complete shared conversation history in chronological display order. */
export async function latestConversationMessages(conversationId: string) {
  return db.message.findMany({
    where: { conversationId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: messageSelection,
  });
}
