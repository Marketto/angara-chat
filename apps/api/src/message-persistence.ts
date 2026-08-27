import { db } from './db.js';

interface MessageInput { conversationId: string; clientId: string; body: string }

const selection = { id: true, clientId: true, conversationId: true, senderId: true, body: true, createdAt: true } as const;

/** Persist once; an identical unique-key collision is a retry, not a new delivery. */
export async function persistMessage(input: MessageInput, senderId: string) {
  try {
    const message = await db.message.create({ data: { ...input, senderId }, select: selection });
    return { kind: 'created' as const, message };
  } catch (error) {
    if ((error as { code?: string }).code !== 'P2002') throw error;
    const message = await db.message.findUnique({
      where: { conversationId_clientId: { conversationId: input.conversationId, clientId: input.clientId } },
      select: selection,
    });
    if (message && message.senderId === senderId && message.body === input.body) return { kind: 'retry' as const, message };
    return { kind: 'conflict' as const };
  }
}
