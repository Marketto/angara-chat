import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';

const sw = self as unknown as ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision?: string }> };
precacheAndRoute(sw.__WB_MANIFEST);
cleanupOutdatedCaches();

sw.addEventListener('push', (event) => {
  const data = event.data?.json() as { title?: string; body?: string; url?: string; tag?: string } | undefined;
  const options: NotificationOptions = {
    icon: '/icon.svg', badge: '/icon.svg', data: { url: data?.url ?? '/' },
  };
  if (data?.body) options.body = data.body;
  if (data?.tag) options.tag = data.tag;
  event.waitUntil(sw.registration.showNotification(data?.title ?? 'Nuovo messaggio', options));
});
sw.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(sw.clients.openWindow((event.notification.data as { url?: string })?.url ?? '/'));
});
