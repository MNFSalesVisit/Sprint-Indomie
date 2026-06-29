/**
 * lib/serverCache.js
 *
 * Lightweight in-process TTL cache for Next.js API routes.
 * Lives at module scope — persists across requests for the lifetime of the
 * server process. Uses plain Map; no external dependency required.
 *
 * Usage:
 *   import { getCache, setCache, deleteCache } from '../../lib/serverCache';
 *
 *   const cached = getCache('my-key');
 *   if (cached) return res.status(200).json(cached);
 *   // ... fetch from DB ...
 *   setCache('my-key', data, 5 * 60 * 1000); // 5-min TTL
 */

const _store = new Map(); // key → { value, expiresAt }

/**
 * Returns the cached value for `key`, or null if missing / expired.
 */
export function getCache(key) {
  const entry = _store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    _store.delete(key);
    return null;
  }
  return entry.value;
}

/**
 * Stores `value` under `key` with the given TTL (milliseconds).
 */
export function setCache(key, value, ttlMs) {
  _store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

/**
 * Removes a single cache entry.
 */
export function deleteCache(key) {
  _store.delete(key);
}

/**
 * Removes all entries whose key starts with `prefix`.
 * Useful for invalidating a family of related keys (e.g. 'shops:subregion:').
 */
export function deleteCacheByPrefix(prefix) {
  for (const key of _store.keys()) {
    if (key.startsWith(prefix)) _store.delete(key);
  }
}
