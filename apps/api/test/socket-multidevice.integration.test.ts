import { createServer, type Server as HttpServer } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { io as createClient, type Socket as ClientSocket } from 'socket.io-client';

const conversationId = 'conversation-multidevice';
const users = {
  'alice-device-1': { id: 'alice', email: 'alice@example.test', name: 'Alice', avatarUrl: null },
  'alice-device-2': { id: 'alice', email: 'alice@example.test', name: 'Alice', avatarUrl: null },
  'bob-device-1': { id: 'bob', email: 'bob@example.test', name: 'Bob', avatarUrl: null },
} as const;

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(async ({ where }: { where: { userId: string } }) => where.userId === 'alice' || where.userId === 'bob' ? [{ conversationId: 'conversation-multidevice' }] : []),
  findUnique: vi.fn(async ({ where }: { where: { conversationId_userId: { conversationId: string; userId: string } } }) => {
    const membership = where.conversationId_userId;
    return membership.conversationId === 'conversation-multidevice' && ['alice', 'bob'].includes(membership.userId) ? membership : null;
  }),
  notifyConversation: vi.fn(async () => undefined),
  persistMessage: vi.fn(async (input: { conversationId: string; clientId: string; body: string }, senderId: string) => ({
    kind: 'created' as const,
    message: { id: `message-${input.clientId}`, ...input, senderId, createdAt: new Date() },
  })),
  sessionUser: vi.fn(async (cookie?: string) => users[(cookie?.replace('device=', '') ?? '') as keyof typeof users] ?? null),
}));

vi.mock('../src/db.js', () => ({
  db: { conversationMember: { findMany: mocks.findMany, findUnique: mocks.findUnique } },
}));
vi.mock('../src/message-persistence.js', () => ({ persistMessage: mocks.persistMessage }));
vi.mock('../src/push.js', () => ({ notifyConversation: mocks.notifyConversation }));
vi.mock('../src/session.js', () => ({ sessionUser: mocks.sessionUser }));

let server: HttpServer;
let realtime: ReturnType<typeof import('../src/socket.js').attachSocket>;
const clients: ClientSocket[] = [];

function event<T>(socket: ClientSocket, name: string) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${name}`)), 5_000);
    socket.once(name, (value: T) => {
      clearTimeout(timer);
      resolve(value);
    });
  });
}

async function connect(device: keyof typeof users) {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server is not listening');
  const socket = createClient(`http://127.0.0.1:${address.port}`, {
    autoConnect: false,
    transports: ['websocket'],
    extraHeaders: { Origin: 'http://localhost:5173', Cookie: `device=${device}` },
    reconnection: false,
  });
  clients.push(socket);
  const ready = event<void>(socket, 'delivery:ready');
  socket.connect();
  await ready;
  return socket;
}

function send(socket: ClientSocket, body: string) {
  const clientId = crypto.randomUUID();
  return new Promise<{ ok: true; message: { clientId: string; senderId: string; body: string } }>((resolve, reject) => {
    socket.timeout(5_000).emit('message:send', { conversationId, clientId, body }, (error: Error | null, acknowledgement: { ok: true; message: { clientId: string; senderId: string; body: string } }) => {
      if (error) reject(error);
      else resolve(acknowledgement);
    });
  });
}

beforeAll(async () => {
  Object.assign(process.env, {
    APP_ORIGIN: 'http://localhost:5173',
    DATABASE_URL: 'postgresql://chat:test@localhost:5432/chat_test',
    GOOGLE_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'test-client-secret',
    VAPID_PUBLIC_KEY: 'test-public-key',
    VAPID_PRIVATE_KEY: 'test-private-key',
    VAPID_SUBJECT: 'mailto:test@example.com',
    COOKIE_SECURE: 'false',
  });
  const { attachSocket } = await import('../src/socket.js');
  server = createServer();
  realtime = attachSocket(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
});

afterAll(async () => {
  clients.forEach((client) => client.close());
  await new Promise<void>((resolve) => realtime.close(() => resolve()));
});

describe('multi-device realtime delivery', () => {
  it('relays both directions to the recipient and every device of the sender', async () => {
    const [aliceOne, aliceTwo, bob] = await Promise.all([
      connect('alice-device-1'),
      connect('alice-device-2'),
      connect('bob-device-1'),
    ]);

    const aliceTwoReceives = event<{ senderId: string; body: string }>(aliceTwo, 'message:new');
    const bobReceives = event<{ senderId: string; body: string }>(bob, 'message:new');
    const sent = await send(aliceOne, 'ciao da Alice');

    expect(sent).toMatchObject({ ok: true, message: { senderId: 'alice', body: 'ciao da Alice' } });
    await expect(aliceTwoReceives).resolves.toMatchObject({ senderId: 'alice', body: 'ciao da Alice' });
    await expect(bobReceives).resolves.toMatchObject({ senderId: 'alice', body: 'ciao da Alice' });

    const aliceOneReceives = event<{ senderId: string; body: string }>(aliceOne, 'message:new');
    const aliceTwoReceivesReply = event<{ senderId: string; body: string }>(aliceTwo, 'message:new');
    const replied = await send(bob, 'risposta da Bob');

    expect(replied).toMatchObject({ ok: true, message: { senderId: 'bob', body: 'risposta da Bob' } });
    await expect(aliceOneReceives).resolves.toMatchObject({ senderId: 'bob', body: 'risposta da Bob' });
    await expect(aliceTwoReceivesReply).resolves.toMatchObject({ senderId: 'bob', body: 'risposta da Bob' });
  });
});
