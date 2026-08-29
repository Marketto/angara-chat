import { describe, expect, it } from 'vitest';
import { claimOneReload } from './pwa-refresh';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

describe('PWA forced refresh guard', () => {
  it('allows only one fallback reload for the same server build', () => {
    const storage = memoryStorage();

    expect(claimOneReload(storage, 'deploy-2')).toBe(true);
    expect(claimOneReload(storage, 'deploy-2')).toBe(false);
  });

  it('allows a later release to claim its own fallback reload', () => {
    const storage = memoryStorage();

    expect(claimOneReload(storage, 'deploy-2')).toBe(true);
    expect(claimOneReload(storage, 'deploy-3')).toBe(true);
  });

  it('keeps the app usable when session storage is unavailable', () => {
    const blockedStorage = {
      getItem: () => { throw new Error('storage blocked'); },
      setItem: () => { throw new Error('storage blocked'); },
    };

    expect(claimOneReload(blockedStorage, 'deploy-2')).toBe(false);
  });
});
