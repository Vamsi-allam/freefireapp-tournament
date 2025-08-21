// Optional tiny utilities to consume realtime in components without refactors
// Keep usage simple: import { useLiveMatches } and pass a setState

import { useEffect } from 'react';
import { listMatches, subscribeMatches } from './api';

export function useLiveMatches(setter) {
  useEffect(() => {
    let mounted = true;
    listMatches().then((rows) => mounted && setter(rows)).catch(() => {});
    const unsub = subscribeMatches((payload) => {
      setter((prev) => {
        const list = Array.isArray(prev) ? [...prev] : [];
        if (payload.eventType === 'INSERT') return [...list, payload.new];
        if (payload.eventType === 'UPDATE') return list.map((r) => (r.id === payload.new.id ? payload.new : r));
        if (payload.eventType === 'DELETE') return list.filter((r) => r.id !== payload.old.id);
        return list;
      });
    });
    return () => { mounted = false; unsub?.(); };
  }, [setter]);
}
