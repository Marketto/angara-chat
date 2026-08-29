import { Router } from 'express';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { parse } from 'cookie';
import { OAuth2Client } from 'google-auth-library';
import { rateLimit } from 'express-rate-limit';
import { config } from './config.js';
import { db } from './db.js';
import { createSession, hashToken, readSessionToken, requireUser, sessionUser, SESSION_COOKIE } from './session.js';
import { clientLogSchema, contactDiscoverySchema, createConversationSchema, googleCredentialSchema, localTestLoginSchema, logoutSchema, pushEndpointSchema, pushSubscriptionSchema } from './schemas.js';
import { joinConversationMembers } from './socket.js';
import { latestConversationMessages } from './message-history.js';
import { attachmentRoutes } from './attachments.js';

const google = new OAuth2Client(config.GOOGLE_CLIENT_ID);
const authLimit = rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false });
const contactsLimit = rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false });
const OAUTH_STATE_COOKIE = 'chat_google_oauth_state';
const GOOGLE_REDIRECT_PATH = '/api/auth/google/redirect';
export const api = Router();
const clientLogs: Array<{ at: number; userId: string; code: string; context?: string }> = [];
const originHost = new URL(config.APP_ORIGIN).hostname;
const localTestAuthEnabled = config.NODE_ENV !== 'production' && ['localhost', '127.0.0.1', '::1'].includes(originHost) && !config.COOKIE_SECURE && Boolean(config.TEST_AUTH_TOKEN);

api.get('/health', async (_request, response) => {
  try {
    await db.$queryRaw`SELECT 1`;
    return response.status(200).json({ status: 'ok' });
  } catch {
    return response.status(503).json({ status: 'unavailable' });
  }
});

api.get('/config', (_request, response) => response.json({ googleClientId: config.GOOGLE_CLIENT_ID, vapidPublicKey: config.VAPID_PUBLIC_KEY, buildVersion: config.BUILD_VERSION, localTestAuthEnabled }));
api.get('/auth/google/start', (_request, response) => {
  const state = randomBytes(32).toString('base64url');
  response.cookie(OAUTH_STATE_COOKIE, state, { httpOnly: true, secure: config.COOKIE_SECURE, sameSite: 'lax', path: '/', maxAge: 600_000 });
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  for (const [key, value] of Object.entries({ client_id: config.GOOGLE_CLIENT_ID, redirect_uri: `${config.APP_ORIGIN}${GOOGLE_REDIRECT_PATH}`, response_type: 'code', scope: 'openid email profile', state, prompt: 'select_account' })) url.searchParams.set(key, value);
  return response.redirect(302, url.toString());
});
api.get('/auth/google/redirect', authLimit, async (request, response) => {
  const code = typeof request.query.code === 'string' ? request.query.code : '';
  const state = typeof request.query.state === 'string' ? request.query.state : '';
  const expected = parse(request.headers.cookie ?? '')[OAUTH_STATE_COOKIE];
  response.clearCookie(OAUTH_STATE_COOKIE, { path: '/' });
  if (!code || !expected || !safeEqual(expected, state)) return response.redirect(303, '/?auth_error=state');
  try {
    const tokens = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: config.GOOGLE_CLIENT_ID, client_secret: config.GOOGLE_CLIENT_SECRET, redirect_uri: `${config.APP_ORIGIN}${GOOGLE_REDIRECT_PATH}`, grant_type: 'authorization_code' }) });
    const body = await tokens.json() as { id_token?: unknown };
    if (!tokens.ok || typeof body.id_token !== 'string') throw new Error('token');
    const user = await googleUser(body.id_token);
    await createSession(user.id, response);
    return response.redirect(303, '/');
  } catch { return response.redirect(303, '/?auth_error=google'); }
});

api.post('/auth/google', authLimit, async (request, response) => {
  const input = googleCredentialSchema.safeParse(request.body);
  if (!input.success) return response.status(400).json({ error: 'INVALID_CREDENTIAL' });
  let user;
  try { user = await googleUser(input.data.credential); }
  catch { return response.status(401).json({ error: 'UNVERIFIED_GOOGLE_ACCOUNT' }); }
  await createSession(user.id, response);
  return response.json(user);
});

