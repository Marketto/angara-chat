import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('attachment API', () => {
  it('uploads the Blob raw with idempotency and metadata headers', async () => {
    const blob = new Blob(['photo'], { type: 'image/webp' });
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ id: 'message-1' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await api.uploadAttachment('conversation/1', {
      clientId: '00000000-0000-4000-8000-000000000001',
      kind: 'IMAGE',
      blob,
      fileName: 'lago №1.webp',
      sha256: 'abcdef',
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/conversations/conversation%2F1/attachments');
    expect(init).toMatchObject({ method: 'POST', body: blob, credentials: 'same-origin' });
    expect(init).toBeDefined();
    if (!init) throw new Error('missing fetch init');
    const headers = new Headers(init.headers);
    expect(headers.get('content-type')).toBe('image/webp');
    expect(headers.get('x-client-id')).toBe('00000000-0000-4000-8000-000000000001');
    expect(headers.get('x-attachment-kind')).toBe('IMAGE');
    expect(headers.get('x-file-name')).toBe(encodeURIComponent('lago №1.webp'));
    expect(headers.get('x-content-sha256')).toBe('abcdef');
  });

  it('exposes Retry-After so the persistent queue does not hammer the API', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 429, headers: { 'retry-after': '12' } })));

    await expect(api.uploadAttachment('conversation-1', {
      clientId: '00000000-0000-4000-8000-000000000001',
      kind: 'DOCUMENT',
      blob: new Blob(['document'], { type: 'application/pdf' }),
      fileName: 'document.pdf',
      sha256: 'abcdef',
    })).rejects.toMatchObject({ status: 429, retryAfterMs: 12_000 });
  });

  it('downloads an image as a Blob for the account-local cache', async () => {
    const blob = new Blob(['photo'], { type: 'image/webp' });
    const fetchMock = vi.fn(async () => new Response(blob, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const downloaded = await api.downloadAttachment('image/1');
    expect(downloaded.type).toBe('image/webp');
    await expect(downloaded.text()).resolves.toBe('photo');
    expect(fetchMock).toHaveBeenCalledWith('/api/attachments/image%2F1', { credentials: 'same-origin' });
  });
});
