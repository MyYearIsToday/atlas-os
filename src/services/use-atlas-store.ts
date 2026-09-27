import { useSyncExternalStore } from 'react';

import { atlasStore } from './local-store';

export function useAtlasStore() {
  return useSyncExternalStore(
    atlasStore.subscribe,
    atlasStore.getSnapshot,
    atlasStore.getSnapshot,
  );
}