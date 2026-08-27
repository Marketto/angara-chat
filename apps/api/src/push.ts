import webpush from 'web-push';
import { config } from './config.js';
import { db } from './db.js';

webpush.setVapidDetails(config.VAPID_SUBJECT, config.VAPID_PUBLIC_KEY, config.VAPID_PRIVATE_KEY);

export async function notifyConversation(conversationId: string, senderId: string, senderName: string, senderAvatarUrl: string | null) {
  const subscriptions = await db.pushSubscription.findMany({
    where: { userId: { not: senderId }, user: { memberships: { some: { conversationId } } } },
  });
  const payload = JSON.stringify({
    title: senderName,
    body: 'Nuovo messaggio',
    senderAvatarUrl: senderAvatarUrl ?? undefined,
    url: `/?conversation=${encodeURIComponent(conversationId)}`,
    tag: `conversation-${conversationId}`,
  });
  await Promise.allSettled(subscriptions.map(async (subscription) => {
    try {
      await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, payload, { TTL: 3600, urgency: 'high' });
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) await db.pushSubscription.delete({ where: { endpoint: subscription.endpoint } });
      else console.error('PUSH_DELIVERY_FAILED', { status: status ?? 'unknown' });
    }
  }));
}
