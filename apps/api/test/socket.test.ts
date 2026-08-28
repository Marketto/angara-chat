import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server as HttpServer } from 'node:http';

const mocks = vi.hoisted(() => ({
  serverUse: vi.fn(),
  serverOn: vi.fn(),
  serverIn: vi.fn(() => ({ socketsJoin: vi.fn() })),
  roomEmit: vi.fn(),
  findMany: vi.fn(),
  findUnique: vi.fn(),
  persistMessage: vi.fn(),
  notifyConversation: vi.fn(),
  sessionUser: vi.fn(),
}));

vi.mock('socket.io', () => ({
  Server: class {
    use = mocks.serverUse;
    on = mocks.serverOn;
    in = mocks.serverIn;
    to = vi.fn(() => ({ emit: mocks.roomEmit }));
  },
}));
vi.mock('../src/db.js', () => ({
  db: { conversationMember: { findMany: mocks.findMany, findUnique: mocks.findUnique } },
}));
vi.mock('../src/message-persistence.js', () => ({ persistMessage: mocks.persistMessage }));
vi.mock('../src/push.js', () => ({ notifyConversation: mocks.notifyConversation }));
vi.mock('../src/session.js', () => ({ sessionUser: mocks.sessionUser }));

let attachSocket: typeof import('../src/socket.js').attachSocket;

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
  ({ attachSocket } = await import('../src/socket.js'));
});

type Middleware = (socket: { handshake: { headers: Record<string, string | undefined> }; data: Record<string, unknown> }, next: (error?: Error) => void) => Promise<void>;
type Connection = (socket: TestSocket) => void;
type Handler = (...args: unknown[]) => unknown;

interface TestSocket {
  data: { user: { id: string; name: string; avatarUrl: null } };
  join: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  emit: ReturnType<typeof vi.fn>;
}

function serverCallbacks() {
  attachSocket({} as HttpServer);
  return {
    middleware: mocks.serverUse.mock.calls.at(-1)?.[0] as Middleware,
    connection: mocks.serverOn.mock.calls.findLast(([event]) => event === 'connection')?.[1] as Connection,
  };
}

function testSocket() {
  const handlers = new Map<string, Handler>();
  const socket: TestSocket = {
    data: { user: { id: 'user-1', name: 'Marco', avatarUrl: null } },
    join: vi.fn(async () => undefined),
    on: vi.fn((event: string, handler: Handler) => { handlers.set(event, handler); }),
    emit: vi.fn(),
  };
  return { socket, handlers };
}

describe('socket message delivery setup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findMany.mockResolvedValue([]);
    mocks.findUnique.mockResolvedValue({ conversationId: 'conversation-1', userId: 'user-1' });
    mocks.notifyConversation.mockResolvedValue(undefined);
    mocks.sessionUser.mockResolvedValue({ id: 'user-1', name: 'Marco', avatarUrl: null });
  });

  it('accepts an exact Origin header', async () => {
    const { middleware } = serverCallbacks();
    const socket = { handshake: { headers: { origin: 'http://localhost:5173' } }, data: {} };
    const next = vi.fn();

    await middleware(socket, next);

    expect(next).toHaveBeenCalledWith();
    expect(socket.data).toEqual({ user: { id: 'user-1', name: 'Marco', avatarUrl: null } });
  });

  it('accepts a same-origin browser handshake when Origin is omitted', async () => {
    const { middleware } = serverCallbacks();
    const socket = { handshake: { headers: { host: 'localhost:5173', 'sec-fetch-site': 'same-origin' } }, data: {} };
    const next = vi.fn();

    await middleware(socket, next);

    expect(next).toHaveBeenCalledWith();
    expect(mocks.sessionUser).toHaveBeenCalled();
  });

  it('still rejects an unauthenticated same-origin handshake', async () => {
    mocks.sessionUser.mockResolvedValue(null);
    const { middleware } = serverCallbacks();
    const next = vi.fn();

    await middleware({ handshake: { headers: { host: 'localhost:5173', 'sec-fetch-site': 'same-origin' } }, data: {} }, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'unauthorized' }));
  });

  it.each([
    { origin: 'https://attacker.example', host: 'localhost:5173', 'sec-fetch-site': 'same-origin' },
    { origin: 'not-a-url', host: 'localhost:5173', 'sec-fetch-site': 'same-origin' },
    { host: 'attacker.example', 'sec-fetch-site': 'same-origin' },
    { host: 'localhost:5173', 'sec-fetch-site': 'cross-site' },
    { host: 'localhost:5173' },
  ])('rejects a foreign or unverifiable handshake: %j', async (headers) => {
    const { middleware } = serverCallbacks();
    const next = vi.fn();

    await middleware({ handshake: { headers }, data: {} }, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'invalid origin' }));
    expect(mocks.sessionUser).not.toHaveBeenCalled();
  });

  it('registers handlers immediately but waits for room readiness before delivery', async () => {
    let releaseMemberships!: (memberships: Array<{ conversationId: string }>) => void;
    mocks.findMany.mockReturnValue(new Promise((resolve) => { releaseMemberships = resolve; }));
    const message = {
      id: 'message-1', clientId: crypto.randomUUID(), conversationId: 'conversation-1',
      senderId: 'user-1', body: 'ciao', createdAt: new Date(),
    };
    mocks.persistMessage.mockResolvedValue({ kind: 'retry', message });
    const { connection } = serverCallbacks();
    const { socket, handlers } = testSocket();

    connection(socket);
    const send = handlers.get('message:send');
    expect(send).toBeTypeOf('function');
    const acknowledge = vi.fn();
    const sending = send?.({ conversationId: 'conversation-1', clientId: message.clientId, body: 'ciao' }, acknowledge) as Promise<void>;
    await Promise.resolve();

    expect(mocks.persistMessage).not.toHaveBeenCalled();
    expect(socket.emit).not.toHaveBeenCalledWith('delivery:ready');
    releaseMemberships([{ conversationId: 'conversation-1' }]);
    await sending;

    expect(socket.join).toHaveBeenCalledWith('user:user-1');
    expect(socket.join).toHaveBeenCalledWith('conversation:conversation-1');
    expect(socket.emit).toHaveBeenCalledWith('delivery:ready');
    expect(mocks.roomEmit).toHaveBeenCalledWith('message:new', message);
    expect(acknowledge).toHaveBeenCalledWith({ ok: true, message });
    expect(mocks.notifyConversation).not.toHaveBeenCalled();
  });
});
