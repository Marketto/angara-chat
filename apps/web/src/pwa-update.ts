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
  if (serverBuildVersion === clientBuildVersion) return;

  let attempts = 0;
  const forceRefresh = async () => {
    attempts += 1;
    try {
      await registration?.update();
    } catch {
      // A temporary network failure must not prevent the forced-refresh fallback.
    }
    if (registration?.waiting) {
      try {
        await updateServiceWorker?.(true);
        return;
      } catch {
        // Retry below, then fall back to a browser reload.
      }
    }
    if (attempts < 6) {
      window.setTimeout(() => void forceRefresh(), 500);
      return;
    }
    window.location.reload();
  };
  void forceRefresh();
}
