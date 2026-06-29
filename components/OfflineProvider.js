import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import offline from '../lib/offline';
import { supabase } from '../lib/supabaseClient';

const OfflineContext = createContext(null);

export function useOffline() { return useContext(OfflineContext); }

export default function OfflineProvider({ children }) {
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); };
  }, []);

  const refreshPending = useCallback(async () => { setPending(await offline.pendingCount()); }, []);

  useEffect(() => { refreshPending(); }, [refreshPending]);

  const enqueue = useCallback(async (item) => {
    await offline.enqueue(item);
    await refreshPending();
  }, [refreshPending]);

  const syncQueue = useCallback(async () => {
    if (!isOnline || syncing) return;
    setSyncing(true);
    try {
      const queue = await offline.getQueue();
      for (const q of queue) {
        try {
          // attach auth header
          const { data: { session } } = await supabase.auth.getSession();
          const tok = session?.access_token;
          if (!tok) continue;
          // If queue item contains shop_create then create shop first
          if (q.payload && q.payload.new_shop) {
            const shopRes = await fetch('/api/sales/shops', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body: JSON.stringify(q.payload.new_shop) });
            if (!shopRes.ok) continue; // leave for retry
            const shopData = await shopRes.json();
            q.payload.shop_id = shopData.id;
            delete q.payload.new_shop;
          }
          // send main payload to intended endpoint
          const res = await fetch(q.endpoint, { method: q.method || 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body: JSON.stringify(q.payload) });
          if (res.ok) {
            await offline.removeQueueItem(q.id);
          } else {
            // leave for retry
          }
        } catch (e) {
          // network or other error - stop processing
          console.log('OfflineProvider.syncQueue: item failed', e);
        }
      }
    } finally {
      setSyncing(false);
      await refreshPending();
    }
  }, [isOnline, syncing, refreshPending]);

  // Auto-sync when coming online
  useEffect(() => {
    if (isOnline) { syncQueue(); }
  }, [isOnline, syncQueue]);

  const value = {
    isOnline,
    pendingCount: pending,
    enqueue,
    syncQueue,
    saveShops: offline.saveShops,
    getShops: offline.getShops,
    saveNearby: offline.saveNearby,
    getNearby: offline.getNearby,
  };

  return (
    <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>
  );
}
