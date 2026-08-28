import { describe, expect, it, vi } from 'vitest';
import { openNotificationTarget } from './notification-click';

function client(url = 'https://chat.example.com/inbox') {
  return {
    url,
    focus: vi.fn(async () => undefined),
    navigate: vi.fn(async () => undefined),
  };
}

describe('notification click navigation', () => {
  it('navigates and focuses an existing app window instead of opening a duplicate', async () => {
    const existing = client();
    const clients = {
      matchAll: vi.fn(async () => [existing]),
      openWindow: vi.fn(async () => undefined),
    };

    await openNotificationTarget(clients, '/?conversation=conversation-1', 'https://chat.example.com/');

    expect(existing.navigate).toHaveBeenCalledWith('https://chat.example.com/?conversation=conversation-1');
    expect(existing.focus).toHaveBeenCalledOnce();
    expect(clients.openWindow).not.toHaveBeenCalled();
  });

  it('opens exactly one window when the app has no existing client', async () => {
    const clients = {
      matchAll: vi.fn(async () => []),
      openWindow: vi.fn(async () => undefined),
    };

    await openNotificationTarget(clients, '/?conversation=conversation-1', 'https://chat.example.com/');

    expect(clients.openWindow).toHaveBeenCalledOnce();
    expect(clients.openWindow).toHaveBeenCalledWith('https://chat.example.com/?conversation=conversation-1');
  });

  it('refuses a cross-origin notification target', async () => {
    const clients = {
      matchAll: vi.fn(async () => []),
      openWindow: vi.fn(async () => undefined),
    };

    await openNotificationTarget(clients, 'https://attacker.example/', 'https://chat.example.com/');

    expect(clients.openWindow).toHaveBeenCalledWith('https://chat.example.com/');
  });
});
