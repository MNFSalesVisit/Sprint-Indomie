// Minimal IndexedDB helper for offline shops cache and a request queue
const DB_NAME = 'sprint_offline_v1';
const DB_VERSION = 1;
const STORE_SHOPS = 'shops';
const STORE_QUEUE = 'queue';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (ev) => {
      const db = ev.target.result;
      if (!db.objectStoreNames.contains(STORE_SHOPS)) {
        db.createObjectStore(STORE_SHOPS, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_QUEUE)) {
        db.createObjectStore(STORE_QUEUE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(storeName, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result;
    try {
      result = fn(store);
    } catch (e) { reject(e); }
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
  });
}

export async function saveShops(subregionId, shops) {
  const key = `subregion:${String(subregionId)}`;
  await withStore(STORE_SHOPS, 'readwrite', store => store.put({ key, shops, updated_at: Date.now() }));
}

export async function getShops(subregionId) {
  try {
    const key = `subregion:${String(subregionId)}`;
    return await withStore(STORE_SHOPS, 'readonly', store => {
      return new Promise((resolve) => {
        const r = store.get(key);
        r.onsuccess = () => resolve(r.result ? r.result.shops : null);
        r.onerror = () => resolve(null);
      });
    });
  } catch { return null; }
}

export async function saveNearby(lat, lng, shops) {
  try {
    await withStore(STORE_SHOPS, 'readwrite', store => store.put({ key: `nearby:last`, shops, lat, lng, updated_at: Date.now() }));
  } catch {}
}

export async function getNearby() {
  try {
    return await withStore(STORE_SHOPS, 'readonly', store => {
      return new Promise((resolve) => {
        const r = store.get('nearby:last');
        r.onsuccess = () => resolve(r.result ? r.result.shops : null);
        r.onerror = () => resolve(null);
      });
    });
  } catch { return null; }
}

export async function enqueue(item) {
  if (!item || !item.id) item = { ...item, id: `${Date.now()}-${Math.random().toString(36).slice(2,9)}` };
  await withStore(STORE_QUEUE, 'readwrite', store => store.put(item));
}

export async function getQueue() {
  return await withStore(STORE_QUEUE, 'readonly', store => {
    return new Promise((resolve) => {
      const res = [];
      const req = store.openCursor();
      req.onsuccess = (ev) => {
        const cur = ev.target.result;
        if (!cur) return resolve(res);
        res.push(cur.value);
        cur.continue();
      };
      req.onerror = () => resolve([]);
    });
  });
}

export async function removeQueueItem(id) {
  return await withStore(STORE_QUEUE, 'readwrite', store => store.delete(id));
}

export async function clearQueue() {
  return await withStore(STORE_QUEUE, 'readwrite', store => store.clear());
}

export async function pendingCount() {
  try {
    const q = await getQueue();
    return Array.isArray(q) ? q.length : 0;
  } catch { return 0; }
}

export default {
  openDb, saveShops, getShops, saveNearby, getNearby, enqueue, getQueue, removeQueueItem, clearQueue, pendingCount,
};
