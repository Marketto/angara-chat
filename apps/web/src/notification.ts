export interface PushNotificationData {
  title?: string;
  body?: string;
  senderAvatarUrl?: string;
  url?: string;
  tag?: string;
}

export function shouldSilencePushNotification(clients: ReadonlyArray<{ focused: boolean }>) {
  return clients.some(({ focused }) => focused);
}

function senderIcon(value?: string) {
  if (!value) return '/notification-icon.png';
  try {
    const url = new URL(value);
    const trustedHost = url.hostname === 'googleusercontent.com' || url.hostname.endsWith('.googleusercontent.com');
    return url.protocol === 'https:' && trustedHost && !url.username && !url.password && !url.port
      ? url.href
      : '/notification-icon.png';
  } catch {
    return '/notification-icon.png';
  }
}

export function notificationPresentation(data?: PushNotificationData) {
  const options: NotificationOptions = {
    icon: senderIcon(data?.senderAvatarUrl),
    badge: '/notification-badge.png',
    data: { url: data?.url ?? '/' },
  };
  if (data?.body) options.body = data.body;
  if (data?.tag) options.tag = data.tag;
  return { title: data?.title ?? 'Nuovo messaggio', options };
}