if (localTestAuthEnabled) api.post('/auth/local-test', authLimit, async (request, response) => {
  const token = request.get('x-test-auth-token') ?? '';
  if (!safeEqual(token, config.TEST_AUTH_TOKEN!)) return response.status(404).end();
  const input = localTestLoginSchema.safeParse(request.body);
  if (!input.success) return response.status(400).json({ error: 'INVALID_TEST_USER' });
  const digest = createHmac('sha256', config.TEST_AUTH_TOKEN!).update(input.data.email).digest('hex');
  const user = await db.user.upsert({
    where: { googleSub: `test:${digest}` }, update: { email: input.data.email },
    create: { googleSub: `test:${digest}`, email: input.data.email, name: 'Local test user' },
    select: { id: true, email: true, name: true, avatarUrl: true },
  });
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
  const input = logoutSchema.safeParse(request.body);
  if (!input.success) return response.status(400).json({ error: 'INVALID_LOGOUT' });
  const token = readSessionToken(request.headers.cookie);
  const user = await sessionUser(request.headers.cookie);
  if (user && input.data.pushEndpoint) await db.pushSubscription.deleteMany({ where: { userId: user.id, endpoint: input.data.pushEndpoint } });
  if (token) await db.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  response.clearCookie(SESSION_COOKIE, { path: '/' });
  response.status(204).end();
});

api.use(requireUser);
api.use(attachmentRoutes);
api.get('/calls/ice', (_request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  if (!config.TURN_URL || !config.TURN_AUTH_SECRET) return response.json({ iceServers: [] });
  // Coturn's REST authentication uses a short-lived, HMAC-derived password.
  // The long-lived secret is never sent to clients or logs.
  const username = `${Math.floor(Date.now() / 1_000) + 300}:${response.locals.user.id}`;
  const credential = createHmac('sha1', config.TURN_AUTH_SECRET).update(username).digest('base64');
  return response.json({ iceServers: [{ urls: [config.TURN_URL], username, credential }] });
});
api.post('/client-logs', (request, response) => {
  const input = clientLogSchema.safeParse(request.body);
  if (!input.success) return response.status(400).json({ error: 'INVALID_LOG' });
  const cutoff = Date.now() - 16 * 60 * 60 * 1000;
  while (clientLogs.length > 0 && clientLogs[0]!.at < cutoff) clientLogs.shift();
  if (clientLogs.length < 1000) {
    const entry = { at: Date.now(), userId: response.locals.user.id, code: input.data.code };
    clientLogs.push(input.data.context ? { ...entry, context: input.data.context } : entry);
  }
  return response.status(204).end();
});
api.get('/me', (_request, response) => response.json(response.locals.user));

api.post('/contacts/discover', contactsLimit, async (request, response) => {
  const input = contactDiscoverySchema.safeParse(request.body);
  if (!input.success) return response.status(400).json({ error: 'INVALID_CONTACTS' });
  const users = await db.user.findMany({
    where: {
      email: { in: [...new Set(input.data.emails)] },
      id: { not: response.locals.user.id },
      // Direct conversations are unique, so any shared conversation means this
      // person is already visible in the user's chat list.
      memberships: { none: { conversation: { members: { some: { userId: response.locals.user.id } } } } },
    },
    select: { id: true, email: true, name: true, avatarUrl: true }, take: 100,
  });
  return response.json(users);
});

api.get('/conversations', async (_request, response) => {
  const conversations = await db.conversation.findMany({
    where: { members: { some: { userId: response.locals.user.id } } },
    select: {
      id: true,
      members: { where: { userId: { not: response.locals.user.id } }, select: { user: { select: { id: true, name: true, avatarUrl: true } } } },
      messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } },
    },
  });
  return response.json(conversations.map((item) => {
    const peer = item.members[0]?.user;
    return {
      id: item.id,
      peer: peer ? { id: peer.id, name: peer.name, avatarUrl: peer.avatarUrl } : null,
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
  joinConversationMembers(conversation.id, ids);
  return response.json(conversation);
});

api.get('/conversations/:id/messages', async (request, response) => {
  const conversationId = String(request.params.id);
  const membership = await db.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId: response.locals.user.id } },
  });
  if (!membership) return response.status(404).json({ error: 'CONVERSATION_NOT_FOUND' });
  return response.json(await latestConversationMessages(conversationId));
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
api.delete('/push/subscriptions', async (request, response) => {
  const input = pushEndpointSchema.safeParse(request.body);
  if (!input.success) return response.status(400).json({ error: 'INVALID_SUBSCRIPTION' });
  await db.pushSubscription.deleteMany({ where: { userId: response.locals.user.id, endpoint: input.data.endpoint } });
  return response.status(204).end();
});
