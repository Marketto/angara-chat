interface CachedImage {
  key: string;
  userId: string;
  attachmentId: string;
  blob: Blob;
}

const databaseName = 'angara-local-images';
const storeName = 'images';

export function attachmentCacheKey(userId: string, attachmentId: string) {
  return `${userId}:${attachmentId}`;
}

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName, { keyPath: 'key' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  return new Promise<T>((resolve, reject) => {
    const request = action(db.transaction(storeName, mode).objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).finally(() => db.close());
}

export const localImageCache = {
  async get(userId: string, attachmentId: string): Promise<Blob | null> {
    const cached = await transaction<CachedImage | undefined>('readonly', (store) => store.get(attachmentCacheKey(userId, attachmentId)));
    return cached?.blob ?? null;
  },
  put(userId: string, attachmentId: string, blob: Blob) {
    return transaction('readwrite', (store) => store.put({
      key: attachmentCacheKey(userId, attachmentId), userId, attachmentId, blob,
    } satisfies CachedImage));
  },
  async clearUser(userId: string) {
    const entries = await transaction<CachedImage[]>('readonly', (store) => store.getAll());
    await Promise.all(entries.filter((entry) => entry.userId === userId)
      .map((entry) => transaction('readwrite', (store) => store.delete(entry.key))));
  },
};
