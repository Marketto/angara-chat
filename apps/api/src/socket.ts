import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { config } from './config.js';
import { db } from './db.js';
import { notifyConversation } from './push.js';
import { plaintextMessageSchema } from './schemas.js';
import { sessionUser } from './session.js';

export function attachSocket(server: HttpServer) {
  const io = new Server(server, { serveClient: false, cors: { origin: config.APP_ORIGIN, credentials: true } });
  io.use(async (socket, next) => {
    if (socket.handshake.headers.origin !== config.APP_ORIGIN) return next(new Error('invalid origin'));
    const user = await sessionUser(socket.handshake.headers.cookie);
    if (!user) return next(new Error('unauthorized'));
    socket.data.user = user;
    next();
  });
  io.on('connection', async (socket) => {
    const user = socket.data.user as { id: string; name: string };
    await socket.join(`user:${user.id}`);
    const memberships = await db.conversationMember.findMany({ where: { userId: user.id }, select: { conversationId: true } });
    memberships.forEach(({ conversationId }) => socket.join(conversationId));
    let messageWindowStartedAt = Date.now();
    let messagesInWindow = 0;
    socket.on('conversation:join', async (conversationId: string) => {
      const membership = await db.conversationMember.findUnique({ where: { conversationId_userId: { conversationId, userId: user.id } } });
      if (membership) await socket.join(conversationId);
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
        const message = await db.message.upsert({
          where: { conversationId_clientId: { conversationId: input.data.conversationId, clientId: input.data.clientId } }, update: {},
          create: { ...input.data, senderId: user.id },
          select: { id: true, clientId: true, conversationId: true, senderId: true, body: true, createdAt: true },
        });
        io.to(input.data.conversationId).emit('message:new', message);
        acknowledge({ ok: true, message });
        void notifyConversation(input.data.conversationId, user.id, user.name);
      } catch (error) {
        console.error('Failed to persist message', error);
        acknowledge({ ok: false, error: 'INTERNAL_ERROR' });
      }
    });
  });
  return io;
}
