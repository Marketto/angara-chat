import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server as HttpServer } from 'node:http';

const mocks = vi.hoisted(() => ({
  serverUse: vi.fn(),
  serverOn: vi.fn(),
  serverIn: vi.fn(() => ({ socketsJoin: vi.fn() })),
  serverTo: vi.fn(() => ({ emit: vi.fn() })),
  findMany: vi.fn(),
}));

vi.mock('socket.io', () => ({
  Server: class {
    use = mocks.serverUse;
    on = mocks.serverOn;
    in = mocks.serverIn;
    to = mocks.serverTo;
  },
}));
vi.mock('../src/db.js', () => ({
  db: { conversationMember: { findMany: mocks.findMany, findUnique: vi.fn() } },
}));
vi.mock('../src/message-persistence.js', () => ({ persistMessage: vi.fn() }));
vi.mock('../src/push.js', () => ({ notifyConversation: vi.fn() }));
vi.mock('../src/session.js', () => ({ sessionUser: vi.fn() }));

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

describe('socket message delivery setup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findMany.mockResolvedValue([]);
  });

  it('registers message handling before asynchronous room initialization finishes', () => {
    attachSocket({} as HttpServer);
    const connection = mocks.serverOn.mock.calls.find(([event]) => event === 'connection')?.[1] as ((socket: {
      data: { user: { id: string; name: string; avatarUrl: null } };
      join: ReturnType<typeof vi.fn>;
      on: ReturnType<typeof vi.fn>;
    }) => void) | undefined;
    const socket = {
      data: { user: { id: 'user-1', name: 'Marco', avatarUrl: null } },
      join: vi.fn(() => Promise.resolve()),
      on: vi.fn(),
    };

    connection?.(socket);

    expect(connection).toBeTypeOf('function');
    expect(socket.on).toHaveBeenCalledWith('message:send', expect.any(Function));
  });
});
