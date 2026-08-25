import { registerSW } from 'virtual:pwa-register';

const clientBuildVersion = import.meta.env.VITE_BUILD_VERSION || 'dev';
let registration: ServiceWorkerRegistration | undefined;
let updateServiceWorker: ((reloadPage?: boolean) => Promise<void>) | undefined;

updateServiceWorker = registerSW({
  immediate: true,
  onRegisteredSW(_url, registered) {
    registration = registered;
    window.setInterval(() => void registration?.update(), 60_000);
  },
  onNeedRefresh() { void updateServiceWorker?.(true); },
});

export function updateWhenBackendChanges(serverBuildVersion: string) {
  if (serverBuildVersion !== clientBuildVersion) void registration?.update();
}
