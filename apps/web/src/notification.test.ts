import { describe, expect, it } from 'vitest';
import { notificationPresentation } from './notification';

describe('push notification presentation', () => {
  it('uses the sender avatar as the message icon and Angara as the monochrome badge', () => {
    expect(notificationPresentation({
      title: 'Marco',
      body: 'Nuovo messaggio',
      senderAvatarUrl: 'https://lh3.googleusercontent.com/a/marco',
      url: '/?conversation=conversation-1',
      tag: 'conversation-conversation-1',
    })).toEqual({
      title: 'Marco',
      options: {
        body: 'Nuovo messaggio',
        icon: 'https://lh3.googleusercontent.com/a/marco',
        badge: '/notification-badge.png',
        data: { url: '/?conversation=conversation-1' },
        tag: 'conversation-conversation-1',
      },
    });
  });

  it('falls back to the Angara icon when the sender has no avatar', () => {
    expect(notificationPresentation()).toMatchObject({
      title: 'Nuovo messaggio',
      options: { icon: '/notification-icon.png', badge: '/notification-badge.png' },
    });
  });

  it('rejects non-HTTPS avatar URLs', () => {
    expect(notificationPresentation({ senderAvatarUrl: 'data:image/png;base64,unsafe' })).toMatchObject({
      options: { icon: '/notification-icon.png' },
    });
  });

  it('rejects HTTPS avatar URLs outside the Google image host', () => {
    expect(notificationPresentation({ senderAvatarUrl: 'https://example.com/avatar.png' })).toMatchObject({
      options: { icon: '/notification-icon.png' },
    });
  });
});
