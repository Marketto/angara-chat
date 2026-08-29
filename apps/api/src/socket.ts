import type { IncomingHttpHeaders, Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { config } from './config.js';
import { db } from './db.js';
import { notifyConversation } from './push.js';
import { persistMessage } from './message-persistence.js';
import {
  callAnswerSchema, callCandidateSchema, callHangupSchema, callOfferSchema,
  conversationIdSchema, plaintextMessageSchema,
} from './schemas.js';
import { sessionUser } from './session.js';

let realtime: Server | null = null;
const conversationRoom = (conversationId: string) => `conversation:${conversationId}`;
const CALL_RINGING_MS = 30_000;
const CALL_MAX_DURATION_MS = 30 * 60_000;
const CALLS_PER_MINUTE = 5;

interface ActiveCall {
  callId: string;
  conversationId: string;
  callerId: string;
  callerSocketId: string;
  recipientId: string;
  recipientSocketId: string | null;
  timeout: ReturnType<typeof setTimeout>;
}

const activeCalls = new Map<string, ActiveCall>();
const activeCallerConversations = new Map<string, string>();
const pendingCallIds = new Set<string>();
const callRateWindows = new Map<string, { startedAt: number; count: number }>();

function callKey(userId: string, conversationId: string) {
  return `${userId}:${conversationId}`;
}

function clearCall(call: ActiveCall) {
  clearTimeout(call.timeout);
  activeCalls.delete(call.callId);
  activeCallerConversations.delete(callKey(call.callerId, call.conversationId));
}

function callRateLimited(userId: string) {
  const now = Date.now();
  const window = callRateWindows.get(userId);
  if (!window || now - window.startedAt >= 60_000) {
    callRateWindows.set(userId, { startedAt: now, count: 1 });
    return false;
  }
  window.count += 1;
  return window.count > CALLS_PER_MINUTE;
}

function endCall(call: ActiveCall, reason: 'HANGUP' | 'TIMEOUT' | 'DISCONNECTED', excludingSocketId?: string) {
  clearCall(call);
  const event = { callId: call.callId, reason };
  if (call.callerSocketId !== excludingSocketId) realtime?.to(call.callerSocketId).emit('call:ended', event);
  if (call.recipientSocketId && call.recipientSocketId !== excludingSocketId) {
    realtime?.to(call.recipientSocketId).emit('call:ended', event);
  } else if (!call.recipientSocketId) {
    realtime?.to(`user:${call.recipientId}`).emit('call:ended', event);
  }
}

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

/** Publish a persisted message DTO. Callers must pass metadata-only selections, never attachment bytes. */
export function publishConversationMessage(conversationId: string, message: unknown) {
  realtime?.to(conversationRoom(conversationId)).emit('message:new', message);
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
        if (persisted.kind === 'created') {
          publishConversationMessage(input.data.conversationId, message);
        }
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
    socket.on('call:offer', async (raw, acknowledge: (result: unknown) => void = () => undefined) => {
      if (callRateLimited(user.id)) return acknowledge({ ok: false, error: 'RATE_LIMITED' });
      const input = callOfferSchema.safeParse(raw);
      if (!input.success) return acknowledge({ ok: false, error: 'INVALID_CALL' });
      const { callId, conversationId, sdp } = input.data;
      const callerConversationKey = callKey(user.id, conversationId);
      if (activeCalls.has(callId) || pendingCallIds.has(callId) || activeCallerConversations.has(callerConversationKey)) {
        return acknowledge({ ok: false, error: 'CALL_BUSY' });
      }
      // Reserve before awaits so concurrent offers cannot create two calls for this account/conversation.
      activeCallerConversations.set(callerConversationKey, callId);
      pendingCallIds.add(callId);
      try {
        const membership = await db.conversationMember.findUnique({
          where: { conversationId_userId: { conversationId, userId: user.id } },
          select: { userId: true },
        });
        if (!membership) {
          activeCallerConversations.delete(callerConversationKey);
          pendingCallIds.delete(callId);
          return acknowledge({ ok: false, error: 'FORBIDDEN' });
        }
        const members = await db.conversationMember.findMany({ where: { conversationId }, select: { userId: true } });
        const recipient = members.find(({ userId }) => userId !== user.id);
        if (members.length !== 2 || !recipient) {
          activeCallerConversations.delete(callerConversationKey);
          pendingCallIds.delete(callId);
          return acknowledge({ ok: false, error: 'INVALID_CONVERSATION' });
        }
        const call: ActiveCall = {
          callId, conversationId, callerId: user.id, callerSocketId: socket.id,
          recipientId: recipient.userId, recipientSocketId: null,
          timeout: setTimeout(() => {
            const active = activeCalls.get(callId);
            if (active) endCall(active, 'TIMEOUT');
          }, CALL_RINGING_MS),
        };
        call.timeout.unref?.();
        activeCalls.set(callId, call);
        pendingCallIds.delete(callId);
        // SDP remains opaque and is never emitted to the caller's other devices.
        realtime?.to(`user:${recipient.userId}`).emit('call:offer', { callId, conversationId, sdp });
        acknowledge({ ok: true });
      } catch (error) {
        if (activeCallerConversations.get(callerConversationKey) === callId) activeCallerConversations.delete(callerConversationKey);
        pendingCallIds.delete(callId);
        console.error('Failed to relay call offer', error);
        acknowledge({ ok: false, error: 'INTERNAL_ERROR' });
      }
    });
    socket.on('call:answer', (raw, acknowledge: (result: unknown) => void = () => undefined) => {
      const input = callAnswerSchema.safeParse(raw);
      if (!input.success) return acknowledge({ ok: false, error: 'INVALID_CALL' });
      const call = activeCalls.get(input.data.callId);
      if (!call) return acknowledge({ ok: false, error: 'NOT_FOUND' });
      // Claim synchronously: answers from a second device cannot receive or replace SDP state.
      if (call.recipientId !== user.id || call.recipientSocketId) return acknowledge({ ok: false, error: 'FORBIDDEN' });
      clearTimeout(call.timeout);
      call.recipientSocketId = socket.id;
      call.timeout = setTimeout(() => {
        const active = activeCalls.get(call.callId);
        if (active) endCall(active, 'TIMEOUT');
      }, CALL_MAX_DURATION_MS);
      call.timeout.unref?.();
      realtime?.to(call.callerSocketId).emit('call:answer', { callId: call.callId, sdp: input.data.sdp });
      acknowledge({ ok: true });
    });
    socket.on('call:candidate', (raw, acknowledge: (result: unknown) => void = () => undefined) => {
      const input = callCandidateSchema.safeParse(raw);
      if (!input.success) return acknowledge({ ok: false, error: 'INVALID_CALL' });
      const call = activeCalls.get(input.data.callId);
      if (!call) return acknowledge({ ok: false, error: 'NOT_FOUND' });
      if (!call.recipientSocketId) return acknowledge({ ok: false, error: 'CALL_NOT_ACCEPTED' });
      if (socket.id === call.callerSocketId) realtime?.to(call.recipientSocketId).emit('call:candidate', input.data);
      else if (socket.id === call.recipientSocketId) realtime?.to(call.callerSocketId).emit('call:candidate', input.data);
      else return acknowledge({ ok: false, error: 'FORBIDDEN' });
      acknowledge({ ok: true });
    });
    socket.on('call:hangup', (raw, acknowledge: (result: unknown) => void = () => undefined) => {
      const input = callHangupSchema.safeParse(raw);
      if (!input.success) return acknowledge({ ok: false, error: 'INVALID_CALL' });
      const call = activeCalls.get(input.data.callId);
      if (!call) return acknowledge({ ok: false, error: 'NOT_FOUND' });
      if (socket.id !== call.callerSocketId && socket.id !== call.recipientSocketId) return acknowledge({ ok: false, error: 'FORBIDDEN' });
      endCall(call, 'HANGUP', socket.id);
      acknowledge({ ok: true });
    });
    socket.on('disconnect', () => {
      for (const call of activeCalls.values()) {
        if (call.callerSocketId === socket.id || call.recipientSocketId === socket.id) endCall(call, 'DISCONNECTED', socket.id);
      }
    });
  });
  return io;
}
