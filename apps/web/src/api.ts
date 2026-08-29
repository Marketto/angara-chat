import type { Conversation, Message, PublicConfig, User } from './types';

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly retryAfterMs?: number) {
    super(status === 401 ? 'UNAUTHENTICATED' : `HTTP_${status}`);
  }
}

function retryAfterMs(response: Response): number | undefined {
  const seconds = Number(response.headers.get('retry-after'));
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds * 1_000) : undefined;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
    credentials: 'same-origin',
  });
  if (!response.ok) throw new ApiError(response.status, retryAfterMs(response));
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

export const api = {
  config: () => request<PublicConfig>('/config'),
  me: () => request<User>('/me'),
  login: (credential: string) => request<User>('/auth/google', { method: 'POST', body: JSON.stringify({ credential }) }),
  localTestLogin: (email: string, token: string) => request<User>('/auth/local-test', { method: 'POST', headers: { 'x-test-auth-token': token }, body: JSON.stringify({ email }) }),
  logout: (pushEndpoint?: string) => request<void>('/auth/logout', { method: 'POST', body: JSON.stringify({ pushEndpoint }) }),
  conversations: () => request<Conversation[]>('/conversations'),
  messages: (id: string) => request<Message[]>(`/conversations/${encodeURIComponent(id)}/messages`),
  discover: (emails: string[]) => request<User[]>('/contacts/discover', { method: 'POST', body: JSON.stringify({ emails }) }),
  createConversation: (participantId: string) => request<{ id: string }>('/conversations', { method: 'POST', body: JSON.stringify({ participantId }) }),
  async uploadAttachment(conversationId: string, upload: {
    clientId: string;
    kind: 'IMAGE' | 'DOCUMENT';
    blob: Blob;
    fileName: string;
    sha256: string;
  }): Promise<Message> {
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), 30_000);
    let response: Response;
    try {
      response = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}/attachments`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'content-type': upload.blob.type,
          'x-client-id': upload.clientId,
          'x-attachment-kind': upload.kind,
          'x-file-name': encodeURIComponent(upload.fileName),
          'x-content-sha256': upload.sha256,
        },
        body: upload.blob,
        signal: controller.signal,
      });
    } finally {
      globalThis.clearTimeout(timeout);
    }
    if (!response.ok) throw new ApiError(response.status, retryAfterMs(response));
    return response.json() as Promise<Message>;
  },
  attachmentUrl: (attachmentId: string) => `/api/attachments/${encodeURIComponent(attachmentId)}`,
  async downloadAttachment(attachmentId: string): Promise<Blob> {
    const response = await fetch(`/api/attachments/${encodeURIComponent(attachmentId)}`, { credentials: 'same-origin' });
    if (!response.ok) throw new ApiError(response.status, retryAfterMs(response));
    return response.blob();
  },
  subscribe: (subscription: PushSubscriptionJSON) => request<void>('/push/subscriptions', { method: 'POST', body: JSON.stringify(subscription) }),
  clientLog: (code: string, context?: string) => request<void>('/client-logs', { method: 'POST', body: JSON.stringify({ code, context }) }),
};
