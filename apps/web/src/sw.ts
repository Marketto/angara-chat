import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision?: string }> };
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

self.addEventListener('push', (event) => {
  const data = event.data?.json() as { title?: string; body?: string; url?: string; tag?: string } | undefined;
  const options: NotificationOptions = {
    icon: '/icon.svg', badge: '/icon-maskable.svg', data: { url: data?.url ?? '/' },
  };
  if (data?.body) options.body = data.body;
  if (data?.tag) options.tag = data.tag;
  event.waitUntil(self.registration.showNotification(data?.title ?? 'Nuovo messaggio', options));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow((event.notification.data as { url?: string })?.url ?? '/'));
});
