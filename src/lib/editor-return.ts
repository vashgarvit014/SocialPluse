// IndexedDB retains full media payloads without localStorage's small quota.
// A snapshot contains editor data only, never account tokens or credentials.
export async function returnStore(action: 'put' | 'get' | 'delete', id: string, value?: unknown): Promise<unknown> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('socialpulse-editor', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('returns');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('returns', action === 'get' ? 'readonly' : 'readwrite');
      const store = tx.objectStore('returns');
      const request = action === 'put' ? store.put(value, id) : action === 'delete' ? store.delete(id) : store.get(id);
      tx.oncomplete = () => resolve(request.result); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
