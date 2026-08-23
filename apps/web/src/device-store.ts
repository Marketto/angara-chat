import { generateDeviceKeys } from './crypto';
import type { LocalDevice } from './types';

const DATABASE = 'angara-crypto-v1';
export async function loadLocalDevice(userId: string): Promise<LocalDevice | null> {
  return transaction<LocalDevice | null>('device', 'readonly', (store) => store.get(userId), null);
}

export async function createLocalDevice(userId: string): Promise<LocalDevice> {
  const keys = await generateDeviceKeys();
  const device = { id: crypto.randomUUID(), ...keys };
  await transaction('device', 'readwrite', (store) => store.put(device, userId));
  return device;
}

export async function pinPeerKey(ownerUserId: string, peerUserId: string, fingerprint: string): Promise<'new' | 'trusted' | 'changed'> {
  const storageKey = `${ownerUserId}:${peerUserId}`;
  const current = await transaction<string | null>('peers', 'readonly', (store) => store.get(storageKey), null);
  if (!current) {
    await transaction('peers', 'readwrite', (store) => store.put(fingerprint, storageKey));
    return 'new';
  }
  return current === fingerprint ? 'trusted' : 'changed';
}

function transaction<T = void>(storeName: 'device' | 'peers', mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest, fallback?: T): Promise<T> {
  return openDatabase().then((database) => new Promise<T>((resolve, reject) => {
    const tx = database.transaction(storeName, mode);
    const request = action(tx.objectStore(storeName));
    let result = fallback as T;
    request.onsuccess = () => { result = (request.result ?? fallback) as T; };
    request.onerror = () => reject(request.error);
    tx.onerror = () => reject(tx.error);
    tx.oncomplete = () => { database.close(); resolve(result); };
  }));
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('device');
      request.result.createObjectStore('peers');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
