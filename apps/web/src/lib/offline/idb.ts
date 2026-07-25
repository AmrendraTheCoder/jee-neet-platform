/**
 * A minimal promise wrapper over IndexedDB.
 *
 * IndexedDB rather than localStorage because FR-SYN-01 requires a *durable*
 * write before the optimistic UI update. localStorage is synchronous and
 * cannot tell the caller whether the write reached disk, so "durable before
 * optimistic" is unprovable with it; it is also capped at a few megabytes and
 * is cleared by the same storage-pressure paths that clear caches.
 *
 * No dependency: the surface used here is two object stores and a cursor.
 */

export interface IdbSchema {
  readonly name: string;
  readonly version: number;
  readonly stores: readonly {
    readonly name: string;
    readonly keyPath: string;
    readonly autoIncrement?: boolean;
  }[];
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

export function openDatabase(schema: IdbSchema): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(schema.name, schema.version);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const store of schema.stores) {
        if (db.objectStoreNames.contains(store.name)) continue;
        db.createObjectStore(store.name, {
          keyPath: store.keyPath,
          autoIncrement: store.autoIncrement ?? false,
        });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
    request.onblocked = () =>
      reject(new Error('IndexedDB upgrade blocked by another open tab'));
  });
}

/**
 * Runs `work` in a transaction and resolves only when the transaction
 * *completes*, not when the request succeeds.
 *
 * That distinction is the whole point of this file. A request's success
 * callback fires before the transaction commits; resolving there and then
 * updating the UI would claim durability the browser has not yet provided, and
 * a tab closed in that window loses the answer silently.
 */
export async function withTransaction<T>(
  db: IDBDatabase,
  storeNames: readonly string[],
  mode: IDBTransactionMode,
  work: (transaction: IDBTransaction) => Promise<T> | T,
): Promise<T> {
  const transaction = db.transaction([...storeNames], mode);
  const completion = new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('transaction failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('transaction aborted'));
  });

  const result = await work(transaction);
  await completion;
  return result;
}

export function put<T>(transaction: IDBTransaction, storeName: string, value: T): Promise<IDBValidKey> {
  return promisify(transaction.objectStore(storeName).put(value as unknown as object));
}

export function getAllFrom<T>(transaction: IDBTransaction, storeName: string): Promise<T[]> {
  return promisify(transaction.objectStore(storeName).getAll() as IDBRequest<T[]>);
}

export function getOne<T>(
  transaction: IDBTransaction,
  storeName: string,
  key: IDBValidKey,
): Promise<T | undefined> {
  return promisify(transaction.objectStore(storeName).get(key) as IDBRequest<T | undefined>);
}

export function deleteKey(
  transaction: IDBTransaction,
  storeName: string,
  key: IDBValidKey,
): Promise<undefined> {
  return promisify(transaction.objectStore(storeName).delete(key));
}
