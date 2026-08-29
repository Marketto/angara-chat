import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { notificationPresentation, shouldSilencePushNotification, type PushNotificationData } from './notification';
import { openNotificationTarget } from './notification-click';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision?: string }> };
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting();
});
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()); });

self.addEventListener('push', (event) => {
  const { title, options } = notificationPresentation(event.data?.json() as PushNotificationData | undefined);
  event.waitUntil((async () => {
    const windowClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (shouldSilencePushNotification(windowClients)) options.silent = true;
    await self.registration.showNotification(title, options);
  })());
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(openNotificationTarget({
    matchAll: async (options) => (await self.clients.matchAll(options)) as WindowClient[],
    openWindow: (url) => self.clients.openWindow(url),
  }, (event.notification.data as { url?: string })?.url ?? '/', self.registration.scope));
});
