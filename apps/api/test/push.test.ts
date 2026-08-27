import { beforeEach, describe, expect, it, vi } from 'vitest';

const findMany = vi.fn();
const sendNotification = vi.fn();

vi.mock('../src/config.js', () => ({
  config: {
    VAPID_SUBJECT: 'mailto:test@example.com',
    VAPID_PUBLIC_KEY: 'public-key',
    VAPID_PRIVATE_KEY: 'private-key',
  },
}));
vi.mock('../src/db.js', () => ({
  db: {
    pushSubscription: { findMany, delete: vi.fn() },
  },
}));
vi.mock('web-push', () => ({
  default: { setVapidDetails: vi.fn(), sendNotification },
}));

describe('conversation push recipients', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findMany.mockResolvedValue([{ endpoint: 'https://fcm.googleapis.com/fcm/send/1', p256dh: 'key', auth: 'auth' }]);
    sendNotification.mockResolvedValue({ statusCode: 201 });
  });

  it('notifies every subscribed conversation member except the sender', async () => {
    const { notifyConversation } = await import('../src/push.js');

    await notifyConversation('conversation-1', 'sender-1', 'Marco');

    expect(findMany).toHaveBeenCalledWith({
      where: {
        userId: { not: 'sender-1' },
        user: { memberships: { some: { conversationId: 'conversation-1' } } },
      },
    });
    expect(sendNotification).toHaveBeenCalledWith(
      { endpoint: 'https://fcm.googleapis.com/fcm/send/1', keys: { p256dh: 'key', auth: 'auth' } },
      expect.any(String),
      { TTL: 3600, urgency: 'high' },
    );
  });
});
