import express from 'express';
import type { Server } from 'node:http';
import { request as nodeRequest } from 'node:http';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  membership: vi.fn(),
  createMessage: vi.fn(),
  findMessage: vi.fn(),
  findAttachment: vi.fn(),
  aggregateAttachments: vi.fn(),
  publish: vi.fn(),
  notify: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('../src/db.js', () => {
  const db = {
  conversationMember: { findUnique: mocks.membership },
  message: { create: mocks.createMessage, findUnique: mocks.findMessage },
  messageAttachment: { findFirst: mocks.findAttachment, aggregate: mocks.aggregateAttachments },
  };
  return { db: { ...db, $transaction: mocks.transaction } };
});
vi.mock('../src/socket.js', () => ({ publishConversationMessage: mocks.publish }));
vi.mock('../src/push.js', () => ({ notifyConversation: mocks.notify }));

const clientId = '6fb0e9cc-f457-4f30-8fb3-fb8c11dd11aa';
const bytes = Buffer.alloc(24);
bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
bytes.writeUInt32BE(800, 16);
bytes.writeUInt32BE(600, 20);
const sha256 = createHash('sha256').update(bytes).digest('hex');
const message = {
  id: 'message-1', clientId, conversationId: 'conversation-1', senderId: 'user-1',
  kind: 'IMAGE', body: '', locationLatitude: null, locationLongitude: null,
  locationAccuracy: null, createdAt: new Date('2026-08-29T12:00:00Z'),
  attachment: { id: 'attachment-1', fileName: 'lago.png', mediaType: 'image/png', byteSize: bytes.length, sha256 },
};

const servers: Server[] = [];

async function request(path: string, init?: RequestInit) {
  const { attachmentRoutes } = await import('../src/attachments.js');
  const app = express();
  app.use((_request, response, next) => {
    response.locals.user = { id: 'user-1', name: 'Marco', avatarUrl: null };
    next();
  });
  app.use(attachmentRoutes);
  const server = app.listen(0, '127.0.0.1');
  servers.push(server);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test server address');
  return fetch(`http://127.0.0.1:${address.port}${path}`, init);
}

