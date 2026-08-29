interface RefreshStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const reloadBuildKey = 'angara:pwa-fallback-reload';

/** Persist the fallback claim across a reload so a stale PWA cannot loop forever. */
export function claimOneReload(storage: RefreshStorage, serverBuildVersion: string) {
  try {
    if (storage.getItem(reloadBuildKey) === serverBuildVersion) return false;
    storage.setItem(reloadBuildKey, serverBuildVersion);
    return true;
  } catch {
    return false;
  }
}
