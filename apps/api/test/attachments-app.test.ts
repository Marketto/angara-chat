import { createHash } from 'node:crypto';
import type { Server } from 'node:http';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  membership: vi.fn(),
  aggregate: vi.fn(),
  createMessage: vi.fn(),
  findMessage: vi.fn(),
  findAttachment: vi.fn(),
  publish: vi.fn(),
  notify: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('../src/db.js', () => ({ db: {
  session: { findFirst: mocks.session },
  conversationMember: { findUnique: mocks.membership },
  messageAttachment: { aggregate: mocks.aggregate, findFirst: mocks.findAttachment },
  message: { create: mocks.createMessage, findUnique: mocks.findMessage },
  $transaction: mocks.transaction,
} }));
vi.mock('../src/socket.js', () => ({ joinConversationMembers: vi.fn(), publishConversationMessage: mocks.publish }));
vi.mock('../src/push.js', () => ({ notifyConversation: mocks.notify }));

const bytes = Buffer.alloc(24);
bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
bytes.writeUInt32BE(640, 16);
bytes.writeUInt32BE(480, 20);
const digest = createHash('sha256').update(bytes).digest('hex');
const message = {
  id: 'message-app', clientId: '6fb0e9cc-f457-4f30-8fb3-fb8c11dd11aa', conversationId: 'conversation-1',
  senderId: 'user-app', kind: 'IMAGE', body: '', locationLatitude: null, locationLongitude: null,
  locationAccuracy: null, createdAt: new Date('2026-08-29T12:00:00Z'),
  attachment: { id: 'attachment-app', fileName: 'foto.png', mediaType: 'image/png', byteSize: bytes.length, sha256: digest },
};
const servers: Server[] = [];

beforeAll(() => {
  Object.assign(process.env, {
    NODE_ENV: 'test', APP_ORIGIN: 'http://localhost:5173',
    DATABASE_URL: 'postgresql://chat:test@localhost:5432/chat_test',
    GOOGLE_CLIENT_ID: 'test-client-id.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'test-client-secret',
    VAPID_PUBLIC_KEY: 'test-public-key', VAPID_PRIVATE_KEY: 'test-private-key',
    VAPID_SUBJECT: 'mailto:test@example.com', COOKIE_SECURE: 'false',
  });
});

async function appRequest(path: string, init?: RequestInit) {
  const { app } = await import('../src/app.js');
  const server = app.listen(0, '127.0.0.1');
  servers.push(server);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test server address');
  return fetch(`http://127.0.0.1:${address.port}${path}`, init);
}

function authenticatedHeaders(extra: Record<string, string> = {}) {
  return { cookie: 'chat_session=test-token', origin: 'http://localhost:5173', ...extra };
}

function uploadHeaders(extra: Record<string, string> = {}) {
  return authenticatedHeaders({
    'content-type': 'image/png', 'x-client-id': message.clientId, 'x-attachment-kind': 'IMAGE',
    'x-file-name': encodeURIComponent('foto.png'), 'x-content-sha256': digest, ...extra,
  });
}

describe('attachment routes mounted in the real Express app', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ user: { id: 'user-app', email: 'marco@example.test', name: 'Marco', avatarUrl: null } });
    mocks.membership.mockResolvedValue({ conversationId: 'conversation-1' });
    mocks.aggregate.mockResolvedValue({ _sum: { byteSize: 0 } });
    mocks.createMessage.mockResolvedValue(message);
    mocks.notify.mockResolvedValue(undefined);
    mocks.transaction.mockImplementation((callback: (transaction: unknown) => unknown) => callback({
      message: { create: mocks.createMessage }, messageAttachment: { aggregate: mocks.aggregate },
    }));
  });
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))));
  });

  it('allows only the exact OpenStreetMap tile origin and local blob previews in CSP', async () => {
    const response = await appRequest('/api/config');
    const policy = response.headers.get('content-security-policy') ?? '';
    expect(policy).toContain("img-src 'self' data: blob:");
    expect(policy).toContain('https://tile.openstreetmap.org');
    expect(policy).not.toContain('https://*.openstreetmap.org');
  });

  it('returns 401 without a session and 403 for missing or foreign Origin', async () => {
    const unauthenticated = await appRequest('/api/conversations/conversation-1/attachments', {
      method: 'POST', headers: { ...uploadHeaders(), cookie: '' }, body: bytes,
    });
    expect(unauthenticated.status).toBe(401);

    const missingOrigin = await appRequest('/api/conversations/conversation-1/attachments', {
      method: 'POST', headers: { ...uploadHeaders(), origin: '' }, body: bytes,
    });
    expect(missingOrigin.status).toBe(403);
    const foreignOrigin = await appRequest('/api/conversations/conversation-1/attachments', {
      method: 'POST', headers: uploadHeaders({ origin: 'https://attacker.example' }), body: bytes,
    });
    expect(foreignOrigin.status).toBe(403);
  });

  it('accepts a member upload and rejects a non-member before buffering an oversized body', async () => {
    const accepted = await appRequest('/api/conversations/conversation-1/attachments', {
      method: 'POST', headers: uploadHeaders(), body: bytes,
    });
    expect(accepted.status).toBe(201);

    mocks.membership.mockResolvedValue(null);
    const rejected = await appRequest('/api/conversations/conversation-1/attachments', {
      method: 'POST', headers: uploadHeaders({ 'content-type': 'application/json' }), body: Buffer.alloc(8 * 1024 * 1024 + 1),
    });
    expect(rejected.status).toBe(404);
    expect(mocks.aggregate).toHaveBeenCalledTimes(2);
  });

  it('returns 401 for anonymous downloads and 200/404 according to membership in one joined query', async () => {
    const anonymous = await appRequest('/api/attachments/attachment-app');
    expect(anonymous.status).toBe(401);

    mocks.findAttachment.mockResolvedValue({
      fileName: 'foto.png', mediaType: 'image/png', byteSize: bytes.length, data: bytes, message: { kind: 'IMAGE' },
    });
    const authorized = await appRequest('/api/attachments/attachment-app', { headers: authenticatedHeaders() });
    expect(authorized.status).toBe(200);
    expect(authorized.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    expect(mocks.findAttachment).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'attachment-app', message: { conversation: { members: { some: { userId: 'user-app' } } } } },
    }));

    mocks.findAttachment.mockResolvedValue(null);
    const forbidden = await appRequest('/api/attachments/attachment-app', { headers: authenticatedHeaders() });
    expect(forbidden.status).toBe(404);
  });
});