async function chunkedUpload(path: string, headers: Record<string, string>, body: Buffer) {
  const { attachmentRoutes } = await import('../src/attachments.js');
  const app = express();
  app.use((_request, response, next) => {
    response.locals.user = { id: 'user-1', name: 'Marco', avatarUrl: null };
    next();
  });
  app.use(attachmentRoutes);
  const server = app.listen(0, '127.0.0.1');
  servers.push(server);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test server address');
  return new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    const outgoing = nodeRequest({ host: '127.0.0.1', port: address.port, path, method: 'POST', headers }, (incoming) => {
      const chunks: Buffer[] = [];
      incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
      incoming.on('end', () => resolve({ status: incoming.statusCode ?? 0, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    outgoing.on('error', reject);
    for (let offset = 0; offset < body.length; offset += 1024 * 1024) outgoing.write(body.subarray(offset, offset + 1024 * 1024));
    outgoing.end();
  });
}

function uploadHeaders(overrides: Record<string, string> = {}) {
  return {
    'content-type': 'image/png',
    'x-client-id': clientId,
    'x-attachment-kind': 'IMAGE',
    'x-file-name': encodeURIComponent('lago.png'),
    'x-content-sha256': sha256,
    ...overrides,
  };
}

describe('attachment HTTP routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.membership.mockResolvedValue({ conversationId: 'conversation-1', userId: 'user-1' });
    mocks.createMessage.mockResolvedValue(message);
    mocks.aggregateAttachments.mockResolvedValue({ _sum: { byteSize: 0 } });
    mocks.transaction.mockImplementation((callback: (transaction: unknown) => unknown) => callback({
      message: { create: mocks.createMessage }, messageAttachment: { aggregate: mocks.aggregateAttachments },
    }));
    mocks.notify.mockResolvedValue(undefined);
  });
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))));
  });

  it('validates metadata, MIME allowlist and digest without storing bytes on errors', async () => {
    const invalidMime = await request('/conversations/conversation-1/attachments', {
      method: 'POST', headers: uploadHeaders({ 'content-type': 'image/svg+xml' }), body: bytes,
    });
    expect(invalidMime.status).toBe(400);
    expect(await invalidMime.json()).toEqual({ error: 'INVALID_ATTACHMENT' });
    expect(mocks.createMessage).not.toHaveBeenCalled();

    const fakeImage = Buffer.from('not really a png');
    const invalidMagic = await request('/conversations/conversation-1/attachments', {
      method: 'POST',
      headers: uploadHeaders({ 'x-content-sha256': createHash('sha256').update(fakeImage).digest('hex') }),
      body: fakeImage,
    });
    expect(invalidMagic.status).toBe(400);
    expect(await invalidMagic.json()).toEqual({ error: 'INVALID_ATTACHMENT' });

    const html = Buffer.from('<!doctype html><html>not a document</html>');
    const invalidText = await request('/conversations/conversation-1/attachments', {
      method: 'POST', headers: uploadHeaders({
        'content-type': 'text/plain', 'x-attachment-kind': 'DOCUMENT', 'x-file-name': encodeURIComponent('pagina.txt'),
        'x-content-sha256': createHash('sha256').update(html).digest('hex'),
      }), body: html,
    });
    expect(invalidText.status).toBe(400);

    const maliciousName = await request('/conversations/conversation-1/attachments', {
      method: 'POST', headers: uploadHeaders({ 'x-file-name': encodeURIComponent('foto\r\nX-Evil: yes.png') }), body: bytes,
    });
    expect(maliciousName.status).toBe(400);

    const invalidHash = await request('/conversations/conversation-1/attachments', {
      method: 'POST', headers: uploadHeaders({ 'x-content-sha256': '0'.repeat(64) }), body: bytes,
    });
    expect(invalidHash.status).toBe(400);
    expect(await invalidHash.json()).toEqual({ error: 'HASH_MISMATCH' });
    expect(mocks.createMessage).not.toHaveBeenCalled();
  });

  it('requires conversation membership', async () => {
    mocks.membership.mockResolvedValue(null);
    const response = await request('/conversations/conversation-1/attachments', {
      method: 'POST', headers: uploadHeaders(), body: bytes,
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'CONVERSATION_NOT_FOUND' });
    expect(mocks.createMessage).not.toHaveBeenCalled();
  });

  it('stores an attachment atomically and publishes metadata without bytes', async () => {
    const response = await request('/conversations/conversation-1/attachments', {
      method: 'POST', headers: uploadHeaders(), body: bytes,
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ...message, createdAt: message.createdAt.toISOString() });
    expect(mocks.createMessage).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      clientId, kind: 'IMAGE', body: '', attachment: { create: expect.objectContaining({ data: Uint8Array.from(bytes) }) },
    }) }));
    expect(mocks.publish).toHaveBeenCalledWith('conversation-1', message);
    expect(mocks.publish.mock.calls[0]).not.toContain(bytes);
    expect(mocks.notify).toHaveBeenCalledWith('conversation-1', 'user-1', 'Marco', null);
  });

  it('returns an identical retry without publishing twice and rejects clientId conflicts', async () => {
    mocks.createMessage.mockRejectedValue({ code: 'P2002' });
    mocks.findMessage.mockResolvedValue(message);
    const retry = await request('/conversations/conversation-1/attachments', {
      method: 'POST', headers: uploadHeaders(), body: bytes,
    });
    expect(retry.status).toBe(200);
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();

    mocks.findMessage.mockResolvedValue({ ...message, senderId: 'user-2' });
    const conflict = await request('/conversations/conversation-1/attachments', {
      method: 'POST', headers: uploadHeaders(), body: bytes,
    });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ error: 'CLIENT_ID_CONFLICT' });
  });

  it.each([
    { kind: 'DOCUMENT' },
    { attachment: { ...message.attachment, fileName: 'altra.png' } },
    { attachment: { ...message.attachment, mediaType: 'image/jpeg' } },
    { attachment: { ...message.attachment, byteSize: bytes.length + 1 } },
    { attachment: { ...message.attachment, sha256: '0'.repeat(64) } },
  ])('rejects an idempotency retry with mutated metadata: %j', async (mutation) => {
    mocks.createMessage.mockRejectedValue({ code: 'P2002' });
    mocks.findMessage.mockResolvedValue({ ...message, ...mutation });
    const response = await request('/conversations/conversation-1/attachments', {
      method: 'POST', headers: uploadHeaders(), body: bytes,
    });
    expect(response.status).toBe(409);
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it('enforces the 256 MiB quota again inside the serializable transaction', async () => {
    mocks.aggregateAttachments
      .mockResolvedValueOnce({ _sum: { byteSize: 0 } })
      .mockResolvedValueOnce({ _sum: { byteSize: 256 * 1024 * 1024 } });
    mocks.findMessage.mockResolvedValue(null);
    const response = await request('/conversations/conversation-1/attachments', {
      method: 'POST', headers: uploadHeaders(), body: bytes,
    });
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: 'STORAGE_QUOTA_EXCEEDED' });
    expect(mocks.createMessage).not.toHaveBeenCalled();
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it('allows an identical retry at the quota without inserting or emitting again', async () => {
    mocks.aggregateAttachments.mockResolvedValue({ _sum: { byteSize: 256 * 1024 * 1024 } });
    mocks.findMessage.mockResolvedValue(message);
    const response = await request('/conversations/conversation-1/attachments', {
      method: 'POST', headers: uploadHeaders(), body: bytes,
    });
    expect(response.status).toBe(200);
    expect(mocks.createMessage).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it('returns a controlled 413 for bodies over 8 MiB', async () => {
    const response = await request('/conversations/conversation-1/attachments', {
      method: 'POST', headers: uploadHeaders(), body: Buffer.alloc(8 * 1024 * 1024 + 1),
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'ATTACHMENT_TOO_LARGE' });
    expect(mocks.createMessage).not.toHaveBeenCalled();
  });

  it('returns 413 for a chunked upload over 8 MiB without inserting', async () => {
    const response = await chunkedUpload(
      '/conversations/conversation-1/attachments',
      uploadHeaders(),
      Buffer.alloc(8 * 1024 * 1024 + 1),
    );
    expect(response).toEqual({ status: 413, body: { error: 'ATTACHMENT_TOO_LARGE' } });
    expect(mocks.createMessage).not.toHaveBeenCalled();
  });

  it('accepts a valid image at exactly 8 MiB', async () => {
    const maximum = Buffer.alloc(8 * 1024 * 1024);
    maximum.set(bytes.subarray(0, 24));
    const response = await request('/conversations/conversation-1/attachments', {
      method: 'POST', headers: uploadHeaders({ 'x-content-sha256': createHash('sha256').update(maximum).digest('hex') }), body: maximum,
    });
    expect(response.status).toBe(201);
    expect(mocks.createMessage).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      attachment: { create: expect.objectContaining({ byteSize: maximum.length }) },
    }) }));
  });

  it('authorizes downloads and sets safe image response headers', async () => {
    mocks.findAttachment.mockResolvedValue({ ...message.attachment, data: bytes, message: { kind: 'IMAGE' } });
    const response = await request('/attachments/attachment-1');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('content-disposition')).toContain('inline');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('cache-control')).toContain('private');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    expect(mocks.findAttachment).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'attachment-1', message: { conversation: { members: { some: { userId: 'user-1' } } } } },
    }));
  });

  it('hides unauthorized downloads and forces documents to download', async () => {
    mocks.findAttachment.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'attachment-2', fileName: 'report"\r\n\u202e.pdf', mediaType: 'application/pdf', byteSize: 3,
      sha256: '0'.repeat(64), data: Buffer.from('pdf'), message: { kind: 'DOCUMENT' },
    });
    expect((await request('/attachments/attachment-2')).status).toBe(404);
    const response = await request('/attachments/attachment-2');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toContain('attachment');
    expect(response.headers.get('content-disposition')).toContain("filename*=UTF-8''report%22%0D%0A%E2%80%AE.pdf");
    expect(response.headers.get('content-disposition')).not.toContain('\r');
    expect(response.headers.get('content-disposition')).not.toContain('\n');
  });
});
