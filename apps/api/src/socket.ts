import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { config } from './config.js';
import { db } from './db.js';
import { notifyConversation } from './push.js';
import { persistMessage } from './message-persistence.js';
import { conversationIdSchema, plaintextMessageSchema } from './schemas.js';
import { sessionUser } from './session.js';

let realtime: Server | null = null;
const conversationRoom = (conversationId: string) => `conversation:${conversationId}`;

function hasAllowedOrigin(origin: string | undefined) {
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(config.APP_ORIGIN).origin;
  } catch {
    return false;
  }
}

/** Add every currently connected device of the two authorized members to a direct-chat room. */
export function joinConversationMembers(conversationId: string, userIds: string[]) {
  const room = conversationRoom(conversationId);
  for (const userId of userIds) realtime?.in(`user:${userId}`).socketsJoin(room);
  for (const userId of userIds) realtime?.to(`user:${userId}`).emit('conversation:new', { id: conversationId });
}

export function attachSocket(server: HttpServer) {
  const io = new Server(server, { serveClient: false, cors: { origin: config.APP_ORIGIN, credentials: true } });
  realtime = io;
  io.use(async (socket, next) => {
    if (!hasAllowedOrigin(socket.handshake.headers.origin)) {
      console.warn('SOCKET_REJECTED_ORIGIN', {
        expected: new URL(config.APP_ORIGIN).origin,
        received: socket.handshake.headers.origin ?? 'missing',
      });
      return next(new Error('invalid origin'));
    }
    const user = await sessionUser(socket.handshake.headers.cookie);
    if (!user) {
      console.warn('SOCKET_REJECTED_UNAUTHENTICATED');
      return next(new Error('unauthorized'));
    }
    socket.data.user = user;
    next();
  });
  io.on('connection', async (socket) => {
    const user = socket.data.user as { id: string; name: string };
    await socket.join(`user:${user.id}`);
    const memberships = await db.conversationMember.findMany({ where: { userId: user.id }, select: { conversationId: true } });
    memberships.forEach(({ conversationId }) => socket.join(conversationRoom(conversationId)));
    let messageWindowStartedAt = Date.now();
    let messagesInWindow = 0;
    socket.on('conversation:join', async (conversationId: string) => {
      if (!conversationIdSchema.safeParse(conversationId).success) return;
      const membership = await db.conversationMember.findUnique({ where: { conversationId_userId: { conversationId, userId: user.id } } });
      if (membership) await socket.join(conversationRoom(conversationId));
    });
    socket.on('message:send', async (raw, acknowledge: (result: unknown) => void = () => undefined) => {
      if (Date.now() - messageWindowStartedAt >= 60_000) {
        messageWindowStartedAt = Date.now();
        messagesInWindow = 0;
      }
      if (++messagesInWindow > 60) return acknowledge({ ok: false, error: 'RATE_LIMITED' });
      try {
        const input = plaintextMessageSchema.safeParse(raw);
        if (!input.success) return acknowledge({ ok: false, error: 'INVALID_MESSAGE' });
        const membership = await db.conversationMember.findUnique({
          where: { conversationId_userId: { conversationId: input.data.conversationId, userId: user.id } },
        });
        if (!membership) return acknowledge({ ok: false, error: 'FORBIDDEN' });
        const persisted = await persistMessage(input.data, user.id);
        if (persisted.kind === 'conflict') return acknowledge({ ok: false, error: 'CLIENT_ID_CONFLICT' });
        const { message } = persisted;
        if (persisted.kind === 'retry') return acknowledge({ ok: true, message });
        io.to(conversationRoom(input.data.conversationId)).emit('message:new', message);
        acknowledge({ ok: true, message });
        void notifyConversation(input.data.conversationId, user.id, user.name)
          .catch(() => console.error('Failed to send conversation push'));
      } catch (error) {
        console.error('Failed to persist message', error);
        acknowledge({ ok: false, error: 'INTERNAL_ERROR' });
      }
    });
  });
  return io;
}
