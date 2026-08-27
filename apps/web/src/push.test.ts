import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';
import { syncPushSubscription } from './push';

vi.mock('./api', () => ({ api: { subscribe: vi.fn() } }));

describe('push subscription synchronization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('Notification', { permission: 'granted' });
    vi.stubGlobal('window', { PushManager: class PushManager {} });
  });

  it('re-registers an existing browser subscription with the API', async () => {
    const serialized = { endpoint: 'https://push.example/subscription', keys: { p256dh: 'key', auth: 'auth' } };
    const subscription = { toJSON: () => serialized };
    vi.stubGlobal('navigator', {
      serviceWorker: {
        ready: Promise.resolve({ pushManager: { getSubscription: vi.fn().mockResolvedValue(subscription) } }),
      },
    });

    await expect(syncPushSubscription()).resolves.toBe(true);
    expect(api.subscribe).toHaveBeenCalledWith(serialized);
  });
});
