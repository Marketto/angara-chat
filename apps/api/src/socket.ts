import type { IncomingHttpHeaders, Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { config } from './config.js';
import { db } from './db.js';
import { notifyConversation } from './push.js';
import { persistMessage } from './message-persistence.js';
import { conversationIdSchema, plaintextMessageSchema } from './schemas.js';
import { sessionUser } from './session.js';

let realtime: Server | null = null;
const conversationRoom = (conversationId: string) => `conversation:${conversationId}`;

function hasAllowedOrigin(headers: IncomingHttpHeaders) {
  const configured = new URL(config.APP_ORIGIN);
  const origin = headers.origin;
  try {
    if (origin) return new URL(origin).origin === configured.origin;
  } catch {
    return false;
  }
  return headers['sec-fetch-site'] === 'same-origin' && headers.host === configured.host;
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
    if (!hasAllowedOrigin(socket.handshake.headers)) {
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
  io.on('connection', (socket) => {
    const user = socket.data.user as { id: string; name: string; avatarUrl: string | null };
    // The client can emit as soon as it receives `connect`; attach handlers before yielding to room setup.
    const roomsReady = (async () => {
      await socket.join(`user:${user.id}`);
      const memberships = await db.conversationMember.findMany({ where: { userId: user.id }, select: { conversationId: true } });
      await Promise.all(memberships.map(({ conversationId }) => socket.join(conversationRoom(conversationId))));
      socket.emit('delivery:ready');
    })();
    void roomsReady.catch(() => console.error('Failed to join socket conversation rooms'));
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
      if (++messagesInWindow > 60) {
        return acknowledge({ ok: false, error: 'RATE_LIMITED', retryAfterMs: Math.max(1, 60_000 - (Date.now() - messageWindowStartedAt)) });
      }
      try {
        await roomsReady;
        const input = plaintextMessageSchema.safeParse(raw);
        if (!input.success) return acknowledge({ ok: false, error: 'INVALID_MESSAGE' });
        const membership = await db.conversationMember.findUnique({
          where: { conversationId_userId: { conversationId: input.data.conversationId, userId: user.id } },
        });
        if (!membership) return acknowledge({ ok: false, error: 'FORBIDDEN' });
        const persisted = await persistMessage(input.data, user.id);
        if (persisted.kind === 'conflict') return acknowledge({ ok: false, error: 'CLIENT_ID_CONFLICT' });
        const { message } = persisted;
        io.to(conversationRoom(input.data.conversationId)).emit('message:new', message);
        acknowledge({ ok: true, message });
        if (persisted.kind === 'created') {
          void notifyConversation(input.data.conversationId, user.id, user.name, user.avatarUrl)
            .catch(() => console.error('Failed to send conversation push'));
        }
      } catch (error) {
        console.error('Failed to persist message', error);
        acknowledge({ ok: false, error: 'INTERNAL_ERROR' });
      }
    });
  });
  return io;
}
