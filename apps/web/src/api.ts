import type { Conversation, Message, PublicConfig, PublicDevice, User } from './types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
    credentials: 'same-origin',
  });
  if (!response.ok) throw new Error(response.status === 401 ? 'UNAUTHENTICATED' : `HTTP_${response.status}`);
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

export const api = {
  config: () => request<PublicConfig>('/config'),
  me: () => request<User>('/me'),
  device: () => request<PublicDevice | null>('/crypto/device'),
  registerDevice: (device: { id: string; publicKey: JsonWebKey }) => request<PublicDevice>('/crypto/device', { method: 'POST', body: JSON.stringify(device) }),
  login: (credential: string) => request<User>('/auth/google', { method: 'POST', body: JSON.stringify({ credential }) }),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  conversations: () => request<Conversation[]>('/conversations'),
  messages: (id: string) => request<Message[]>(`/conversations/${encodeURIComponent(id)}/messages`),
  discover: (emails: string[]) => request<User[]>('/contacts/discover', { method: 'POST', body: JSON.stringify({ emails }) }),
  createConversation: (participantId: string) => request<{ id: string }>('/conversations', { method: 'POST', body: JSON.stringify({ participantId }) }),
  subscribe: (subscription: PushSubscriptionJSON) => request<void>('/push/subscriptions', { method: 'POST', body: JSON.stringify(subscription) }),
};
