export interface QueuedMessage {
  clientId: string;
  conversationId: string;
  userId: string;
  body: string;
  createdAt: string;
}

const databaseName = 'angara-outbox';
const storeName = 'messages';

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName, { keyPath: 'clientId' });
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

export const outbox = {
  put: (message: QueuedMessage) => transaction('readwrite', (store) => store.put(message)),
  remove: (clientId: string) => transaction('readwrite', (store) => store.delete(clientId)),
  async forUser(userId: string): Promise<QueuedMessage[]> {
    const messages = await transaction<QueuedMessage[]>('readonly', (store) => store.getAll());
    return messages.filter((message) => message.userId === userId).sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  },
  async clearUser(userId: string) {
    const messages = await this.forUser(userId);
    await Promise.all(messages.map(({ clientId }) => this.remove(clientId)));
  },
};
