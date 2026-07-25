import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { useStore } from '../../lib/store.js';
import type { AttemptController } from './store/controller.js';
import type { AttemptState } from './store/types.js';

const AttemptContext = createContext<AttemptController | null>(null);

export function AttemptProvider(props: {
  readonly controller: AttemptController;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <AttemptContext.Provider value={props.controller}>{props.children}</AttemptContext.Provider>
  );
}

export function useAttemptController(): AttemptController {
  const controller = useContext(AttemptContext);
  if (controller === null) throw new Error('useAttemptController used outside AttemptProvider');
  return controller;
}

/**
 * Subscribe to a slice of attempt state.
 *
 * Selectors are narrow on purpose. The palette re-rendering all 180 cells on
 * every countdown tick is the difference between a player that stays
 * responsive for three hours and one that does not.
 */
export function useAttemptState<S>(
  selector: (state: AttemptState) => S,
  isEqual?: (a: S, b: S) => boolean,
): S {
  const controller = useAttemptController();
  return useStore(controller.store, selector, isEqual);
}
