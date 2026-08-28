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

  it('reports notifications as disabled when the browser has no subscription', async () => {
    vi.stubGlobal('navigator', {
      serviceWorker: {
        ready: Promise.resolve({ pushManager: { getSubscription: vi.fn().mockResolvedValue(null) } }),
      },
    });

    await expect(syncPushSubscription()).resolves.toBe(false);
    expect(api.subscribe).not.toHaveBeenCalled();
  });

  it('reports notifications as disabled when browser permission is denied', async () => {
    vi.stubGlobal('Notification', { permission: 'denied' });

    await expect(syncPushSubscription()).resolves.toBe(false);
    expect(api.subscribe).not.toHaveBeenCalled();
  });

  it('enables notifications and registers the new subscription with the API', async () => {
    const serialized = { endpoint: 'https://push.example/new', keys: { p256dh: 'key', auth: 'auth' } };
    const replacement = { toJSON: () => serialized };
    const subscribe = vi.fn().mockResolvedValue(replacement);
    vi.stubGlobal('Notification', { permission: 'default', requestPermission: vi.fn().mockResolvedValue('granted') });
    vi.stubGlobal('navigator', {
      serviceWorker: {
        ready: Promise.resolve({ pushManager: { subscribe } }),
      },
    });
    const { enablePush } = await import('./push');

    await enablePush('AQAB');

    expect(subscribe).toHaveBeenCalledOnce();
    expect(api.subscribe).toHaveBeenCalledWith(serialized);
  });
});
