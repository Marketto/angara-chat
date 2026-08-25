import { Router } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { parse } from 'cookie';
import { OAuth2Client } from 'google-auth-library';
import { rateLimit } from 'express-rate-limit';
import { config } from './config.js';
import { db } from './db.js';
import { createSession, hashToken, readSessionToken, requireUser, sessionUser, SESSION_COOKIE } from './session.js';
import { contactDiscoverySchema, createConversationSchema, deviceRegistrationSchema, googleCredentialSchema, pushSubscriptionSchema } from './schemas.js';

const google = new OAuth2Client(config.GOOGLE_CLIENT_ID);
const authLimit = rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false });
export const api = Router();

api.get('/health', async (_request, response) => {
  try {
    await db.$queryRaw`SELECT 1`;
    return response.status(200).json({ status: 'ok' });
  } catch {
    return response.status(503).json({ status: 'unavailable' });
  }
});

api.get('/config', (_request, response) => response.json({ googleClientId: config.GOOGLE_CLIENT_ID, vapidPublicKey: config.VAPID_PUBLIC_KEY, buildVersion: config.BUILD_VERSION }));

api.post('/auth/google', authLimit, async (request, response) => {
  const input = googleCredentialSchema.safeParse(request.body);
  if (!input.success) return response.status(400).json({ error: 'INVALID_CREDENTIAL' });
  let user;
  try { user = await googleUser(input.data.credential); }
  catch { return response.status(401).json({ error: 'UNVERIFIED_GOOGLE_ACCOUNT' }); }
  await createSession(user.id, response);
  return response.json(user);
});

api.post('/auth/google/redirect', authLimit, async (request, response) => {
  const input = googleCredentialSchema.safeParse(request.body);
  const csrfCookie = parse(request.headers.cookie ?? '').g_csrf_token;
  const csrfBody = typeof request.body?.g_csrf_token === 'string' ? request.body.g_csrf_token : undefined;
  if (!input.success || !csrfCookie || !csrfBody || !safeEqual(csrfCookie, csrfBody)) {
    return response.status(400).send('Invalid Google sign-in response.');
  }
  let user;
  try { user = await googleUser(input.data.credential); }
  catch { return response.status(401).send('Google sign-in could not be verified.'); }
  await createSession(user.id, response);
  return response.redirect(303, '/');
});

