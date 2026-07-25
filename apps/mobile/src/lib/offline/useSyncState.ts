import { useEffect, useState } from 'react';
import { subscribeToSync } from './sync.js';
import type { SyncState } from './sync.js';

const INITIAL: SyncState = {
  pendingAnswers: 0,
  // Pessimistic until NetInfo says otherwise. Assuming online and being wrong
  // means a screen renders a spinner waiting for a request that will never
  // land; assuming offline and being wrong costs a moment of a stale banner.
  online: false,
  draining: false,
  lastErrorAtMs: null,
};

/**
 * Subscribe a component to the sync engine.
 *
 * The engine is a module singleton with one NetInfo listener for the whole app
 * (started once in the root layout). Screens read from it rather than adding
 * listeners of their own: a NetInfo subscription per screen means a tab switch
 * on a flaky connection schedules a drain per mounted screen, which is the
 * request-amplification pattern the offline design exists to avoid.
 */
export function useSyncState(): SyncState {
  const [state, setState] = useState<SyncState>(INITIAL);
  useEffect(() => subscribeToSync(setState), []);
  return state;
}
