import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';
import { syncPushSubscription } from './push';

vi.mock('./api', () => ({ api: { subscribe: vi.fn(), unsubscribe: vi.fn() } }));

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

  it('replaces a stale subscription on explicit repair', async () => {
    const previous = { endpoint: 'https://fcm.googleapis.com/fcm/send/old', unsubscribe: vi.fn().mockResolvedValue(true) };
    const serialized = { endpoint: 'https://fcm.googleapis.com/fcm/send/new', keys: { p256dh: 'new-key', auth: 'new-auth' } };
    const replacement = { toJSON: () => serialized };
    const subscribe = vi.fn().mockResolvedValue(replacement);
    vi.stubGlobal('Notification', { permission: 'granted', requestPermission: vi.fn().mockResolvedValue('granted') });
    vi.stubGlobal('navigator', {
      serviceWorker: {
        ready: Promise.resolve({ pushManager: { getSubscription: vi.fn().mockResolvedValue(previous), subscribe } }),
      },
    });
    const { repairPushSubscription } = await import('./push');

    await repairPushSubscription('AQAB');

    expect(previous.unsubscribe).toHaveBeenCalledOnce();
    expect(api.unsubscribe).toHaveBeenCalledWith(previous.endpoint);
    expect(subscribe).toHaveBeenCalledOnce();
    expect(api.subscribe).toHaveBeenCalledWith(serialized);
  });

  it('coalesces concurrent repair requests for the same browser device', async () => {
    const previous = { endpoint: 'https://fcm.googleapis.com/fcm/send/old', unsubscribe: vi.fn().mockResolvedValue(true) };
    const replacement = { toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/new', keys: { p256dh: 'key', auth: 'auth' } }) };
    const subscribe = vi.fn().mockResolvedValue(replacement);
    vi.stubGlobal('navigator', {
      serviceWorker: {
        ready: Promise.resolve({ pushManager: { getSubscription: vi.fn().mockResolvedValue(previous), subscribe } }),
      },
    });
    const { repairPushSubscription } = await import('./push');

    await Promise.all([
      repairPushSubscription('AQAB'),
      repairPushSubscription('AQAB'),
      repairPushSubscription('AQAB'),
    ]);

    expect(api.unsubscribe).toHaveBeenCalledOnce();
    expect(previous.unsubscribe).toHaveBeenCalledOnce();
    expect(subscribe).toHaveBeenCalledOnce();
    expect(api.subscribe).toHaveBeenCalledOnce();
  });
});
