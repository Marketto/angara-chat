import { api } from './api';

function urlBase64ToBytes(value: string) {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const binary = atob((value + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export async function enablePush(vapidPublicKey: string) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('UNSUPPORTED');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('DENIED');
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToBytes(vapidPublicKey),
  });
  await api.subscribe(subscription.toJSON());
}

export async function hasPushSubscription() {
  if (Notification.permission !== 'granted' || !('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  const registration = await navigator.serviceWorker.ready;
  return Boolean(await registration.pushManager.getSubscription());
}

/** Restore the server-side registration if the browser retained its subscription. */
export async function syncPushSubscription() {
  if (Notification.permission !== 'granted' || !('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return false;
  await api.subscribe(subscription.toJSON());
  return true;
}

/** Replace an endpoint whose provider accepts pushes but no longer delivers payloads. */
let repairInFlight: Promise<void> | undefined;

async function performPushSubscriptionRepair(vapidPublicKey: string) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('UNSUPPORTED');
  if (Notification.permission !== 'granted' && await Notification.requestPermission() !== 'granted') throw new Error('DENIED');
  const registration = await navigator.serviceWorker.ready;
  const previous = await registration.pushManager.getSubscription();
  if (previous) {
    await api.unsubscribe(previous.endpoint);
    if (!await previous.unsubscribe()) throw new Error('UNSUBSCRIBE_FAILED');
  }
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToBytes(vapidPublicKey),
  });
  await api.subscribe(subscription.toJSON());
}

export function repairPushSubscription(vapidPublicKey: string) {
  if (repairInFlight) return repairInFlight;
  repairInFlight = performPushSubscriptionRepair(vapidPublicKey).finally(() => { repairInFlight = undefined; });
  return repairInFlight;
}

export async function currentPushEndpoint() {
  if (Notification.permission !== 'granted' || !('serviceWorker' in navigator) || !('PushManager' in window)) return undefined;
  const registration = await navigator.serviceWorker.ready;
  return (await registration.pushManager.getSubscription())?.endpoint;
}
