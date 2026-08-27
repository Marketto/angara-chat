import type { Conversation, Message, PublicConfig, User } from './types';

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
  login: (credential: string) => request<User>('/auth/google', { method: 'POST', body: JSON.stringify({ credential }) }),
  localTestLogin: (email: string, token: string) => request<User>('/auth/local-test', { method: 'POST', headers: { 'x-test-auth-token': token }, body: JSON.stringify({ email }) }),
  logout: (pushEndpoint?: string) => request<void>('/auth/logout', { method: 'POST', body: JSON.stringify({ pushEndpoint }) }),
  conversations: () => request<Conversation[]>('/conversations'),
  messages: (id: string) => request<Message[]>(`/conversations/${encodeURIComponent(id)}/messages`),
  discover: (emails: string[]) => request<User[]>('/contacts/discover', { method: 'POST', body: JSON.stringify({ emails }) }),
  createConversation: (participantId: string) => request<{ id: string }>('/conversations', { method: 'POST', body: JSON.stringify({ participantId }) }),
  subscribe: (subscription: PushSubscriptionJSON) => request<void>('/push/subscriptions', { method: 'POST', body: JSON.stringify(subscription) }),
  unsubscribe: (endpoint: string) => request<void>('/push/subscriptions', { method: 'DELETE', body: JSON.stringify({ endpoint }) }),
  clientLog: (code: string, context?: string) => request<void>('/client-logs', { method: 'POST', body: JSON.stringify({ code, context }) }),
};
