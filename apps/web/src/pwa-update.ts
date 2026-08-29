import { registerSW } from 'virtual:pwa-register';
import { claimOneReload } from './pwa-refresh';

const clientBuildVersion = import.meta.env.VITE_BUILD_VERSION || 'dev';
let registration: ServiceWorkerRegistration | undefined;
const updateServiceWorker = registerSW({
  immediate: true,
  onRegisteredSW(_url, registered) {
    registration = registered;
    window.setInterval(() => void registration?.update(), 60_000);
  },
  onNeedRefresh() { void updateServiceWorker?.(true); },
});

export function updateWhenBackendChanges(serverBuildVersion: string) {
  if (serverBuildVersion === clientBuildVersion) return;

  let registrationWaitAttempts = 0;
  let updateAttempts = 0;
  const forceRefresh = async () => {
    if (!registration) {
      registrationWaitAttempts += 1;
      if (registrationWaitAttempts < 20) window.setTimeout(() => void forceRefresh(), 500);
      return;
    }
    updateAttempts += 1;
    try {
      await registration.update();
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
    if (updateAttempts < 6) {
      window.setTimeout(() => void forceRefresh(), 500);
      return;
    }
    if (claimOneReload(window.sessionStorage, serverBuildVersion)) window.location.reload();
  };
  void forceRefresh();
}
