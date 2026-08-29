import { describe, expect, it, vi } from 'vitest';
import {
  MAX_ATTACHMENT_BYTES,
  attachmentUploadFailure,
  attachmentError,
  deliverQueuedMessage,
  openStreetMapUrl,
  sha256Hex,
  validateAttachment,
} from './sharing';
import { deliverQueuedMessages } from './outbox-delivery';
import type { QueuedMessage } from './outbox';

const baseMessage: QueuedMessage = {
  clientId: '00000000-0000-4000-8000-000000000001',
  conversationId: 'conversation-1',
  userId: 'user-1',
  kind: 'TEXT',
  body: 'ciao',
  createdAt: '2026-08-29T12:00:00.000Z',
};

describe('attachment validation', () => {
  it('allows only the supported photo formats and enforces the 8 MiB limit', () => {
    expect(attachmentError(new File(['image'], 'taiga.webp', { type: 'image/webp' }), 'IMAGE')).toBeNull();
    expect(attachmentError(new File(['image'], 'taiga.svg', { type: 'image/svg+xml' }), 'IMAGE')).toBe('UNSUPPORTED_TYPE');
    expect(attachmentError(new File([new Uint8Array(MAX_ATTACHMENT_BYTES + 1)], 'large.png', { type: 'image/png' }), 'IMAGE')).toBe('TOO_LARGE');
  });

  it('uses the document MIME allowlist shared with the API', () => {
    expect(attachmentError(new File(['pdf'], 'guide.pdf', { type: 'application/pdf' }), 'DOCUMENT')).toBeNull();
    expect(attachmentError(new File(['bin'], 'archive.zip', { type: 'application/zip' }), 'DOCUMENT')).toBe('UNSUPPORTED_TYPE');
  });

  it('rejects text/plain that is not valid UTF-8 or contains NUL bytes', async () => {
    await expect(validateAttachment(new File(['testo'], 'note.txt', { type: 'text/plain' }), 'DOCUMENT')).resolves.toBeNull();
    await expect(validateAttachment(new File([new Uint8Array([0xff])], 'binary.txt', { type: 'text/plain' }), 'DOCUMENT')).resolves.toBe('UNSUPPORTED_TYPE');
    await expect(validateAttachment(new File(['a\0b'], 'nul.txt', { type: 'text/plain' }), 'DOCUMENT')).resolves.toBe('UNSUPPORTED_TYPE');
  });

  it('computes lowercase SHA-256 for the raw upload body', async () => {
    await expect(sha256Hex(new Blob(['abc']))).resolves.toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('offline outbox sharing delivery', () => {
  it('honors the attachment upload rate-limit window', () => {
    expect(attachmentUploadFailure(429, 42_000)).toEqual({ ok: false, error: 'RATE_LIMITED', retryAfterMs: 42_000 });
    expect(attachmentUploadFailure(503)).toBeNull();
  });

  it('quarantines an upload when its conversation no longer exists', () => {
    expect(attachmentUploadFailure(404)).toEqual({ ok: false, error: 'FORBIDDEN' });
  });

  it('uploads an attachment once and does not also send it over the socket', async () => {
    const attachmentMessage: QueuedMessage = {
      ...baseMessage,
      kind: 'IMAGE',
      body: '',
      attachmentUpload: {
        blob: new Blob(['image'], { type: 'image/png' }),
        fileName: 'photo.png',
        mediaType: 'image/png',
        byteSize: 5,
        sha256: 'abc123',
      },
    };
    const upload = vi.fn(async () => ({ ok: true as const, message: { id: 'server-1' } as never }));
    const sendSocket = vi.fn();

    await expect(deliverQueuedMessage(attachmentMessage, { upload, sendSocket })).resolves.toMatchObject({ ok: true });
    expect(upload).toHaveBeenCalledWith(attachmentMessage);
    expect(sendSocket).not.toHaveBeenCalled();
  });

  it('removes the queued Blob only after the upload acknowledgement', async () => {
    const attachmentMessage: QueuedMessage = {
      ...baseMessage,
      kind: 'DOCUMENT',
      attachmentUpload: {
        blob: new Blob(['document'], { type: 'application/pdf' }),
        fileName: 'guide.pdf',
        mediaType: 'application/pdf',
        byteSize: 8,
        sha256: 'abc123',
      },
    };
    const remove = vi.fn(async () => undefined);
    const persisted = { id: 'server-1', clientId: attachmentMessage.clientId, senderId: 'user-1', body: '', createdAt: attachmentMessage.createdAt };

    await deliverQueuedMessages({
      messages: [attachmentMessage],
      send: (message) => deliverQueuedMessage(message, {
        upload: vi.fn(async () => ({ ok: true as const, message: persisted })),
        sendSocket: vi.fn(),
      }),
      remove,
      markFailed: vi.fn(),
      onState: vi.fn(),
      onDelivered: vi.fn(),
    });

    expect(remove).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith(attachmentMessage.clientId);
  });

  it('keeps text and location messages on the idempotent socket path', async () => {
    const location = { ...baseMessage, kind: 'LOCATION' as const, body: '', locationLatitude: 55.0084, locationLongitude: 73.3558 };
    const upload = vi.fn();
    const sendSocket = vi.fn(async () => null);

    await deliverQueuedMessage(location, { upload, sendSocket });
    expect(sendSocket).toHaveBeenCalledWith(location);
    expect(upload).not.toHaveBeenCalled();
  });
});

describe('OpenStreetMap location privacy', () => {
  it('builds a direct map link without loading tiles', () => {
    expect(openStreetMapUrl(55.0084, 73.3558)).toBe('https://www.openstreetmap.org/?mlat=55.008400&mlon=73.355800#map=16/55.008400/73.355800');
  });
});