async function googleUser(credential: string) {
  const ticket = await google.verifyIdToken({ idToken: credential, audience: config.GOOGLE_CLIENT_ID });
  const payload = ticket.getPayload();
  if (!payload?.sub || !payload.email || !payload.email_verified || !payload.name) throw new Error('UNVERIFIED_GOOGLE_ACCOUNT');
  return db.user.upsert({
    where: { googleSub: payload.sub },
    update: { email: payload.email.toLowerCase(), name: payload.name, avatarUrl: payload.picture ?? null },
    create: { googleSub: payload.sub, email: payload.email.toLowerCase(), name: payload.name, avatarUrl: payload.picture ?? null },
    select: { id: true, email: true, name: true, avatarUrl: true },
  });
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

api.post('/auth/logout', async (request, response) => {
  const token = readSessionToken(request.headers.cookie);
  const user = await sessionUser(request.headers.cookie);
  if (user) await db.pushSubscription.deleteMany({ where: { userId: user.id } });
  if (token) await db.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  response.clearCookie(SESSION_COOKIE, { path: '/' });
  response.status(204).end();
});

api.use(requireUser);
api.get('/me', (_request, response) => response.json(response.locals.user));

api.get('/crypto/device', async (_request, response) => {
  const device = await db.device.findUnique({
    where: { userId: response.locals.user.id },
    select: { id: true, publicKey: true, fingerprint: true },
  });
  return response.json(device);
});

api.post('/crypto/device', async (request, response) => {
  const input = deviceRegistrationSchema.safeParse(request.body);
  if (!input.success) return response.status(400).json({ error: 'INVALID_DEVICE_KEY' });
  const existing = await db.device.findUnique({ where: { userId: response.locals.user.id } });
  const publicKey = {
    kty: 'EC', crv: 'P-256', x: input.data.publicKey.x, y: input.data.publicKey.y, ext: true, key_ops: [] as string[],
  };
  const fingerprint = createHash('sha256')
    .update(`P-256:${publicKey.x}:${publicKey.y}`)
    .digest('hex');
  if (existing) {
    if (existing.id === input.data.id && existing.fingerprint === fingerprint) {
      return response.json({ id: existing.id, publicKey: existing.publicKey, fingerprint: existing.fingerprint });
    }
    return response.status(409).json({ error: 'DEVICE_ALREADY_REGISTERED' });
  }
  const device = await db.device.create({
    data: { id: input.data.id, userId: response.locals.user.id, publicKey, fingerprint },
    select: { id: true, publicKey: true, fingerprint: true },
  });
  return response.status(201).json(device);
});

api.post('/contacts/discover', async (request, response) => {
  const input = contactDiscoverySchema.safeParse(request.body);
  if (!input.success) return response.status(400).json({ error: 'INVALID_CONTACTS' });
  const users = await db.user.findMany({
    where: { email: { in: [...new Set(input.data.emails)] }, id: { not: response.locals.user.id } },
    select: { id: true, email: true, name: true, avatarUrl: true }, take: 100,
  });
  return response.json(users);
});

api.get('/conversations', async (_request, response) => {
  const conversations = await db.conversation.findMany({
    where: { members: { some: { userId: response.locals.user.id } } },
    select: {
      id: true,
      members: { where: { userId: { not: response.locals.user.id } }, select: { user: { select: { id: true, name: true, avatarUrl: true, devices: { take: 1, select: { id: true, publicKey: true, fingerprint: true } } } } } },
      messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } },
    },
  });
  return response.json(conversations.map((item) => {
    const peer = item.members[0]?.user;
    return {
      id: item.id,
      peer: peer ? { id: peer.id, name: peer.name, avatarUrl: peer.avatarUrl, device: peer.devices[0] ?? null } : null,
      lastMessage: item.messages[0] ?? null,
    };
  }));
});

api.post('/conversations', async (request, response) => {
  const input = createConversationSchema.safeParse(request.body);
  if (!input.success || input.data.participantId === response.locals.user.id) return response.status(400).json({ error: 'INVALID_PARTICIPANT' });
  const participant = await db.user.findUnique({ where: { id: input.data.participantId }, select: { id: true } });
  if (!participant) return response.status(404).json({ error: 'USER_NOT_FOUND' });
  const ids = [response.locals.user.id, participant.id].sort();
  const directKey = ids.join(':');
  const conversation = await db.conversation.upsert({
    where: { directKey },
    update: {},
    create: { directKey, members: { create: ids.map((userId) => ({ userId })) } },
    select: { id: true },
  });
  return response.json(conversation);
});

api.get('/conversations/:id/messages', async (request, response) => {
  const conversationId = String(request.params.id);
  const membership = await db.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId: response.locals.user.id } },
  });
  if (!membership) return response.status(404).json({ error: 'CONVERSATION_NOT_FOUND' });
  const messages = await db.message.findMany({
    where: { conversationId }, orderBy: { createdAt: 'asc' }, take: 100,
    select: { id: true, clientId: true, senderId: true, senderDeviceId: true, recipientDeviceId: true, ciphertext: true, iv: true, version: true, createdAt: true },
  });
  return response.json(messages);
});

api.post('/push/subscriptions', async (request, response) => {
  const input = pushSubscriptionSchema.safeParse(request.body);
  if (!input.success) return response.status(400).json({ error: 'INVALID_SUBSCRIPTION' });
  await db.pushSubscription.upsert({
    where: { endpoint: input.data.endpoint },
    update: { userId: response.locals.user.id, ...input.data.keys },
    create: { userId: response.locals.user.id, endpoint: input.data.endpoint, ...input.data.keys },
  });
  return response.status(204).end();
});
